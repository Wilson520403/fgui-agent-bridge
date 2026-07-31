import FairyEditor = CS.FairyEditor;
import UnityEngine = CS.UnityEngine;
import puerts = require("puerts");
const IOFile = CS.System.IO.File;
const IODirectory = CS.System.IO.Directory;
const IOPath = CS.System.IO.Path;
const IOFileInfo = CS.System.IO.FileInfo;
const IOSearchOption = CS.System.IO.SearchOption;

const App = FairyEditor.App;
const previousRunInBackground = UnityEngine.Application.runInBackground;
UnityEngine.Application.runInBackground = true;

const BRIDGE_VERSION = "0.6.0";
const PROTOCOL_VERSION = "1.0";
const POLL_INTERVAL_FRAMES = 6;
const STATUS_INTERVAL_FRAMES = 60;
const MAX_COMMANDS_PER_POLL = 4;

interface AgentRequest {
    id?: string;
    action?: string;
    params?: any;
    protocolVersion?: string;
}

interface AgentResponse {
    id: string;
    ok: boolean;
    action: string;
    result?: any;
    error?: {
        message: string;
        stack?: string;
    };
    timestamp: string;
}

interface AgentPropertyHistoryEntry {
    documentUrl: string;
    target: any;
    property: string;
    before: any;
    after: any;
    documentModifiedBefore: boolean;
}

const agentUndoStack: AgentPropertyHistoryEntry[] = [];
const agentRedoStack: AgentPropertyHistoryEntry[] = [];

let frameCount = 0;
let queueRoot = "";
let requestFolder = "";
let processingFolder = "";
let responseFolder = "";
let statusFile = "";
let logFile = "";
let initialized = false;
let publishInProgress = false;

function nowIso(): string {
    return new Date().toISOString();
}

function appendLog(message: string): void {
    try {
        if (!logFile)
            return;

        IOFile.AppendAllText(logFile, `[${nowIso()}] ${message}\n`);
    }
    catch (_) {
        // 日志失败不能阻断桥接命令。
    }
}

function ensureDirectory(path: string): void {
    if (!IODirectory.Exists(path))
        IODirectory.CreateDirectory(path);
}

function initializeBridge(): boolean {
    if (!App.project || !App.project.opened)
        return false;

    const nextQueueRoot = IOPath.Combine(App.project.basePath, ".agent");
    if (initialized && queueRoot === nextQueueRoot)
        return true;

    queueRoot = nextQueueRoot;
    requestFolder = IOPath.Combine(queueRoot, "requests");
    processingFolder = IOPath.Combine(queueRoot, "processing");
    responseFolder = IOPath.Combine(queueRoot, "responses");
    statusFile = IOPath.Combine(queueRoot, "status.json");
    logFile = IOPath.Combine(queueRoot, "bridge.log");

    ensureDirectory(queueRoot);
    ensureDirectory(requestFolder);
    ensureDirectory(processingFolder);
    ensureDirectory(responseFolder);

    initialized = true;
    appendLog(`bridge initialized: ${App.project.basePath}`);
    writeStatus();
    App.consoleView.Log(`[FGUI Agent Bridge] 已启动，队列目录：${queueRoot}`);
    return true;
}

function writeJsonAtomic(path: string, data: any): void {
    const tempPath = `${path}.tmp`;
    IOFile.WriteAllText(tempPath, JSON.stringify(data, null, 2));
    if (IOFile.Exists(path))
        IOFile.Delete(path);
    IOFile.Move(tempPath, path);
}

function writeStatus(): void {
    if (!initialized || !App.project || !App.project.opened)
        return;

    const activeDoc = App.activeDoc;
    writeJsonAtomic(statusFile, {
        online: true,
        bridgeVersion: BRIDGE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        publishInProgress,
        timestamp: nowIso(),
        project: {
            id: App.project.id,
            name: App.project.name,
            basePath: App.project.basePath,
            type: App.project.type
        },
        activeDocument: activeDoc ? describeDocument(activeDoc) : null,
        capabilities: [
            "ping",
            "get_project",
            "list_packages",
            "list_items",
            "open_document",
            "create_component",
            "import_image",
            "create_button",
            "get_active_document",
            "get_tree",
            "select_object",
            "set_property",
            "insert_object",
            "remove_object",
            "save_document",
            "save_all",
            "get_publish_settings",
            "publish",
            "get_history",
            "discard_document",
            "undo",
            "redo"
        ]
    });
}

function describeProject(): any {
    const project = App.project;
    if (!project || !project.opened)
        throw new Error("FairyGUI 工程尚未打开");

    return {
        id: project.id,
        name: project.name,
        type: project.type,
        versionCode: project.versionCode,
        basePath: project.basePath,
        assetsPath: project.assetsPath,
        settingsPath: project.settingsPath,
        activeBranch: project.activeBranch,
        packageCount: project.allPackages.Count
    };
}

function describePackage(pkg: FairyEditor.FPackage): any {
    return {
        id: pkg.id,
        name: pkg.name,
        basePath: pkg.basePath,
        opened: pkg.opened,
        itemCount: pkg.items.Count
    };
}

function describeItem(item: FairyEditor.FPackageItem): any {
    return {
        id: item.id,
        name: item.name,
        title: item.title,
        type: item.type,
        path: item.path,
        file: item.file,
        width: item.width,
        height: item.height,
        exported: item.exported,
        url: item.GetURL()
    };
}

function describeDocument(doc: FairyEditor.View.Document): any {
    return {
        url: doc.docURL,
        title: doc.displayTitle,
        itemId: doc.packageItem ? doc.packageItem.id : null,
        itemName: doc.packageItem ? doc.packageItem.name : null,
        packageName: doc.packageItem && doc.packageItem.owner ? doc.packageItem.owner.name : null,
        modified: doc.isModified,
        savedVersion: doc.savedVersion,
        selectionCount: (doc.GetSelection() as any).Count
    };
}

function safeRequestId(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    return sanitized || `request-${Date.now()}`;
}

function safeValue(value: any): any {
    if (value === null || value === undefined)
        return null;

    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean")
        return value;

    try {
        return String(value);
    }
    catch (_) {
        return null;
    }
}

function describeObject(obj: FairyEditor.FObject, depth: number, maxDepth: number): any {
    const result: any = {
        id: obj.id,
        name: obj.name,
        type: obj.objectType,
        resourceURL: obj.resourceURL || null,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        rotation: obj.rotation,
        alpha: obj.alpha,
        visible: obj.visible,
        touchable: obj.touchable,
        grayed: obj.grayed,
        enabled: obj.enabled,
        locked: obj.locked,
        text: obj.text || "",
        icon: obj.icon || ""
    };

    const component = obj as FairyEditor.FComponent;
    if (typeof component.numChildren === "number")
        result.opaque = component.opaque;

    if (depth < maxDepth && typeof component.numChildren === "number") {
        const children: any[] = [];
        for (let i = 0; i < component.numChildren; i++)
            children.push(describeObject(component.GetChildAt(i), depth + 1, maxDepth));
        result.children = children;
    }
    else if (typeof component.numChildren === "number") {
        result.childCount = component.numChildren;
    }

    return result;
}

function getActiveDocument(): FairyEditor.View.Document {
    const doc = App.activeDoc;
    if (!doc)
        throw new Error("当前没有打开的 FairyGUI 文档");
    return doc;
}

function resolvePackage(params: any): FairyEditor.FPackage {
    const project = App.project;
    let pkg: FairyEditor.FPackage = null;

    if (params && params.packageId)
        pkg = project.GetPackage(String(params.packageId));
    if (!pkg && params && params.packageName)
        pkg = project.GetPackageByName(String(params.packageName));

    if (!pkg)
        throw new Error("未找到指定 FairyGUI 包，请提供 packageId 或 packageName");
    pkg.EnsureOpen();
    return pkg;
}

function resolveItem(params: any): FairyEditor.FPackageItem {
    const project = App.project;
    let item: FairyEditor.FPackageItem = null;

    if (params && params.url)
        item = project.GetItemByURL(String(params.url));

    if (!item && params && params.packageId && params.itemId)
        item = project.GetItem(String(params.packageId), String(params.itemId));

    if (!item && params && params.packageName) {
        const pkg = project.GetPackageByName(String(params.packageName));
        if (pkg) {
            pkg.EnsureOpen();
            if (params.itemId)
                item = pkg.GetItem(String(params.itemId));
            else if (params.itemPath)
                item = pkg.GetItemByPath(String(params.itemPath));
            else if (params.itemName)
                item = pkg.FindItemByName(String(params.itemName));
        }
    }

    if (!item)
        throw new Error("未找到指定 FairyGUI 资源，请提供 url，或 packageName 与 itemName/itemPath");
    return item;
}

function normalizePackagePath(value: any): string {
    const raw = String(value || "").trim().replace(/\\/g, "/");
    const normalized = raw.replace(/^\/+|\/+$/g, "");
    if (!normalized)
        return "/";

    const parts = normalized.split("/");
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part || part === "." || part === "..")
            throw new Error(`无效的包内目录：${raw}`);
        if (/[\u0000-\u001f:*?"<>|]/.test(part))
            throw new Error(`包内目录包含非法字符：${part}`);
        parts[i] = part;
    }
    return `/${parts.join("/")}/`;
}

function validateResourceName(value: any, label: string): string {
    const name = String(value || "").trim();
    if (!name)
        throw new Error(`${label}不能为空`);
    if (name === "." || name === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(name))
        throw new Error(`${label}包含非法字符：${name}`);
    return name;
}

function validateSize(value: any, fallback: number, label: string): number {
    const numberValue = value === undefined || value === null ? fallback : Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0 || numberValue > 32768)
        throw new Error(`${label}必须大于 0 且不超过 32768`);
    return numberValue;
}

function resolvePackageFolder(pkg: FairyEditor.FPackage, pathValue: any, createIfMissing: boolean): FairyEditor.FPackageItem {
    pkg.EnsureOpen();
    const path = normalizePackagePath(pathValue);
    if (path === "/")
        return pkg.rootItem;

    let folder = pkg.GetItemByPath(path);
    if (!folder && createIfMissing)
        folder = pkg.EnsurePathExists(path, true);
    if (!folder)
        throw new Error(`包 ${pkg.name} 中不存在目录：${path}`);
    if (folder.type !== FairyEditor.FPackageItemType.FOLDER)
        throw new Error(`包内路径不是目录：${path}`);
    return folder;
}

function findItemInFolder(pkg: FairyEditor.FPackage, folder: FairyEditor.FPackageItem, name: string): FairyEditor.FPackageItem {
    return pkg.GetItemByName(folder, name);
}

function resolveNewItemName(
    pkg: FairyEditor.FPackage,
    folder: FairyEditor.FPackageItem,
    requestedName: string,
    autoRename: boolean
): string {
    if (!findItemInFolder(pkg, folder, requestedName))
        return requestedName;
    if (!autoRename)
        throw new Error(`资源已存在：${requestedName}`);

    for (let index = 1; index <= 9999; index++) {
        const candidate = `${requestedName}_${index}`;
        if (!findItemInFolder(pkg, folder, candidate))
            return candidate;
    }
    throw new Error(`无法为资源生成唯一名称：${requestedName}`);
}

function toCsStringArray(values: string[]): any {
    const result = CS.System.Array.CreateInstance(puerts.$typeof(CS.System.String), values.length);
    for (let i = 0; i < values.length; i++)
        result.SetValue(values[i], i);
    return result;
}

function markPackageChanged(pkg: FairyEditor.FPackage): void {
    pkg.SetChanged();
    App.project.SetChanged();
    clearAgentHistory();
    writeStatus();
}

function describeCreatedItem(
    item: FairyEditor.FPackageItem,
    operation: string,
    requestedName: string,
    folderPath: string,
    document: FairyEditor.View.Document = null
): any {
    return {
        operation,
        requestedName,
        actualName: item.name,
        autoRenamed: item.name !== requestedName,
        folderPath,
        item: describeItem(item),
        document: document ? describeDocument(document) : null,
        packageModified: true,
        requiresSave: true
    };
}

function createComponent(params: any): any {
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.componentName, "componentName");
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    const actualName = resolveNewItemName(pkg, folder, requestedName, params.autoRename === true);
    const width = validateSize(params.width, 800, "width");
    const height = validateSize(params.height, 600, "height");
    const extensionId = params.extensionId ? String(params.extensionId).trim() : "";
    const exported = params.exported !== false;
    const item = pkg.CreateComponentItem(
        actualName,
        width,
        height,
        folderPath,
        extensionId,
        exported,
        false
    );
    if (!item)
        throw new Error(`创建组件失败：${requestedName}`);

    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    return describeCreatedItem(item, "created", requestedName, folderPath, document);
}

function normalizeConflictPolicy(value: any): string {
    const policy = String(value || "error").toLowerCase();
    if (policy !== "error" && policy !== "auto_rename" && policy !== "replace")
        throw new Error(`未知冲突策略：${policy}`);
    return policy;
}

async function importImage(params: any): Promise<any> {
    const pkg = resolvePackage(params);
    const rawSourcePath = String(params.sourcePath || "").trim();
    if (!rawSourcePath)
        throw new Error("sourcePath 不能为空");
    if (!IOPath.IsPathRooted(rawSourcePath))
        throw new Error("sourcePath 必须是绝对路径");

    const sourcePath = IOPath.GetFullPath(rawSourcePath);
    if (!IOFile.Exists(sourcePath))
        throw new Error(`图片文件不存在：${sourcePath}`);
    const detectedType = FairyEditor.FPackageItemType.GetFileType(sourcePath);
    if (detectedType !== FairyEditor.FPackageItemType.IMAGE)
        throw new Error(`文件不是 FairyGUI 支持的图片资源：${sourcePath}`);

    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    let requestedName = params.resourceName
        ? String(params.resourceName).trim()
        : String(IOPath.GetFileNameWithoutExtension(sourcePath));
    const sourceExtension = String(IOPath.GetExtension(requestedName) || "");
    if (sourceExtension)
        requestedName = String(IOPath.GetFileNameWithoutExtension(requestedName));
    requestedName = validateResourceName(requestedName, "resourceName");

    const policy = normalizeConflictPolicy(params.conflictPolicy);
    let actualName = requestedName;
    let existing = findItemInFolder(pkg, folder, actualName);
    if (existing && policy === "error")
        throw new Error(`资源已存在：${requestedName}`);
    if (existing && policy === "auto_rename") {
        actualName = resolveNewItemName(pkg, folder, requestedName, true);
        existing = null;
    }

    if (existing && policy === "replace") {
        if (existing.type !== FairyEditor.FPackageItemType.IMAGE)
            throw new Error(`同名资源不是图片，不能替换：${requestedName}`);
        await puerts.$promise(pkg.UpdateResource(existing, sourcePath));
        existing.exported = params.exported !== false;
        existing.SetChanged();
        markPackageChanged(pkg);
        return {
            operation: "replaced",
            requestedName,
            actualName: existing.name,
            autoRenamed: false,
            sourcePath,
            folderPath,
            item: describeItem(existing),
            packageModified: true,
            requiresSave: true,
            diskWrite: true
        };
    }

    const importFileName = `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`;
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, folderPath, importFileName));
    if (!item)
        throw new Error(`导入图片失败：${sourcePath}`);
    if (item.type !== FairyEditor.FPackageItemType.IMAGE)
        throw new Error(`导入结果不是图片资源：${item.name}`);
    item.exported = params.exported !== false;
    item.SetChanged();

    markPackageChanged(pkg);
    return {
        operation: "imported",
        requestedName,
        actualName: item.name,
        autoRenamed: item.name !== requestedName,
        sourcePath,
        folderPath,
        item: describeItem(item),
        packageModified: true,
        requiresSave: true,
        diskWrite: true
    };
}

function normalizeButtonMode(value: any): string {
    const mode = String(value || "common").toLowerCase();
    if (mode === "common")
        return "Common";
    if (mode === "check")
        return "Check";
    if (mode === "radio")
        return "Radio";
    throw new Error(`未知按钮模式：${mode}`);
}

function resolveButtonImages(params: any): string[] {
    const input = params.imageUrls === undefined || params.imageUrls === null ? [] : params.imageUrls;
    if (!Array.isArray(input))
        throw new Error("imageUrls 必须是数组");
    if (input.length > 6)
        throw new Error("imageUrls 最多包含 6 个状态图片");

    const result: string[] = [];
    for (let i = 0; i < input.length; i++) {
        const raw = String(input[i] || "").trim();
        if (!raw) {
            result.push("");
            continue;
        }
        const item = resolveItem({ url: raw });
        if (item.type !== FairyEditor.FPackageItemType.IMAGE)
            throw new Error(`按钮状态资源不是图片：${raw}`);
        result.push(item.GetURL());
    }
    while (result.length < 6)
        result.push("");
    return result;
}

function createButton(params: any): any {
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.buttonName, "buttonName");
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    const actualName = resolveNewItemName(pkg, folder, requestedName, params.autoRename === true);
    const width = validateSize(params.width, 160, "width");
    const height = validateSize(params.height, 60, "height");
    const mode = normalizeButtonMode(params.mode);
    const images = resolveButtonImages(params);
    const extensionId = params.extensionId
        ? String(params.extensionId).trim()
        : FairyEditor.FObjectType.EXT_BUTTON;
    const templates = new FairyEditor.ComponentTemplates(pkg);
    const item = templates.CreateButtonItem(
        actualName,
        extensionId,
        mode,
        toCsStringArray(images),
        width,
        height,
        params.asListItem === true,
        params.createRelations !== false,
        params.createText !== false,
        params.createIcon !== false,
        params.exported !== false,
        folderPath
    );
    if (!item)
        throw new Error(`创建按钮失败：${requestedName}`);

    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    const result = describeCreatedItem(item, "created", requestedName, folderPath, document);
    result.mode = mode;
    result.imageUrls = images;
    return result;
}

function openDocument(params: any): FairyEditor.View.Document {
    const item = resolveItem(params);
    if (item.type !== FairyEditor.FPackageItemType.COMPONENT)
        throw new Error(`资源 ${item.name} 不是组件，无法作为文档打开`);

    const opened = App.docView.OpenDocument(item.GetURL(), true) as FairyEditor.View.Document;
    if (!opened)
        throw new Error(`打开文档失败：${item.GetURL()}`);
    return opened;
}

function findObjectById(root: FairyEditor.FObject, id: string): FairyEditor.FObject {
    if (root.id === id)
        return root;

    const component = root as FairyEditor.FComponent;
    if (typeof component.numChildren !== "number")
        return null;

    for (let i = 0; i < component.numChildren; i++) {
        const found = findObjectById(component.GetChildAt(i), id);
        if (found)
            return found;
    }
    return null;
}

function findObjectsByName(root: FairyEditor.FObject, name: string, result: FairyEditor.FObject[]): void {
    if (root.name === name)
        result.push(root);

    const component = root as FairyEditor.FComponent;
    if (typeof component.numChildren !== "number")
        return;

    for (let i = 0; i < component.numChildren; i++)
        findObjectsByName(component.GetChildAt(i), name, result);
}

function findObjectByPath(root: FairyEditor.FComponent, path: string): FairyEditor.FObject {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized === "root")
        return root;

    const parts = normalized.split("/");
    if (parts[0] === "root")
        parts.shift();

    let current: FairyEditor.FObject = root;
    for (const part of parts) {
        const component = current as FairyEditor.FComponent;
        if (typeof component.numChildren !== "number")
            return null;
        current = component.GetChild(part);
        if (!current)
            return null;
    }
    return current;
}

function resolveObject(doc: FairyEditor.View.Document, locator: any): FairyEditor.FObject {
    if (!locator || locator.path === "root")
        return doc.content;

    if (locator.id) {
        const foundById = findObjectById(doc.content, String(locator.id));
        if (!foundById)
            throw new Error(`未找到对象 ID：${locator.id}`);
        return foundById;
    }

    if (locator.path) {
        const foundByPath = findObjectByPath(doc.content, String(locator.path));
        if (!foundByPath)
            throw new Error(`未找到对象路径：${locator.path}`);
        return foundByPath;
    }

    if (locator.name) {
        const matches: FairyEditor.FObject[] = [];
        findObjectsByName(doc.content, String(locator.name), matches);
        if (matches.length === 0)
            throw new Error(`未找到对象名称：${locator.name}`);
        if (matches.length > 1)
            throw new Error(`对象名称不唯一：${locator.name}，共找到 ${matches.length} 个，请改用 path 或 id`);
        return matches[0];
    }

    throw new Error("对象定位信息缺失，请提供 target.path、target.id 或 target.name");
}

const writableProperties: { [key: string]: boolean } = {
    name: true,
    x: true,
    y: true,
    width: true,
    height: true,
    scaleX: true,
    scaleY: true,
    skewX: true,
    skewY: true,
    pivotX: true,
    pivotY: true,
    anchor: true,
    rotation: true,
    alpha: true,
    visible: true,
    touchable: true,
    opaque: true,
    grayed: true,
    enabled: true,
    locked: true,
    hideByEditor: true,
    useSourceSize: true,
    text: true,
    icon: true,
    tooltips: true,
    blendMode: true,
    customData: true,
    notes: true
};

function validatePropertyTarget(doc: FairyEditor.View.Document, obj: FairyEditor.FObject, property: string): void {
    const isRoot = obj === doc.content;
    if (isRoot && property === "touchable") {
        throw new Error(
            "FairyGUI 组件根节点不序列化 touchable，无法持久化该属性；" +
            "如需让透明根区域不拦截点击，请设置根组件 opaque=false，并分别设置需要穿透的子对象 touchable=false"
        );
    }

    if (property === "opaque" && !isRoot)
        throw new Error("opaque 是组件定义属性，只能对当前文档根组件设置");
}

function getWritableProperty(obj: FairyEditor.FObject, property: string): any {
    if (property === "opaque")
        return (obj as FairyEditor.FComponent).opaque;
    return obj.GetProperty(property);
}

function setWritableProperty(obj: FairyEditor.FObject, property: string, value: any): void {
    if (property === "opaque") {
        if (typeof value !== "boolean")
            throw new Error("opaque 只接受布尔值");
        (obj as FairyEditor.FComponent).opaque = value;
        return;
    }
    obj.SetProperty(property, value);
}

function valuesEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function historyTarget(obj: FairyEditor.FObject, requestedTarget: any): any {
    if (obj.id)
        return { id: obj.id };
    if (requestedTarget && requestedTarget.path)
        return { path: requestedTarget.path };
    return { path: "root" };
}

function clearAgentHistory(): void {
    agentUndoStack.length = 0;
    agentRedoStack.length = 0;
}

function openDocumentByUrl(url: string): FairyEditor.View.Document {
    const opened = App.docView.OpenDocument(url, true) as FairyEditor.View.Document;
    if (!opened)
        throw new Error(`无法打开历史记录对应文档：${url}`);
    return opened;
}

function applyAgentHistory(entry: AgentPropertyHistoryEntry, undo: boolean): any {
    const doc = openDocumentByUrl(entry.documentUrl);
    const obj = resolveObject(doc, entry.target);
    const expected = undo ? entry.after : entry.before;
    const nextValue = undo ? entry.before : entry.after;
    validatePropertyTarget(doc, obj, entry.property);
    const current = safeValue(getWritableProperty(obj, entry.property));

    if (!valuesEqual(current, expected))
        throw new Error(`对象属性已被其他操作修改，拒绝${undo ? "撤销" : "重做"}：${entry.property}`);

    setWritableProperty(obj, entry.property, nextValue);
    doc.SetModified(undo ? entry.documentModifiedBefore : true);
    doc.RefreshInspectors();

    return {
        mode: "agent-property",
        target: { id: obj.id, name: obj.name, type: obj.objectType },
        property: entry.property,
        before: current,
        after: safeValue(getWritableProperty(obj, entry.property)),
        document: describeDocument(doc)
    };
}

function getActivePackage(): FairyEditor.FPackage {
    const doc = getActiveDocument();
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.owner)
        throw new Error("无法从当前文档确定所属包");
    return item.owner;
}

function resolvePublishPackages(params: any): FairyEditor.FPackage[] {
    const scope = String(params.scope || "active");
    const result: FairyEditor.FPackage[] = [];

    if (scope === "active")
        result.push(getActivePackage());
    else if (scope === "all") {
        for (let i = 0; i < App.project.allPackages.Count; i++)
            result.push(App.project.allPackages.get_Item(i));
    }
    else if (scope === "packages") {
        const names = params.packageNames;
        if (!names || !Array.isArray(names) || names.length === 0)
            throw new Error("scope=packages 时必须提供非空 packageNames");

        const seen: { [name: string]: boolean } = {};
        for (let i = 0; i < names.length; i++) {
            const packageName = String(names[i] || "").trim();
            if (!packageName)
                throw new Error("packageNames 不能包含空名称");
            if (seen[packageName])
                continue;

            const pkg = App.project.GetPackageByName(packageName);
            if (!pkg)
                throw new Error(`未找到包：${packageName}`);
            seen[packageName] = true;
            result.push(pkg);
        }
    }
    else
        throw new Error(`未知发布范围：${scope}`);

    if (result.length === 0)
        throw new Error("没有可发布的 FairyGUI 包");
    return result;
}

function validatePublishBranch(branch: string): void {
    if (!branch)
        return;

    const branches = App.project.allBranches;
    for (let i = 0; i < branches.Count; i++) {
        if (branches.get_Item(i) === branch)
            return;
    }
    throw new Error(`未找到分支：${branch}`);
}

function normalizeOutputPath(path: string): string {
    if (!path)
        return "";
    if (/^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path))
        return path;
    if (IOPath.IsPathRooted(path))
        return IOPath.GetFullPath(path);
    return IOPath.GetFullPath(IOPath.Combine(App.project.basePath, path));
}

function stringListToArray(list: any): string[] {
    const result: string[] = [];
    for (let i = 0; i < list.Count; i++)
        result.push(String(list.get_Item(i)));
    return result;
}

function describePublishSettings(params: any): any {
    const settings = App.project.GetSettings("Publish") as FairyEditor.GlobalPublishSettings;
    if (!settings)
        throw new Error("FairyGUI 工程缺少 Publish 设置");

    const packages: any[] = [];
    const packageName = params && params.packageName ? String(params.packageName) : "";
    const sourcePackages: FairyEditor.FPackage[] = [];
    if (packageName) {
        const pkg = App.project.GetPackageByName(packageName);
        if (!pkg)
            throw new Error(`未找到包：${packageName}`);
        sourcePackages.push(pkg);
    }
    else {
        for (let i = 0; i < App.project.allPackages.Count; i++)
            sourcePackages.push(App.project.allPackages.get_Item(i));
    }

    for (let i = 0; i < sourcePackages.length; i++) {
        const pkg = sourcePackages[i];
        const packageSettings = pkg.publishSettings;
        const configuredPath = packageSettings.path || settings.path;
        const configuredCodePath = packageSettings.codePath || settings.codeGeneration.codePath;
        packages.push({
            package: describePackage(pkg),
            path: packageSettings.path,
            effectivePath: normalizeOutputPath(configuredPath),
            fileName: packageSettings.fileName || pkg.name,
            packageCount: packageSettings.packageCount,
            genCode: packageSettings.genCode,
            codePath: packageSettings.codePath,
            effectiveCodePath: packageSettings.genCode ? normalizeOutputPath(configuredCodePath) : "",
            branchPath: packageSettings.branchPath,
            useGlobalAtlasSettings: packageSettings.useGlobalAtlasSettings,
            excludedCount: packageSettings.excludedList ? packageSettings.excludedList.Count : 0
        });
    }

    return {
        activeBranch: App.project.activeBranch,
        branches: stringListToArray(App.project.allBranches),
        global: {
            path: settings.path,
            effectivePath: normalizeOutputPath(settings.path),
            branchPath: settings.branchPath,
            fileExtension: settings.fileExtension,
            packageCount: settings.packageCount,
            compressDesc: settings.compressDesc,
            binaryFormat: settings.binaryFormat,
            jpegQuality: settings.jpegQuality,
            compressPNG: settings.compressPNG,
            includeHighResolution: settings.includeHighResolution,
            branchProcessing: settings.branchProcessing,
            seperatedAtlasForBranch: settings.seperatedAtlasForBranch,
            codeGeneration: {
                allowGenCode: settings.codeGeneration.allowGenCode,
                codePath: settings.codeGeneration.codePath,
                effectiveCodePath: normalizeOutputPath(settings.codeGeneration.codePath),
                classNamePrefix: settings.codeGeneration.classNamePrefix,
                memberNamePrefix: settings.codeGeneration.memberNamePrefix,
                packageName: settings.codeGeneration.packageName,
                ignoreNoname: settings.codeGeneration.ignoreNoname,
                getMemberByName: settings.codeGeneration.getMemberByName,
                codeType: settings.codeGeneration.codeType
            },
            atlasSetting: {
                maxSize: settings.atlasSetting.maxSize,
                paging: settings.atlasSetting.paging,
                sizeOption: settings.atlasSetting.sizeOption,
                forceSquare: settings.atlasSetting.forceSquare,
                allowRotation: settings.atlasSetting.allowRotation,
                trimImage: settings.atlasSetting.trimImage
            }
        },
        packages
    };
}

interface FileStamp {
    length: string;
    modifiedTicks: string;
}

function snapshotOutputPaths(paths: string[]): { [path: string]: FileStamp } {
    const snapshot: { [path: string]: FileStamp } = {};
    const visited: { [path: string]: boolean } = {};

    for (let i = 0; i < paths.length; i++) {
        const path = normalizeOutputPath(paths[i]);
        if (!path || visited[path] || !IODirectory.Exists(path))
            continue;
        visited[path] = true;

        const files = IODirectory.GetFiles(path, "*", IOSearchOption.AllDirectories);
        for (let j = 0; j < files.Length; j++) {
            const file = String(files.GetValue(j));
            const info = new IOFileInfo(file);
            snapshot[file] = {
                length: String(info.Length),
                modifiedTicks: String((IOFile.GetLastWriteTimeUtc(file) as any).Ticks)
            };
        }
    }
    return snapshot;
}

function diffSnapshots(before: { [path: string]: FileStamp }, after: { [path: string]: FileStamp }): any {
    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];

    for (const path in after) {
        if (!before[path])
            created.push(path);
        else if (before[path].length !== after[path].length || before[path].modifiedTicks !== after[path].modifiedTicks)
            updated.push(path);
    }
    for (const path in before) {
        if (!after[path])
            deleted.push(path);
    }

    created.sort();
    updated.sort();
    deleted.sort();
    const maxReturnedFiles = 1000;
    let remaining = maxReturnedFiles;
    const returnedCreated = created.slice(0, remaining);
    remaining -= returnedCreated.length;
    const returnedUpdated = updated.slice(0, remaining);
    remaining -= returnedUpdated.length;
    const returnedDeleted = deleted.slice(0, remaining);
    return {
        createdCount: created.length,
        updatedCount: updated.length,
        deletedCount: deleted.length,
        truncated: created.length + updated.length + deleted.length > maxReturnedFiles,
        created: returnedCreated,
        updated: returnedUpdated,
        deleted: returnedDeleted
    };
}

async function publishPackages(params: any): Promise<any> {
    if (publishInProgress)
        throw new Error("已有 FairyGUI 发布任务正在执行");

    const packages = resolvePublishPackages(params);
    const branch = params.branch === undefined ? String(App.project.activeBranch || "") : String(params.branch || "");
    const saveBeforePublish = params.saveBeforePublish !== false;
    const publishDescOnly = params.publishDescOnly === true;
    validatePublishBranch(branch);

    publishInProgress = true;
    const startedAt = nowIso();
    const startedMs = Date.now();
    const handlers: FairyEditor.PublishHandler[] = [];

    try {
        if (saveBeforePublish) {
            App.docView.SaveAllDocuments();
            App.project.Save();
            clearAgentHistory();
        }

        const outputPaths: string[] = [];
        for (let i = 0; i < packages.length; i++) {
            const pkg = packages[i];
            pkg.EnsureOpen();
            const handler = new FairyEditor.PublishHandler(pkg, branch);
            handler.publishDescOnly = publishDescOnly;
            handlers.push(handler);
            if (handler.exportPath)
                outputPaths.push(handler.exportPath);
            if (handler.genCode && handler.exportCodePath)
                outputPaths.push(handler.exportCodePath);
        }

        const before = snapshotOutputPaths(outputPaths);
        const published: any[] = [];
        for (let i = 0; i < handlers.length; i++) {
            const handler = handlers[i];
            await puer.$promise(handler.Run());
            if (!handler.isSuccess)
                throw new Error(`发布包失败：${handler.pkg.name}`);
            if (handler.exportPath)
                outputPaths.push(handler.exportPath);
            if (handler.genCode && handler.exportCodePath)
                outputPaths.push(handler.exportCodePath);
            published.push({
                package: describePackage(handler.pkg),
                exportPath: normalizeOutputPath(handler.exportPath),
                exportCodePath: handler.genCode ? normalizeOutputPath(handler.exportCodePath) : "",
                fileName: handler.fileName,
                fileExtension: handler.fileExtension,
                generatedCode: handler.genCode,
                publishDescOnly: handler.publishDescOnly
            });
        }

        const after = snapshotOutputPaths(outputPaths);
        return {
            success: true,
            scope: String(params.scope || "active"),
            branch,
            saveBeforePublish,
            publishDescOnly,
            startedAt,
            finishedAt: nowIso(),
            durationMs: Date.now() - startedMs,
            packages: published,
            fileChanges: diffSnapshots(before, after)
        };
    }
    finally {
        publishInProgress = false;
        writeStatus();
    }
}

function handleCommand(request: AgentRequest): any {
    const action = String(request.action || "");
    const params = request.params || {};
    const requestProtocol = String(request.protocolVersion || "");
    if (requestProtocol && requestProtocol.split(".")[0] !== PROTOCOL_VERSION.split(".")[0])
        throw new Error(`协议版本不兼容：编辑器 ${PROTOCOL_VERSION}，客户端 ${requestProtocol}`);

    const actionsBlockedDuringPublish: { [action: string]: boolean } = {
        open_document: true,
        create_component: true,
        import_image: true,
        create_button: true,
        select_object: true,
        set_property: true,
        insert_object: true,
        remove_object: true,
        save_document: true,
        save_all: true,
        discard_document: true,
        undo: true,
        redo: true
    };
    if (publishInProgress && actionsBlockedDuringPublish[action])
        throw new Error(`FairyGUI 发布进行中，暂不能执行：${action}`);

    switch (action) {
        case "ping":
            return {
                bridgeVersion: BRIDGE_VERSION,
                protocolVersion: PROTOCOL_VERSION,
                timestamp: nowIso(),
                project: describeProject(),
                activeDocument: App.activeDoc ? describeDocument(App.activeDoc) : null
            };

        case "get_project":
            return describeProject();

        case "list_packages": {
            const packages: any[] = [];
            const list = App.project.allPackages;
            for (let i = 0; i < list.Count; i++)
                packages.push(describePackage(list.get_Item(i)));
            return packages;
        }

        case "list_items": {
            const pkg = resolvePackage(params);
            const items: any[] = [];
            for (let i = 0; i < pkg.items.Count; i++) {
                const item = pkg.items.get_Item(i);
                if (!params.type || item.type === String(params.type))
                    items.push(describeItem(item));
            }
            return {
                package: describePackage(pkg),
                items
            };
        }

        case "open_document":
            return describeDocument(openDocument(params));

        case "create_component":
            return createComponent(params);

        case "import_image":
            return importImage(params);

        case "create_button":
            return createButton(params);

        case "get_active_document":
            return describeDocument(getActiveDocument());

        case "get_tree": {
            const doc = params.url || params.packageName ? openDocument(params) : getActiveDocument();
            const maxDepth = params.maxDepth === undefined ? 12 : Math.max(0, Math.min(64, Number(params.maxDepth)));
            return {
                document: describeDocument(doc),
                tree: describeObject(doc.content, 0, maxDepth)
            };
        }

        case "select_object": {
            const doc = getActiveDocument();
            const obj = resolveObject(doc, params.target);
            doc.SelectObject(obj, params.scrollToView !== false, true);
            return describeObject(obj, 0, 0);
        }

        case "set_property": {
            const doc = getActiveDocument();
            const obj = resolveObject(doc, params.target);
            const property = String(params.property || "");
            if (!writableProperties[property])
                throw new Error(`属性不在安全写入白名单中：${property}`);

            validatePropertyTarget(doc, obj, property);
            const before = safeValue(getWritableProperty(obj, property));
            const documentModifiedBefore = doc.isModified;
            setWritableProperty(obj, property, params.value);
            doc.SetModified(true);
            doc.RefreshInspectors();
            const after = safeValue(getWritableProperty(obj, property));

            if (!valuesEqual(before, after)) {
                agentUndoStack.push({
                    documentUrl: doc.docURL,
                    target: historyTarget(obj, params.target),
                    property,
                    before,
                    after,
                    documentModifiedBefore
                });
                agentRedoStack.length = 0;
            }

            return {
                target: { id: obj.id, name: obj.name, type: obj.objectType },
                property,
                before,
                after,
                documentModified: doc.isModified,
                history: {
                    agentUndoCount: agentUndoStack.length,
                    agentRedoCount: agentRedoStack.length,
                    nativeCanUndo: doc.history.CanUndo(),
                    nativeCanRedo: doc.history.CanRedo(),
                    nativePendingCount: doc.history.GetPendingList().Count
                }
            };
        }

        case "insert_object": {
            const doc = getActiveDocument();
            const item = resolveItem(params);
            const x = Number(params.x || 0);
            const y = Number(params.y || 0);
            const insertIndex = params.insertIndex === undefined ? -1 : Number(params.insertIndex);
            const obj = doc.InsertObject(item.GetURL(), new UnityEngine.Vector2(x, y), insertIndex);
            if (!obj)
                throw new Error(`插入对象失败：${item.GetURL()}`);
            if (params.name)
                obj.SetProperty("name", String(params.name));
            doc.SetModified(true);
            clearAgentHistory();
            doc.SelectObject(obj, true, true);
            return describeObject(obj, 0, 1);
        }

        case "remove_object": {
            const doc = getActiveDocument();
            const obj = resolveObject(doc, params.target);
            if (obj === doc.content)
                throw new Error("不允许删除文档根组件");
            const removed = describeObject(obj, 0, 1);
            doc.RemoveObject(obj);
            doc.SetModified(true);
            clearAgentHistory();
            return {
                removed,
                documentModified: doc.isModified
            };
        }

        case "save_document": {
            const doc = getActiveDocument();
            doc.Save();
            clearAgentHistory();
            return describeDocument(doc);
        }

        case "save_all": {
            App.docView.SaveAllDocuments();
            const savedPackages: string[] = [];
            const packages = App.project.allPackages;
            for (let i = 0; i < packages.Count; i++) {
                const pkg = packages.get_Item(i);
                if (!pkg.opened)
                    continue;
                pkg.Save();
                savedPackages.push(pkg.name);
            }
            App.project.Save();
            clearAgentHistory();
            return {
                saved: true,
                savedPackages,
                activeDocument: App.activeDoc ? describeDocument(App.activeDoc) : null
            };
        }

        case "get_publish_settings":
            return describePublishSettings(params);

        case "publish":
            return publishPackages(params);

        case "get_history": {
            const doc = getActiveDocument();
            return {
                agentUndoCount: agentUndoStack.length,
                agentRedoCount: agentRedoStack.length,
                nativeCanUndo: doc.history.CanUndo(),
                nativeCanRedo: doc.history.CanRedo(),
                nativePendingCount: doc.history.GetPendingList().Count,
                document: describeDocument(doc)
            };
        }

        case "discard_document": {
            const doc = getActiveDocument();
            doc.DiscardChanges();
            clearAgentHistory();
            return describeDocument(doc);
        }

        case "undo": {
            if (agentUndoStack.length > 0) {
                const entry = agentUndoStack.pop();
                try {
                    const result = applyAgentHistory(entry, true);
                    agentRedoStack.push(entry);
                    return { changed: true, ...result };
                }
                catch (error) {
                    agentUndoStack.push(entry);
                    throw error;
                }
            }

            const doc = getActiveDocument();
            const changed = doc.history.Undo();
            return { changed, mode: "native", document: describeDocument(doc) };
        }

        case "redo": {
            if (agentRedoStack.length > 0) {
                const entry = agentRedoStack.pop();
                try {
                    const result = applyAgentHistory(entry, false);
                    agentUndoStack.push(entry);
                    return { changed: true, ...result };
                }
                catch (error) {
                    agentRedoStack.push(entry);
                    throw error;
                }
            }

            const doc = getActiveDocument();
            const changed = doc.history.Redo();
            return { changed, mode: "native", document: describeDocument(doc) };
        }

        default:
            throw new Error(`未知 action：${action}`);
    }
}

function completeRequestSuccess(claimedPath: string, requestId: string, action: string, result: any): void {
    const response: AgentResponse = {
        id: requestId,
        ok: true,
        action,
        result,
        timestamp: nowIso()
    };
    writeJsonAtomic(IOPath.Combine(responseFolder, `${requestId}.json`), response);
    appendLog(`ok ${requestId} ${action}`);
    if (IOFile.Exists(claimedPath))
        IOFile.Delete(claimedPath);
}

function completeRequestError(claimedPath: string, requestId: string, action: string, error: any): void {
    const message = error && error.message ? String(error.message) : String(error);
    const stack = error && error.stack ? String(error.stack) : undefined;
    const response: AgentResponse = {
        id: requestId,
        ok: false,
        action,
        error: { message, stack },
        timestamp: nowIso()
    };
    writeJsonAtomic(IOPath.Combine(responseFolder, `${requestId}.json`), response);
    appendLog(`error ${requestId} ${action}: ${message}`);
    App.consoleView.LogError(`[FGUI Agent Bridge] ${action}: ${message}`);
    if (IOFile.Exists(claimedPath))
        IOFile.Delete(claimedPath);
}

function processRequestFile(sourcePath: string): void {
    const fileName = IOPath.GetFileName(sourcePath);
    const claimedPath = IOPath.Combine(processingFolder, fileName);
    let request: AgentRequest = null;
    let requestId = safeRequestId(IOPath.GetFileNameWithoutExtension(fileName));
    let action = "unknown";

    try {
        if (IOFile.Exists(claimedPath))
            IOFile.Delete(claimedPath);
        IOFile.Move(sourcePath, claimedPath);

        request = JSON.parse(IOFile.ReadAllText(claimedPath));
        requestId = safeRequestId(String(request.id || requestId));
        action = String(request.action || "unknown");

        const result = handleCommand(request);
        if (result && typeof result.then === "function") {
            result.then((value: any) => completeRequestSuccess(claimedPath, requestId, action, value))
                .catch((error: any) => completeRequestError(claimedPath, requestId, action, error));
            return;
        }

        completeRequestSuccess(claimedPath, requestId, action, result);
    }
    catch (error) {
        completeRequestError(claimedPath, requestId, action, error);
    }
}

function pollRequests(): void {
    const files = IODirectory.GetFiles(requestFolder, "*.json");
    const paths: string[] = [];
    for (let i = 0; i < files.Length; i++)
        paths.push(String(files.GetValue(i)));
    paths.sort();

    const count = Math.min(paths.length, MAX_COMMANDS_PER_POLL);
    for (let i = 0; i < count; i++)
        processRequestFile(paths[i]);
}

function onUpdate(): void {
    frameCount++;

    if (!initialized) {
        if (!initializeBridge())
            return;
    }

    if (!App.project || !App.project.opened) {
        initialized = false;
        return;
    }

    if (frameCount % POLL_INTERVAL_FRAMES === 0)
        pollRequests();
    if (frameCount % STATUS_INTERVAL_FRAMES === 0)
        writeStatus();
}

function onProjectOpened(): void {
    initializeBridge();
}

function onProjectClosed(): void {
    if (initialized)
        appendLog("project closed");
    initialized = false;
}

App.add_onUpdate(onUpdate);
App.add_onProjectOpened(onProjectOpened);
App.add_onProjectClosed(onProjectClosed);

let pluginInfo: FairyEditor.PluginManager.PluginInfo = null;
for (let i = 0; i < App.pluginManager.allPlugins.Count; i++) {
    const candidate = App.pluginManager.allPlugins.get_Item(i);
    if (candidate.name === "com.fgui.agent-bridge") {
        pluginInfo = candidate;
        break;
    }
}

if (pluginInfo) {
    pluginInfo.onDestroy = () => {
        App.remove_onUpdate(onUpdate);
        App.remove_onProjectOpened(onProjectOpened);
        App.remove_onProjectClosed(onProjectClosed);
        UnityEngine.Application.runInBackground = previousRunInBackground;
        if (initialized)
            appendLog("bridge destroyed");
    };
}

initializeBridge();
