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

const BRIDGE_VERSION = "0.8.8";
const PROTOCOL_VERSION = "1.0";
const POLL_INTERVAL_FRAMES = 6;
const STATUS_MIN_INTERVAL_MS = 1000;
const MAX_COMMANDS_PER_POLL = 4;
// 超过该时长仍未被认领的请求视为残留（客户端可能已中断），拒绝执行。
const REQUEST_MAX_AGE_MS = 60000;
const DOTNET_EPOCH_TICKS = 62135596800000;

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
        code?: string;
        message: string;
        stack?: string;
        details?: any;
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

interface AgentMovieClipHistoryEntry {
    kind: "movieclip";
    packageId: string;
    itemId: string;
    before: any;
    after: any;
}

const agentUndoStack: Array<AgentPropertyHistoryEntry | AgentAnimationHistoryEntry | AgentMovieClipHistoryEntry> = [];
const agentRedoStack: Array<AgentPropertyHistoryEntry | AgentAnimationHistoryEntry | AgentMovieClipHistoryEntry> = [];

let frameCount = 0;
let lastStatusWrittenMs = 0;
let queueRoot = "";
let requestFolder = "";
let processingFolder = "";
let responseFolder = "";
let statusFile = "";
let logFile = "";
let initialized = false;
let publishInProgress = false;
const animationPreviewContexts: { [key: string]: any } = {};

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
    sweepStaleQueueFiles();

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

function isStaleFile(path: string): boolean {
    try {
        const ticks = Number((IOFile.GetLastWriteTimeUtc(path) as any).Ticks);
        return ticks < (Date.now() - REQUEST_MAX_AGE_MS + DOTNET_EPOCH_TICKS) * 10000;
    }
    catch (_) {
        return false;
    }
}

function sweepStaleQueueFiles(): void {
    const folders = [requestFolder, processingFolder, responseFolder];
    for (const folder of folders) {
        try {
            const files = IODirectory.GetFiles(folder, "*.json");
            for (let i = 0; i < files.Length; i++) {
                const path = String(files.GetValue(i));
                if (isStaleFile(path))
                    IOFile.Delete(path);
            }
        }
        catch (_) { /* 清理失败不阻断桥接初始化。 */ }
    }
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
            "import_font",
            "create_button",
            "import_sound",
            "create_movieclip",
            "get_movieclip",
            "update_movieclip",
            "remove_movieclip",
            "list_transitions",
            "get_transition",
            "upsert_transition",
            "remove_transition",
            "add_transition_item",
            "update_transition_item",
            "remove_transition_item",
            "preview_animation",
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
            "redo",
            "verify_document", "replace_object_resource", "get_text_style", "set_text_style",
            "set_list_layout", "set_group_layout", "set_relation", "set_gear_display",
            "set_controller", "list_controllers"
        ]
    });
    lastStatusWrittenMs = Date.now();
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

const LARGE_IMAGE_LONG_SIDE_MIN = 1920;
const LARGE_IMAGE_SHORT_SIDE_MIN = 1080;
const LARGE_IMAGE_2K_SIDE_MIN = 2048;
const LARGE_IMAGE_ATLAS = "alone";

function isLargeImageDimensions(width: any, height: any): boolean {
    const normalizedWidth = Number(width);
    const normalizedHeight = Number(height);
    if (!isFinite(normalizedWidth) || !isFinite(normalizedHeight) || normalizedWidth <= 0 || normalizedHeight <= 0)
        return false;

    const longSide = Math.max(normalizedWidth, normalizedHeight);
    const shortSide = Math.min(normalizedWidth, normalizedHeight);
    // 覆盖 1920x1080 及以上屏幕大图，或任一边达到 2K（2048）的纹理。
    return (longSide >= LARGE_IMAGE_LONG_SIDE_MIN && shortSide >= LARGE_IMAGE_SHORT_SIDE_MIN)
        || longSide >= LARGE_IMAGE_2K_SIDE_MIN;
}

function applyLargeImageAtlasRule(item: any): boolean {
    if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE || !isLargeImageDimensions(item.width, item.height))
        return false;

    if (String(item.folderAtlas || "") === LARGE_IMAGE_ATLAS)
        return false;

    // FairyGUI 的 alone 纹理集会为每张图片单独生成图集，不会与小图混排。
    item.folderAtlas = LARGE_IMAGE_ATLAS;
    item.SetChanged();
    return true;
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
        folderAtlas: item.folderAtlas || "",
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
        selectionCount: (doc.GetSelection() as any).Count,
        transitionCount: doc.content && (doc.content as any).transitions ? (doc.content as any).transitions.items.Count : 0,
        transitions: summarizeTransitions(doc)
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

    if (String(obj.objectType) === FairyEditor.FObjectType.MOVIECLIP) {
        const movieClip = obj as any;
        result.playing = Boolean(movieClip.playing);
        result.frame = Number(movieClip.frame);
        result.frameCount = movieClip.frameCount === undefined ? null : Number(movieClip.frameCount);
        if ((result.frameCount === null || !Number.isFinite(result.frameCount)) && obj.resourceURL) {
            try {
                const resource = resolveItem({ url: obj.resourceURL });
                const asset = resource.GetAsset();
                if (asset && asset.animation)
                    result.frameCount = Number(asset.animation.frameCount);
            }
            catch (_) { /* 资源尚未加载时保留 null。 */ }
        }
        result.color = movieClip.color ? colorToValue(movieClip.color) : null;
    }

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
    // 组件清单写入 package.xml；组件类资源没有可靠的 asset 重载手段，故不支持 externalReload。
    validatePackageWriteOptions(params, "component", false);
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
    const result = describeCreatedItem(item, "created", requestedName, folderPath, document);
    return packageWriteResult(result, pkg, packageItemRef(item, "component", folderPath, false), params);
}

function normalizeConflictPolicy(value: any): string {
    const policy = String(value || "error").toLowerCase();
    if (policy !== "error" && policy !== "auto_rename" && policy !== "replace")
        throw new Error(`未知冲突策略：${policy}`);
    return policy;
}

async function importImage(params: any): Promise<any> {
    validatePackageWriteOptions(params, "image", true);
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
        const largeImageAtlasApplied = applyLargeImageAtlasRule(existing);
        markPackageChanged(pkg);
        return packageWriteResult({
            operation: "replaced",
            requestedName,
            actualName: existing.name,
            autoRenamed: false,
            sourcePath,
            folderPath,
            largeImageAtlasApplied,
            item: describeItem(existing),
            packageModified: true,
            requiresSave: true,
            diskWrite: true
        }, pkg, packageItemRef(existing, "image", folderPath, true), params);
    }

    const importFileName = `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`;
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, folderPath, importFileName));
    if (!item)
        throw new Error(`导入图片失败：${sourcePath}`);
    if (item.type !== FairyEditor.FPackageItemType.IMAGE)
        throw new Error(`导入结果不是图片资源：${item.name}`);
    item.exported = params.exported !== false;
    item.SetChanged();
    const largeImageAtlasApplied = applyLargeImageAtlasRule(item);

    markPackageChanged(pkg);
    return packageWriteResult({
        operation: "imported",
        requestedName,
        actualName: item.name,
        autoRenamed: item.name !== requestedName,
        sourcePath,
        folderPath,
        largeImageAtlasApplied,
        item: describeItem(item),
        packageModified: true,
        requiresSave: true,
        diskWrite: true
    }, pkg, packageItemRef(item, "image", folderPath, true), params);
}

async function importFont(params: any): Promise<any> {
    validatePackageWriteOptions(params, "font", true);
    const pkg = resolvePackage(params);
    const rawSourcePath = String(params.sourcePath || "").trim();
    if (!rawSourcePath)
        throw new Error("sourcePath 不能为空");
    if (!IOPath.IsPathRooted(rawSourcePath))
        throw new Error("sourcePath 必须是绝对路径");

    const sourcePath = IOPath.GetFullPath(rawSourcePath);
    if (!IOFile.Exists(sourcePath))
        throw new Error(`字体文件不存在：${sourcePath}`);
    const detectedType = FairyEditor.FPackageItemType.GetFileType(sourcePath);
    if (detectedType !== FairyEditor.FPackageItemType.FONT)
        throw new Error(`文件不是 FairyGUI 支持的字体资源：${sourcePath}`);

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
        if (existing.type !== FairyEditor.FPackageItemType.FONT)
            throw new Error(`同名资源不是字体，不能替换：${requestedName}`);
        await puerts.$promise(pkg.UpdateResource(existing, sourcePath));
        existing.exported = params.exported !== false;
        existing.SetChanged();
        markPackageChanged(pkg);
        return packageWriteResult({
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
        }, pkg, packageItemRef(existing, "font", folderPath, true), params);
    }

    const importFileName = `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`;
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, folderPath, importFileName));
    if (!item)
        throw new Error(`导入字体失败：${sourcePath}`);
    if (item.type !== FairyEditor.FPackageItemType.FONT)
        throw new Error(`导入结果不是字体资源：${item.name}`);
    item.exported = params.exported !== false;
    item.SetChanged();

    markPackageChanged(pkg);
    return packageWriteResult({
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
    }, pkg, packageItemRef(item, "font", folderPath, true), params);
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
    validatePackageWriteOptions(params, "component", false);
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
    return packageWriteResult(result, pkg, packageItemRef(item, "component", folderPath, false), params);
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

function findObjectsByResourceUrl(root: FairyEditor.FObject, resourceUrl: string, result: FairyEditor.FObject[]): void {
    if (String(root.resourceURL || "") === resourceUrl)
        result.push(root);

    const component = root as FairyEditor.FComponent;
    if (typeof component.numChildren !== "number")
        return;

    for (let i = 0; i < component.numChildren; i++)
        findObjectsByResourceUrl(component.GetChildAt(i), resourceUrl, result);
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

    if (locator.name || locator.resourceURL) {
        const matches: FairyEditor.FObject[] = [];
        if (locator.name) findObjectsByName(doc.content, String(locator.name), matches);
        else findObjectsByResourceUrl(doc.content, String(locator.resourceURL), matches);
        const filtered = locator.type ? matches.filter((candidate: any) => String(candidate.objectType || candidate.type || "") === String(locator.type)) : matches;
        if (filtered.length === 0)
            throw new Error(locator.resourceURL ? `未找到资源引用对象：${locator.resourceURL}` : `未找到对象名称：${locator.name}`);
        if (filtered.length > 1)
            throw new Error(`对象定位不唯一，共找到 ${filtered.length} 个，请改用 path 或 id`);
        return filtered[0];
    }

    throw new Error("对象定位信息缺失，请提供 target.path、target.id、target.name 或 target.resourceURL");
}

function unityColor(value: any, label: string): any {
    const hex = normalizedColor(value, label).substring(1);
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    const Color = (CS.UnityEngine as any).Color;
    return new Color(r, g, b, a);
}

function normalizedColor(value: any, label: string): string {
    const color = String(value || "").trim().toUpperCase();
    if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(color))
        throw new Error(`${label} 必须是 #RRGGBB 或 #RRGGBBAA`);
    return color;
}

function targetSummary(obj: any, target: any): any {
    return { id: obj.id || null, name: obj.name || null, path: target && target.path ? String(target.path) : null, type: String(obj.objectType || "unknown") };
}

// Verification is deliberately limited to properties with a known serialized meaning.
const VERIFIED_TEXT_KEYS = ["font", "fontSize", "color", "align", "vAlign", "autoSize", "lineGap", "letterSpacing", "width", "height", "x", "y"];
// Whitelist properties whose serialized attribute and default are pinned, so
// set_property can be covered by the same write verification semantics.
const VERIFIED_GENERIC_KEYS = ["scaleX", "scaleY", "rotation", "alpha", "visible", "touchable", "grayed", "text", "icon"];
const VERIFIED_KEYS = ["id", "name", "type", "resourceURL"].concat(VERIFIED_TEXT_KEYS, VERIFIED_GENERIC_KEYS);

function verificationError(code: string, message: string, details: any): never {
    const error: any = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
}

function validateExpectationsMap(flat: any, specPath: string): any {
    const result: any = {};
    for (const key of Object.keys(flat)) {
        if (VERIFIED_KEYS.indexOf(key) < 0)
            verificationError("unsupported_property", `不支持验证属性：${key}`, { stage: "input", property: key, node: specPath });
        const value = flat[key];
        if (value !== null && typeof value !== "string" && typeof value !== "number")
            verificationError("invalid_argument", `expected.${key} 必须是字符串、数字或 null`, { stage: "input", node: specPath });
        if (typeof value === "number" && !Number.isFinite(value))
            verificationError("invalid_argument", `expected.${key} 必须是有限数字`, { stage: "input", node: specPath });
        result[key] = key === "color" ? normalizedColor(value, "color") : value;
    }
    return result;
}

function validateExpectations(expected: any): any {
    if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length === 0)
        verificationError("invalid_argument", "expected 必须是非空属性对象", { stage: "input" });
    return validateExpectationsMap(expected, "expected");
}

function genericObjectValue(obj: any, key: string): any {
    if (obj[key] !== undefined) return safeValue(obj[key]);
    try {
        const value = obj.GetProperty ? obj.GetProperty(key) : null;
        return value === undefined || value === null ? null : safeValue(value);
    } catch (error) {
        return null;
    }
}

function verifiedObjectValues(obj: any): any {
    const value: any = { id: obj.id || "", name: obj.name || "", type: String(obj.objectType || "unknown").toLowerCase(), resourceURL: String(obj.objectType).toLowerCase() === "loader" ? (obj.url || null) : (obj.resourceURL || null) };
    const aliases: any = { vAlign: "verticalAlign", lineGap: "leading" };
    for (const key of VERIFIED_TEXT_KEYS) {
        const property = aliases[key] || key;
        value[key] = key === "color" ? colorHex(obj.color) : (obj[property] === undefined ? null : safeValue(obj[property]));
    }
    // An unspecified/default font is represented by the empty string in XML.
    if (value.font === null) value.font = "";
    for (const key of VERIFIED_GENERIC_KEYS)
        value[key] = genericObjectValue(obj, key);
    return value;
}

function diffExpectedValues(expected: any, actual: any): any[] {
    const differences: any[] = [];
    for (const key of Object.keys(expected)) {
        const a = actual[key] === undefined ? null : actual[key];
        const e = expected[key];
        if (!(typeof e === "number" && typeof a === "number" ? Math.abs(e - a) <= 0.00001 : e === a))
            differences.push({ property: key, expected: e, actual: a });
    }
    return differences;
}

function compareVerification(expected: any, actual: any, stage: string, obj: any): any {
    const differences = diffExpectedValues(expected, actual);
    // Only a mismatch against the live Editor object is an acceptance failure.
    // Once the value has left the Editor (disk XML, or a document reloaded from
    // disk), a mismatch means the value was not persisted — never "rejected".
    if (differences.length)
        verificationError(stage === "editor" ? "editor_rejected" : "persistence_failed", `验证失败：${stage}`, { stage, target: targetSummary(obj, null), expected, actual, differences, mutationMayHaveOccurred: true });
    return actual;
}

// FairyGUI's serializer omits any attribute that still holds its default, so an
// absent attribute is not "unknown" — on reload the Editor produces the default.
// Reading it as null made every default-valued assertion fail with a bogus
// persistence_failed, which reads like a serious persistence bug and invites
// rolling back correct changes. Resolving absence to the default keeps the
// check honest in both directions: expecting the default passes, and expecting
// anything else still fails closed.
//
// Defaults mirror FairyGUI Editor 6.1.x text-object construction values; they are
// pinned by tests/p0_host_harness.cjs and re-checked against a live Editor.
const XML_SERIALIZED_DEFAULTS: { [key: string]: any } = {
    font: "",
    fontSize: 12,
    color: "#FFFFFF",
    align: "left",
    vAlign: "top",
    autoSize: "none",
    letterSpacing: 0,
    lineGap: 0
};

function serializedAttr(attr: any, key: string): any {
    const v = attr(key === "lineGap" ? "leading" : key);
    if (v !== null) return v;
    const fallback = XML_SERIALIZED_DEFAULTS[key];
    return fallback === undefined ? null : fallback;
}

// Loads and parses the XML file the active document serializes to. Read or
// parse failures are persistence failures: the ladder cannot claim disk state
// it cannot read.
function documentXml(doc: any, obj: any): any {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml", target: obj ? targetSummary(obj, null) : null });
    const XmlType = (CS as any).FairyGUI.Utils.XML;
    let xml: any = null;
    try {
        xml = new XmlType(String(IOFile.ReadAllText(item.file)));
    } catch (error) {
        verificationError("persistence_failed", "组件 XML 解析失败", { stage: "xml", file: String(item.file), reason: String(error) });
    }
    return { xml, item, file: String(item.file) };
}

function displayListElements(xml: any): any[] {
    const nodes: any[] = [];
    const list = xml.GetNode("displayList");
    if (list)
        for (let i = 0; i < list.elements.Count; i++)
            nodes.push(list.elements.get_Item(i));
    return nodes;
}

function findPersistedObjectNode(doc: any, obj: any): any {
    const parsed = documentXml(doc, obj);
    let node: any = null;
    if (obj === doc.content) node = parsed.xml;
    else {
        // Only direct displayList children belong to this component's serialized document.
        // Do not accidentally match a nested component or transition's target ID.
        for (const candidate of displayListElements(parsed.xml)) {
            if (String(candidate.GetAttribute("id")) === String(obj.id)) {
                if (node) verificationError("persistence_failed", "XML 对象 ID 不唯一", { stage: "xml", id: obj.id });
                node = candidate;
            }
        }
    }
    if (!node) verificationError("persistence_failed", "XML 中未找到目标对象", { stage: "xml", target: targetSummary(obj, null) });
    return { node, item: parsed.item, file: parsed.file };
}

function persistedObjectValues(doc: any, obj: any): any {
    const found = findPersistedObjectNode(doc, obj);
    return { values: xmlNodeValues(found.item, found.node), file: found.file };
}

function childXmlNodes(node: any, tag: string): any[] {
    const out: any[] = [];
    for (let i = 0; i < node.elements.Count; i++) {
        const child = node.elements.get_Item(i);
        if (String(child.name) === tag) out.push(child);
    }
    return out;
}

function xmlNodeValues(item: any, node: any): any {
    const attr = (key: string): any => { const v = node.GetAttribute(key); return v === null || v === undefined ? null : String(v); };
    const value: any = { id: attr("id") || "", name: attr("name") || "", type: String(node.name), resourceURL: null };
    if (value.type === "loader") value.resourceURL = attr("url");
    else if (attr("src")) value.resourceURL = `ui://${attr("pkg") || item.owner.id}${attr("src")}`;
    for (const key of ["font", "fontSize", "color", "align", "vAlign", "autoSize", "letterSpacing", "lineGap"])
        value[key] = serializedAttr(attr, key);
    if (value.color !== null) value.color = normalizedColor(value.color, "XML color");
    for (const key of ["fontSize", "letterSpacing", "lineGap"])
        if (value[key] !== null) value[key] = Number(value[key]);
    const scale = (attr("scale") || "1,1").split(",").map(Number);
    value.scaleX = scale[0];
    value.scaleY = scale.length > 1 ? scale[1] : scale[0];
    value.rotation = Number(attr("rotation") || 0);
    value.alpha = Number(attr("alpha") || 1);
    // FairyGUI only serializes these when they differ from the default.
    value.visible = attr("visible") !== "false";
    value.touchable = attr("touchable") !== "false";
    value.grayed = attr("grayed") === "true";
    value.text = attr("text") !== null ? attr("text") : (attr("title") !== null ? attr("title") : "");
    value.icon = attr("icon") || "";
    const xy = (attr("xy") || "0,0").split(",").map(Number);
    value.x = xy[0]; value.y = xy[1];
    let size = attr("size");
    // Image size may be omitted when it equals the referenced resource's dimensions.
    if (!size && value.type === "image" && value.resourceURL) {
        const resource = App.project.GetItemByURL(value.resourceURL);
        if (resource) size = `${resource.width},${resource.height}`;
    }
    const dimensions = size ? size.split(",").map(Number) : [null, null];
    value.width = dimensions[0]; value.height = dimensions[1];
    return value;
}

// Stage 4 of the verification ladder described in the improvement plan: prove the
// write survives a real Editor reload. The cheaper stages can all pass while the
// Editor still drops the value on the next parse (an unsupported or renamed
// attribute is silently dropped on load), so only a close + reopen round-trip
// separates "reached the disk file" from "actually loads back".
//
// This closes the user's document, so it must be explicitly requested and it must
// never be faked: a skipped round-trip that still reported success would recreate
// exactly the false-positive this layer exists to eliminate.

const RELOAD_STRENGTH = "reload";
const DISK_STRENGTH = "disk";
const NONE_STRENGTH = "none";

// FairyGUI Editor has shipped both a singular and a plural close overload, and
// which of them survives the editor build's IL2CPP stripping is build-dependent.
// Probe them in place instead of hard-coding a guess, and report which one worked
// so a live run records the real answer. There is deliberately no close-all
// fallback: it would destroy unrelated open documents, which is beyond what the
// caller asked for.
function closeDocumentForReload(docView: any, url: string): any {
    const attempts: string[] = [];
    const strategies: any[] = [
        { name: "CloseDocuments", call: () => docView.CloseDocuments(url) },
        { name: "CloseDocument", call: () => docView.CloseDocument(url) }
    ];
    for (const strategy of strategies) {
        if (typeof docView[strategy.name] !== "function") {
            attempts.push(`${strategy.name}: 不可用`);
            continue;
        }
        try {
            strategy.call();
            return strategy.name;
        }
        catch (error) {
            attempts.push(`${strategy.name}: ${String(error)}`);
        }
    }
    verificationError("persistence_failed", "无法关闭文档以执行 external reload：所有候选关闭方式均不可用", { stage: "reload", url, attempted: attempts });
}

// Shared close + reopen mechanics for every external reload verification.
// Callers decide what to re-check on the fresh document; this function only
// guarantees the document round-tripped through disk and reports which close
// overload worked. An unsaved buffer closes back to the pre-write state and
// would compare as a false positive, so it is refused up front.
function reloadDocument(doc: any, context: any): any {
    const url = String(doc.docURL || "");
    const details = context || {};
    if (!url) verificationError("persistence_failed", "无法获取文档 URL，拒绝执行 external reload", Object.assign({ stage: "reload" }, details));
    if (doc.isModified) verificationError("invalid_argument", "external reload 要求文档已保存：有未保存改动时重载只会回到旧值", Object.assign({ stage: "reload", url }, details));

    const docView = App.docView;
    if (!docView || typeof docView.OpenDocument !== "function")
        verificationError("persistence_failed", "编辑器未暴露可用的 docView.OpenDocument，无法执行 external reload", Object.assign({ stage: "reload", url }, details));

    const closeStrategy = closeDocumentForReload(docView, url);

    let reopened: any = null;
    try {
        reopened = docView.OpenDocument(url, true);
    } catch (error) {
        verificationError("persistence_failed", "external reload 重新打开文档失败", Object.assign({ stage: "reload", url, closeStrategy, reason: String(error) }, details));
    }
    if (!reopened) verificationError("persistence_failed", "external reload 重新打开文档失败：文档未载入", Object.assign({ stage: "reload", url, closeStrategy }, details));
    return { doc: reopened, url, closeStrategy };
}

function externalReloadVerify(doc: any, locator: any, expected: any, state: any, memoryFn?: any): any {
    const rr = reloadDocument(doc, { expected });

    // Every handle captured before the close is now stale; re-locate the target by
    // its recorded locator instead of reusing the pre-close object reference.
    let reloaded: any = null;
    try {
        reloaded = resolveObject(rr.doc, locator);
    } catch (error) {
        verificationError("persistence_failed", "external reload 后无法在重新载入的文档中定位目标", { stage: "reload", url: rr.url, closeStrategy: rr.closeStrategy, target: locator, reason: String(error), expected });
    }

    const values = compareVerification(expected, (memoryFn || verifiedObjectValues)(reloaded), "reload", reloaded);
    // Hand the fresh handle back through state: it is not serializable and cannot
    // be returned in the response, but later code still needs a live document.
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, values };
}

// Removal is verified by proving absence, not by comparing values: the write
// succeeded only if the node can no longer be resolved in the Editor, no longer
// appears in the serialized displayList, and stays gone after a real reload.
function persistedNodeExists(doc: any, objectId: string): any {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml" });
    const XmlType = (CS as any).FairyGUI.Utils.XML;
    const xml = new XmlType(String(IOFile.ReadAllText(item.file)));
    const list = xml.GetNode("displayList");
    let exists = false;
    if (list) {
        for (let i = 0; i < list.elements.Count; i++) {
            if (String(list.elements.get_Item(i).GetAttribute("id")) === String(objectId)) {
                exists = true;
                break;
            }
        }
    }
    return { exists, file: String(item.file) };
}

function externalReloadVerifyAbsent(doc: any, locator: any, state: any): any {
    const rr = reloadDocument(doc, {});

    let stillPresent: any = null;
    try {
        stillPresent = resolveObject(rr.doc, locator);
    } catch (error) {
        stillPresent = null;
    }
    if (stillPresent)
        verificationError("persistence_failed", "external reload 后目标节点仍然存在", { stage: "reload", url: rr.url, closeStrategy: rr.closeStrategy, target: locator });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, absent: true };
}

function verificationStrength(verification: any, saved: boolean): string {
    if (verification && verification.reload && verification.reload.performed) return RELOAD_STRENGTH;
    if (saved && verification && verification.xmlReadback) return DISK_STRENGTH;
    return NONE_STRENGTH;
}

function strengthNote(verification: any, saved: boolean, base: string): string {
    const strength = verificationStrength(verification, saved);
    if (strength === RELOAD_STRENGTH)
        return "已执行关闭重开验证：写入值在从磁盘重新载入的文档上重新定位并比对通过，可确认持久化。";
    if (strength === DISK_STRENGTH)
        return `${base}persisted 仅代表保存成功且磁盘 XML 匹配；未执行 external reload，不能排除编辑器重新载入时丢值。`;
    return `${base}未验证持久化。`;
}

// `readers` lets a dedicated write action verify a value space outside
// VERIFIED_KEYS (list layout attrs, <relation>/<gearDisplay> child elements)
// while staying on the same save → disk → reload ladder. memory(obj) returns a
// flat map from the live object; persisted(doc, obj) returns
// {values, file, skipped?} — skipped lists keys whose XML attribute was absent
// and whose serialized default is not yet pinned, so they are reported as
// uncovered rather than guessed at.
function verifyObject(doc: any, obj: any, expected: any, readXml: boolean, reload?: any, state?: any, readers?: any): any {
    const memoryReader = readers && readers.memory ? readers.memory : verifiedObjectValues;
    const persistedReader = readers && readers.persisted ? readers.persisted : persistedObjectValues;
    const editor = compareVerification(expected, memoryReader(obj), "editor", obj);
    let disk: any = null;
    if (readXml) {
        try {
            disk = persistedReader(doc, obj);
            // Skipped keys (absent serialized attrs whose default is not pinned)
            // are reported via xmlSkippedKeys rather than compared — the absent
            // attribute is ambiguous, not evidence of a failed write.
            const skipped: { [k: string]: boolean } = {};
            for (const k of (disk.skipped || [])) skipped[k] = true;
            const xmlExpected: any = {};
            for (const k of Object.keys(expected)) if (!skipped[k]) xmlExpected[k] = expected[k];
            compareVerification(xmlExpected, disk.values, "xml", obj);
        } catch (error) {
            if (error.code) throw error;
            verificationError("persistence_failed", "XML 读取或解析失败", { stage: "xml", target: targetSummary(obj, null), reason: String(error), expected });
        }
    }
    // Must run last: it closes the document, and the disk read above still needs
    // the open handle to resolve the component URL.
    let reloaded: any = null;
    if (reload) reloaded = externalReloadVerify(doc, reload.target, expected, state || {}, memoryReader);
    return {
        editorReadback: true,
        xmlReadback: Boolean(disk),
        externalReload: Boolean(reloaded),
        expected,
        editor,
        xml: disk ? disk.values : null,
        xmlSkippedKeys: disk && disk.skipped && disk.skipped.length ? disk.skipped : undefined,
        file: disk ? disk.file : null,
        reload: reloaded
    };
}

// Rejects reload combinations that cannot prove anything. Called at the top of
// every write action, before any mutation, so an impossible request never leaves
// the user's document half-written.
function validateReloadOptions(params: any, target: any): void {
    if (!params.externalReload) return;
    if (params.verify === false)
        verificationError("invalid_argument", "external reload 与 verify:false 冲突：verify:false 表示调用方主动关闭验证", { stage: "input", target });
    if (!params.save)
        verificationError("invalid_argument", "external reload 需要 save:true：未保存时重载只会回到旧值，无法证明持久化", { stage: "input", target });
}

function writeVerification(doc: any, obj: any, before: any, after: any, params: any, expected: any, readers?: any): any {
    const wantsReload = Boolean(params.externalReload);
    // Captured before any reload: the target summary must not read a closed handle.
    const target = targetSummary(obj, params.target);
    // Guard repeated here so a new write action cannot skip the precondition.
    validateReloadOptions(params, target);

    // Editor acceptance is checked even with verify=false; that flag only skips disk readback.
    const verification = verifyObject(doc, obj, expected, false, null, null, readers);
    let saved = false;
    if (params.save) {
        try { doc.Save(); }
        catch (error) { verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected }); }
        saved = doc.isModified === false;
        if (!saved) verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }
    const state: any = {};
    // After a reload the original handle is dead; state.doc carries the fresh one.
    const checked = saved && params.verify !== false
        ? verifyObject(doc, obj, expected, true, wantsReload ? { target: params.target || { id: obj.id } } : null, state, readers)
        : verification;
    const liveDoc = state.doc || doc;
    const strength = verificationStrength(checked, saved);
    return {
        ok: true, target, before, after,
        documentModified: Boolean(liveDoc.isModified),
        saved, persisted: strength !== NONE_STRENGTH, strength, verification: checked,
        note: `${strengthNote(checked, saved, "仅验证 expected 中的字段；")}失败不自动回滚。`
    };
}

// ---------- Phase 4: typed layout / relation / gear / controller writes ----------

function numOrNull(value: any): any {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// Each entry: `read` pulls the live value from the editor object, `attr` is the
// serialized XML attribute name, `kind` drives input coercion and the
// absent-attribute fallback at the XML stage. number/bool/string absent values
// resolve to 0/false/"" (the editor only writes non-defaults); enums whose
// serialized default is not yet pinned against a live build are skipped at the
// XML stage instead of guessing, and land in verification.xmlSkippedKeys.
// `member` is the typed object-model property (FList/FGroup expose the
// serialized string form directly); `attr` is the XML attribute name and also
// the name used by the generic GetProperty/SetProperty path for members the
// object model does not surface (overflow, autoClearItems, margin...).
const LIST_LAYOUT_KEYS: { [key: string]: any } = {
    layout: { member: "layout", attr: "layout", kind: "enum" },
    selectionMode: { member: "selectionMode", attr: "selectionMode", kind: "enum" },
    lineGap: { member: "lineGap", attr: "lineGap", kind: "number" },
    columnGap: { member: "columnGap", attr: "colGap", kind: "number" },
    defaultItem: { member: "defaultItem", attr: "defaultItem", kind: "string" },
    autoItemSize: { member: "autoResizeItem", attr: "autoItemSize", kind: "bool" },
    align: { member: "align", attr: "align", kind: "enum" },
    vAlign: { member: "verticalAlign", attr: "vAlign", kind: "enum" },
    selectionController: { member: "selectionController", attr: "selectionController", kind: "string" },
    foldInvisibleItems: { member: "foldInvisibleItems", attr: "foldInvisibleItems", kind: "bool" },
    clearOnPublish: { member: "clearOnPublish", attr: "autoClearItems", kind: "bool" },
    // scrollItemToViewOnClick defaults to true on a live 6.1.4 document — the
    // attr is omitted while the member reads true, so absence must resolve true.
    scrollItemToViewOnClick: { member: "scrollItemToViewOnClick", attr: "scrollItemToViewOnClick", kind: "bool", xmlDefault: true },
    overflow: { member: "overflow", attr: "overflow", kind: "enum" },
    margin: { member: "marginStr", attr: "margin", kind: "string" }
};

const GROUP_LAYOUT_KEYS: { [key: string]: any } = {
    advanced: { member: "advanced", attr: "advanced", kind: "bool" },
    layout: { member: "layout", attr: "layout", kind: "enum" },
    lineGap: { member: "lineGap", attr: "lineGap", kind: "number" },
    columnGap: { member: "columnGap", attr: "colGap", kind: "number" },
    excludeInvisibles: { member: "excludeInvisibles", attr: "excludeInvisibles", kind: "bool" },
    mainGridMinSize: { member: "mainGridMinSize", attr: "gridMinSize", kind: "number", skipIfAbsent: true },
    mainGridIndex: { member: "mainGridIndex", attr: "gridIndex", kind: "number", skipIfAbsent: true },
    autoSizeDisabled: { member: "autoSizeDisabled", attr: "autoSizeDisabled", kind: "bool", skipIfAbsent: true },
    collapsed: { member: "collapsed", attr: "collapsed", kind: "bool", skipIfAbsent: true }
};

// Reads prefer the typed member; object-model-absent properties (overflow,
// autoClearItems, margin, gridMinSize...) fall back to the editor's generic
// GetProperty, which speaks serialized attribute names. A field that resolves
// nowhere reads as its kind default so a rejected write shows up as
// editor_rejected rather than a cryptic null mismatch.
function layoutMemberValue(obj: any, spec: any): any {
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined) return safeValue(obj[member]);
    if (typeof obj.GetProperty === "function") {
        try {
            const v = obj.GetProperty(spec.attr);
            if (v !== undefined && v !== null) return safeValue(v);
        } catch (_) { }
    }
    if (spec.kind === "number") return 0;
    if (spec.kind === "bool") return false;
    return "";
}

function assignLayoutMember(obj: any, spec: any, value: any): void {
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined) { obj[member] = value; return; }
    if (typeof obj.SetProperty === "function") { obj.SetProperty(spec.attr, value); return; }
    obj[member] = value;
}

// Write-path support probe run during validation, before any mutation: a field
// the editor has neither as member nor as generic property is reported as
// unsupported_property instead of blowing up mid-apply (C# side throws
// "<prop> not exists").
function layoutMemberSupported(obj: any, spec: any): boolean {
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined) return true;
    if (typeof obj.GetProperty === "function") {
        try { obj.GetProperty(spec.attr); return true; }
        catch (_) { return false; }
    }
    return false;
}

function typedLayoutValues(obj: any, keys: { [key: string]: any }): any {
    const out: any = { id: obj.id || "", name: obj.name || "", type: String(obj.objectType || "unknown").toLowerCase() };
    for (const key of Object.keys(keys)) {
        const spec = keys[key];
        const raw = layoutMemberValue(obj, spec);
        if (spec.kind === "number") out[key] = numOrNull(raw) === null ? 0 : numOrNull(raw);
        else if (spec.kind === "bool") out[key] = raw === true || raw === "true";
        else out[key] = raw === null || raw === undefined ? "" : String(raw);
    }
    return out;
}

function persistedLayoutValues(doc: any, obj: any, keys: { [key: string]: any }): any {
    const found = findPersistedObjectNode(doc, obj);
    const node = found.node;
    const attr = (key: string): any => { const v = node.GetAttribute(key); return v === null || v === undefined ? null : String(v); };
    const out: any = { id: attr("id") || "", name: attr("name") || "", type: String(node.name) };
    const skipped: string[] = [];
    for (const key of Object.keys(keys)) {
        const spec = keys[key];
        const raw = attr(spec.attr);
        if (raw === null) {
            if (spec.skipIfAbsent || spec.kind === "enum") { skipped.push(key); continue; }
            if (spec.xmlDefault !== undefined) { out[key] = spec.xmlDefault; continue; }
            out[key] = spec.kind === "number" ? 0 : spec.kind === "bool" ? false : "";
        }
        else if (spec.kind === "number") out[key] = Number(raw);
        else if (spec.kind === "bool") out[key] = raw === "true";
        else out[key] = raw;
    }
    return { values: out, file: found.file, skipped };
}

function layoutReaders(keys: { [key: string]: any }): any {
    return {
        memory: (o: any) => typedLayoutValues(o, keys),
        persisted: (d: any, o: any) => persistedLayoutValues(d, o, keys)
    };
}

// Layout fields arrive as flat params alongside the control keys; everything
// outside the reserved set is treated as a field to write.
const LAYOUT_RESERVED_PARAMS = ["target", "save", "verify", "externalReload"];
function layoutFieldSubset(params: any): any {
    const fields: any = {};
    for (const key of Object.keys(params || {}))
        if (LAYOUT_RESERVED_PARAMS.indexOf(key) < 0) fields[key] = params[key];
    return fields;
}

function listLayoutConstant(value: any): string {
    const key = String(value);
    const map: { [k: string]: string } = {
        single_column: "SINGLE_COLUMN", single_row: "SINGLE_ROW",
        flow_horizontal: "FLOW_HZ", flow_vertical: "FLOW_VT", pagination: "PAGINATION"
    };
    const constants: any = (FairyEditor as any).FList || {};
    if (map[key] !== undefined) {
        const resolved = constants[map[key]];
        if (resolved === undefined || resolved === null)
            verificationError("invalid_argument", `编辑器未暴露 FList.${map[key]} 常量`, { stage: "input", layout: key });
        return String(resolved);
    }
    const raw = ["hz", "vt", "flow_hz", "flow_vt", "pagination"];
    if (raw.indexOf(key) >= 0) return key;
    verificationError("invalid_argument", `layout 无效：${key}`, { stage: "input", allowed: Object.keys(map).concat(raw) });
}

function groupLayoutConstant(value: any): string {
    const key = String(value);
    const map: { [k: string]: string } = { horizontal: "HORIZONTAL", vertical: "VERTICAL" };
    const constants: any = (FairyEditor as any).FGroup || {};
    if (map[key] !== undefined) {
        const resolved = constants[map[key]];
        if (resolved === undefined || resolved === null)
            verificationError("invalid_argument", `编辑器未暴露 FGroup.${map[key]} 常量`, { stage: "input", layout: key });
        return String(resolved);
    }
    const raw = ["hz", "vt"];
    if (raw.indexOf(key) >= 0) return key;
    verificationError("invalid_argument", `layout 无效：${key}`, { stage: "input", allowed: Object.keys(map).concat(raw) });
}

function applyTypedLayoutWrite(doc: any, params: any, objectType: string, keys: { [key: string]: any }, values: any): any {
    const obj: any = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    const type = String(obj.objectType || "").toLowerCase();
    if (type !== objectType)
        verificationError("invalid_argument", `目标不是 ${objectType} 对象（实际：${type}）`, { stage: "input", target: targetSummary(obj, params.target) });

    const before = typedLayoutValues(obj, keys);
    const provided = Object.keys(values);
    if (!provided.length)
        verificationError("invalid_argument", "至少需要提供一个布局字段", { stage: "input" });

    // Two passes: every field is validated and coerced first, so a bad trailing
    // field cannot leave the earlier ones half-applied on the document.
    const coerced: { key: string; spec: any; value: any }[] = [];
    for (const key of provided) {
        const spec = keys[key];
        const value = values[key];
        if (!spec) verificationError("unsupported_property", `不支持的布局字段：${key}`, { stage: "input", property: key });
        if (!layoutMemberSupported(obj, spec))
            verificationError("unsupported_property", `当前编辑器不支持写入属性：${spec.attr}`, { stage: "input", property: key });
        switch (key) {
            case "layout":
                coerced.push({ key, spec, value: type === "list" ? listLayoutConstant(value) : groupLayoutConstant(value) });
                break;
            case "selectionMode":
                if (["none", "single", "multiple", "multiple_singleclick"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `selectionMode 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) }); break;
            case "lineGap": case "columnGap": case "mainGridMinSize": case "mainGridIndex": {
                const n = numOrNull(value);
                if (n === null) verificationError("invalid_argument", `${key} 必须是数字`, { stage: "input", property: key });
                coerced.push({ key, spec, value: n }); break;
            }
            case "defaultItem": {
                const url = String(value || "");
                if (url === "") { coerced.push({ key, spec, value: "" }); break; }
                if (url.indexOf("ui://") !== 0)
                    verificationError("invalid_argument", "defaultItem 必须是 ui:// URL", { stage: "input", value: url });
                const item = resolveItem({ url });
                if (String(item.type) !== FairyEditor.FPackageItemType.COMPONENT)
                    verificationError("invalid_argument", "defaultItem 必须引用组件资源", { stage: "input", resourceURL: url });
                coerced.push({ key, spec, value: String(item.GetURL()) });
                break;
            }
            case "autoItemSize": case "foldInvisibleItems": case "clearOnPublish":
            case "scrollItemToViewOnClick": case "advanced": case "excludeInvisibles":
            case "autoSizeDisabled": case "collapsed":
                coerced.push({ key, spec, value: Boolean(value) }); break;
            case "align":
                if (["none", "left", "center", "right"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `align 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) }); break;
            case "vAlign":
                if (["none", "top", "middle", "bottom"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `vAlign 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) }); break;
            case "selectionController": {
                const name = String(value || "");
                if (name && !(doc.content as any).GetController(name))
                    verificationError("invalid_argument", `selectionController 引用的控制器不存在：${name}`, { stage: "input" });
                coerced.push({ key, spec, value: name }); break;
            }
            case "overflow":
                if (["visible", "auto", "hidden", "scroll"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `overflow 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) }); break;
            case "margin":
                coerced.push({ key, spec, value: String(value) }); break;
            default:
                verificationError("unsupported_property", `不支持的布局字段：${key}`, { stage: "input", property: key });
        }
    }
    if (type === "group") {
        const requestedAdvanced = coerced.filter(c => c.key === "advanced").map(c => c.value).pop();
        const willBeAdvanced = requestedAdvanced !== undefined ? Boolean(requestedAdvanced) : Boolean(obj.advanced);
        if (!willBeAdvanced && ["layout", "lineGap", "columnGap", "excludeInvisibles"].some(k => values[k] !== undefined))
            verificationError("invalid_argument", "layout/lineGap/columnGap/excludeInvisibles 仅对 advanced=true 的高级组有效", { stage: "input", target: targetSummary(obj, params.target) });
    }
    for (const entry of coerced) assignLayoutMember(obj, entry.spec, entry.value);

    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = typedLayoutValues(obj, keys);

    const expected: any = { id: obj.id, name: obj.name || "", type };
    for (const key of provided)
        expected[key] = specValueForExpected(key, values[key], after, keys[key]);
    return writeVerification(doc, obj, before, after, params, expected, layoutReaders(keys));
}

// Enum-ish values are normalized to the canonical serialized form only where a
// constant is known; otherwise the post-write readback is used as expected so
// editor-side canonicalization cannot produce a false mismatch.
function specValueForExpected(key: string, requested: any, after: any, spec: any): any {
    // Enum members store the serialized string in the editor object model, but
    // the Editor may still canonicalize differently from what was requested —
    // trust the readback for every enum-kind field.
    if (spec && spec.kind === "enum") return after[key];
    if (spec && spec.kind === "bool") return Boolean(requested);
    if (spec && spec.kind === "number") return numOrNull(requested);
    return requested === undefined || requested === null ? "" : String(requested);
}

// <relation> and <gearDisplay> serialize as child elements of the object node,
// so they get their own flat keyspace: `relation.<targetId>` ("" = parent) and
// `gearDisplay.controller`/`gearDisplay.pages`.
const RELATION_SIDES = ["left", "center", "right", "leftext", "rightext", "width",
    "top", "middle", "bottom", "topext", "bottomext", "height"];

function canonicalSidePair(sidePair: string): string {
    const parts = String(sidePair || "").split(",").map(s => s.trim()).filter(s => s.length);
    parts.sort();
    return parts.join(",");
}

function validateSidePair(sidePair: string, specPath: string): string {
    const parts = String(sidePair || "").split(",").map(s => s.trim()).filter(s => s.length);
    for (const part of parts) {
        const m = /^([a-zA-Z]+)-([a-zA-Z]+)(%?)$/.exec(part);
        if (!m || RELATION_SIDES.indexOf(m[1].toLowerCase()) < 0 || RELATION_SIDES.indexOf(m[2].toLowerCase()) < 0)
            verificationError("invalid_argument", `无效的 relation sidePair：${part}`, { stage: "input", node: specPath });
        const src = m[1].toLowerCase(), tgt = m[2].toLowerCase();
        const horizontal = ["left", "center", "right", "leftext", "rightext", "width"];
        const vertical = ["top", "middle", "bottom", "topext", "bottomext", "height"];
        if ((horizontal.indexOf(src) >= 0) !== (horizontal.indexOf(tgt) >= 0) ||
            (vertical.indexOf(src) >= 0) !== (vertical.indexOf(tgt) >= 0))
            verificationError("invalid_argument", `sidePair 混用了水平与垂直方向：${part}`, { stage: "input", node: specPath });
    }
    return parts.join(",");
}

// A relation entry with an empty sidePair carries no binding semantics; the
// editor still serializes `<relation target="" sidePair=""/>` on untouched
// objects, so empty entries are dropped from comparison on both stages.
function relationsFromXml(node: any): any {
    const out: any = {};
    for (const child of childXmlNodes(node, "relation")) {
        const sidePair = canonicalSidePair(child.GetAttribute("sidePair") || "");
        if (sidePair) out[`relation.${child.GetAttribute("target") || ""}`] = sidePair;
    }
    return out;
}

function relationMemoryValues(obj: any): any {
    const out: any = {};
    const rel = obj.relations;
    if (!rel) return out;
    // Prefer the serialized form so canonicalization matches the XML stage.
    try {
        if (typeof rel.Write === "function") {
            const xml = rel.Write();
            const collect = (n: any) => {
                const sidePair = canonicalSidePair(n.GetAttribute("sidePair") || "");
                if (sidePair) out[`relation.${n.GetAttribute("target") || ""}`] = sidePair;
            };
            if (xml && String(xml.name) === "relation") collect(xml);
            else if (xml) for (const child of childXmlNodes(xml, "relation")) collect(child);
            return out;
        }
    } catch (_) { /* fall through to item iteration */ }
    if (rel.items) {
        for (let i = 0; i < rel.items.Count; i++) {
            const item = rel.items.get_Item(i);
            const targetId = item.target && item.target.id ? String(item.target.id) : "";
            out[`relation.${targetId}`] = canonicalSidePair(item.desc || "");
        }
    }
    return out;
}

function persistedRelationValues(doc: any, obj: any): any {
    const found = findPersistedObjectNode(doc, obj);
    const values = relationsFromXml(found.node);
    values.id = found.node.GetAttribute("id") || "";
    values.name = found.node.GetAttribute("name") || "";
    values.type = String(found.node.name);
    return { values, file: found.file };
}

function relationReaders(): any {
    return {
        memory: (o: any) => {
            const out = relationMemoryValues(o);
            out.id = o.id || ""; out.name = o.name || ""; out.type = String(o.objectType || "unknown").toLowerCase();
            return out;
        },
        persisted: persistedRelationValues
    };
}

function setRelation(params: any): any {
    const doc = getActiveDocument();
    const obj: any = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    if (obj === doc.content)
        verificationError("invalid_argument", "不支持对文档根组件设置 relation", { stage: "input", target: targetSummary(obj, params.target) });
    if (!Array.isArray(params.relations))
        verificationError("invalid_argument", "relations 必须是数组", { stage: "input" });

    const specs = params.relations.map((spec: any, i: number) => {
        if (!spec || typeof spec !== "object")
            verificationError("invalid_argument", `relations[${i}] 必须是对象`, { stage: "input" });
        let sidePair = "";
        if (spec.sidePair !== undefined) sidePair = validateSidePair(String(spec.sidePair), `relations[${i}]`);
        else if (Array.isArray(spec.pairs)) {
            const parts = spec.pairs.map((p: any, j: number) => {
                if (!p || typeof p !== "object" || !p.source || !p.target)
                    verificationError("invalid_argument", `relations[${i}].pairs[${j}] 需要 source 与 target`, { stage: "input" });
                return `${String(p.source).toLowerCase()}-${String(p.target).toLowerCase()}${p.percent ? "%" : ""}`;
            });
            sidePair = validateSidePair(parts.join(","), `relations[${i}]`);
        }
        else verificationError("invalid_argument", `relations[${i}] 需要 sidePair 或 pairs`, { stage: "input" });
        let targetObj: any = null;
        if (spec.target !== undefined && spec.target !== null && spec.target !== "") {
            targetObj = resolveObject(doc, spec.target);
            if (targetObj === obj)
                verificationError("invalid_argument", `relations[${i}] 不能把对象自身作为 target`, { stage: "input" });
        }
        return { targetObj, sidePair };
    });

    const before = relationMemoryValues(obj);
    const rel = obj.relations;
    if (!rel) verificationError("unsupported_property", "目标对象不支持 relation", { stage: "input", target: targetSummary(obj, params.target) });
    const el = obj.docElement;
    let applied = false;
    if (el && typeof el.UpdateRelations === "function") {
        // Preferred path: replace the whole relation set through the serialized
        // <relations> document (same shape FRelations.Write() emits). Direct
        // FRelations.Reset()+AddItem() bypasses the document model and leaves
        // the doc stuck modified on 6.1.4.
        const inner = specs.map((s: any) =>
            `<relation target="${s.targetObj && s.targetObj.id ? String(s.targetObj.id) : ""}" sidePair="${s.sidePair}"/>`).join("");
        try {
            el.UpdateRelations(new (CS as any).FairyGUI.Utils.XML(`<relations>${inner}</relations>`));
            applied = true;
        } catch (_) { applied = false; }
    }
    if (!applied && el && typeof el.SetRelation === "function") {
        try {
            const wantedIds: { [id: string]: boolean } = {};
            for (const spec of specs)
                wantedIds[spec.targetObj && spec.targetObj.id ? String(spec.targetObj.id) : ""] = true;
            if (rel.items && typeof el.RemoveRelation === "function") {
                for (let i = rel.items.Count - 1; i >= 0; i--) {
                    const oldItem = rel.items.get_Item(i);
                    const oldId = oldItem.target && oldItem.target.id ? String(oldItem.target.id) : "";
                    if (!wantedIds[oldId]) el.RemoveRelation(oldItem.target);
                }
            }
            for (const spec of specs) el.SetRelation(spec.targetObj, spec.sidePair);
            applied = true;
        } catch (_) { applied = false; }
    }
    if (!applied) {
        if (typeof rel.Reset === "function") rel.Reset();
        else if (rel.items) while (rel.items.Count > 0) rel.RemoveItem(rel.items.get_Item(0));
        for (const spec of specs) rel.AddItem(spec.targetObj, spec.sidePair);
    }
    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = relationMemoryValues(obj);

    // Requested state (normalized) must match what the editor actually applied;
    // after-readback supplies the canonical sidePair encoding.
    const wanted: any = {};
    for (const spec of specs)
        wanted[`relation.${spec.targetObj && spec.targetObj.id ? String(spec.targetObj.id) : ""}`] = canonicalSidePair(spec.sidePair);
    const actual: any = {};
    for (const key of Object.keys(after)) if (key.indexOf("relation.") === 0) actual[key] = after[key];
    const rejection = diffExpectedValues(wanted, actual);
    if (rejection.length)
        verificationError("editor_rejected", "编辑器未按请求写入 relation", { stage: "editor", target: targetSummary(obj, params.target), expected: wanted, actual, differences: rejection });

    const expected = Object.assign({ id: obj.id, name: obj.name || "", type: String(obj.objectType || "").toLowerCase() }, actual);
    return writeVerification(doc, obj, before, after, params, expected, relationReaders());
}

// GearDisplay rides on gear index 0 (FairyGUI gear order: Display=0, XY=1, ...).
const GEAR_INDEX_DISPLAY = 0;

function normalizeGearPages(pages: any): string {
    if (pages === undefined || pages === null) return "";
    const list = Array.isArray(pages) ? pages.map(String) : String(pages).split(",");
    const cleaned = list.map(s => s.trim()).filter(s => s.length);
    cleaned.sort();
    return cleaned.join(",");
}

// FObject.GetGear returns FairyEditor.Framework.Gears.IGear — an empty marker
// interface — so the live gear state must be read through WriteGears()'s
// serialized XML instead of member access.
function gearValuesFromXml(xml: any, out: any): any {
    const collect = (n: any) => {
        out["gearDisplay.controller"] = String(n.GetAttribute("controller") || "");
        out["gearDisplay.pages"] = normalizeGearPages(n.GetAttribute("pages") || "");
    };
    if (xml && String(xml.name) === "gearDisplay") collect(xml);
    else if (xml) for (const child of childXmlNodes(xml, "gearDisplay")) { collect(child); break; }
    return out;
}

function gearMemoryValues(obj: any): any {
    const out: any = { "gearDisplay.controller": "", "gearDisplay.pages": "" };
    try {
        if (typeof obj.WriteGears === "function")
            gearValuesFromXml(obj.WriteGears(), out);
        else if (typeof obj.GetGear === "function") {
            // Mock-host / older-API fallback via member access.
            const gear = obj.GetGear(GEAR_INDEX_DISPLAY);
            if (gear) {
                const controller = gear.controller;
                if (controller) out["gearDisplay.controller"] = String(controller.name || controller);
                if (gear.pages) out["gearDisplay.pages"] = normalizeGearPages(Array.from(gear.pages as any) || []);
            }
        }
    } catch (_) { /* gear layer not readable; report empty */ }
    out.id = obj.id || ""; out.name = obj.name || ""; out.type = String(obj.objectType || "unknown").toLowerCase();
    return out;
}

function persistedGearValues(doc: any, obj: any): any {
    const found = findPersistedObjectNode(doc, obj);
    const nodes = childXmlNodes(found.node, "gearDisplay");
    const node = nodes.length ? nodes[0] : null;
    const values: any = {
        "gearDisplay.controller": node ? String(node.GetAttribute("controller") || "") : "",
        "gearDisplay.pages": node ? normalizeGearPages(node.GetAttribute("pages") || "") : "",
        id: found.node.GetAttribute("id") || "",
        name: found.node.GetAttribute("name") || "",
        type: String(found.node.name)
    };
    return { values, file: found.file };
}

function gearReaders(): any {
    return { memory: gearMemoryValues, persisted: persistedGearValues };
}

function resolveController(doc: any, name: string): any {
    const content: any = doc.content;
    if (!content || typeof content.GetController !== "function") return null;
    return content.GetController(name);
}

function setGearDisplay(params: any): any {
    const doc = getActiveDocument();
    const obj: any = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    if (params.controller === undefined)
        verificationError("invalid_argument", "缺少 controller 字段（null/空字符串表示清除联动）", { stage: "input" });

    const controllerName = String(params.controller || "");
    let controller: any = null;
    if (controllerName) {
        controller = resolveController(doc, controllerName);
        if (!controller)
            verificationError("target_not_found", `控制器不存在：${controllerName}`, { stage: "input", controller: controllerName });
    }
    let pagesCsv: string | null = null;
    if (params.pages !== undefined) {
        if (!controller)
            verificationError("invalid_argument", "清除联动时不允许携带 pages", { stage: "input" });
        pagesCsv = normalizeGearPages(params.pages);
        if (pagesCsv) {
            for (const pageId of pagesCsv.split(",")) {
                const ok = controller.HasPageId && controller.HasPageId(pageId);
                const okName = !ok && controller.HasPageName && controller.HasPageName(pageId);
                if (!ok && !okName)
                    verificationError("invalid_argument", `pages 包含控制器 ${controllerName} 不存在的页面：${pageId}`, { stage: "input", controller: controllerName, page: pageId });
            }
            // Accept page names too: resolve to ids before writing.
            const resolved: string[] = [];
            for (const pageId of pagesCsv.split(",")) {
                if (controller.HasPageId && controller.HasPageId(pageId)) resolved.push(pageId);
                else if (controller.GetPages) {
                    const pageList = controller.GetPages();
                    for (let i = 0; i < pageList.Count; i++) {
                        const p = pageList.get_Item(i);
                        if (String(p.name) === pageId) { resolved.push(String(p.id)); break; }
                    }
                }
            }
            resolved.sort();
            pagesCsv = resolved.join(",");
        }
    }
    // Unbinding the controller leaves a controller-less gear with dangling page
    // references; clear the pages as well so the gear is fully removed.
    if (!controllerName && params.pages === undefined) pagesCsv = "";

    const before = gearMemoryValues(obj);
    const el = obj.docElement;
    let applied = false;
    if (el && typeof el.UpdateGears === "function") {
        // Preferred path: rewrite the whole <gears> set through the document
        // model. Every non-gearDisplay child is copied across unchanged so the
        // update never wipes gearXY/gearSize/etc. the caller did not touch.
        try {
            const XmlType = (CS as any).FairyGUI.Utils.XML;
            const gears = new XmlType("<gears/>");
            if (typeof obj.WriteGears === "function") {
                const current = obj.WriteGears();
                if (current && String(current.name) !== "gearDisplay") {
                    for (let i = 0; i < current.elements.Count; i++) {
                        const child = current.elements.get_Item(i);
                        if (String(child.name) === "gearDisplay") continue;
                        gears.AppendChild(new XmlType(String(child.ToXMLString())));
                    }
                }
            }
            if (controllerName) {
                const pagesAttr = pagesCsv === null ? (before["gearDisplay.pages"] || "") : pagesCsv;
                const escAttr = (v: string) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
                gears.AppendChild(new XmlType(`<gearDisplay controller="${escAttr(controllerName)}" pages="${escAttr(pagesAttr)}"/>`));
            }
            el.UpdateGears(gears);
            applied = true;
        } catch (_) { applied = false; }
    }
    if (!applied && el && typeof el.SetGearProperty === "function") {
        try {
            el.SetGearProperty(GEAR_INDEX_DISPLAY, "controller", controller);
            if (pagesCsv !== null) el.SetGearProperty(GEAR_INDEX_DISPLAY, "pages", pagesCsv);
            applied = true;
        } catch (_) { applied = false; }
    }
    if (!applied) {
        const gear = typeof obj.GetGear === "function" ? obj.GetGear(GEAR_INDEX_DISPLAY, true) : null;
        if (!gear)
            verificationError("unsupported_property", "目标对象不支持 gearDisplay 写入路径", { stage: "editor", target: targetSummary(obj, params.target) });
        try { gear.controller = controller; }
        catch (_) {
            try { gear.controller = controllerName || null; }
            catch (error) {
                verificationError("editor_rejected", `gearDisplay.controller 赋值失败：${String(error)}`, { stage: "editor", target: targetSummary(obj, params.target) });
            }
        }
        if (pagesCsv !== null) {
            try { gear.pages = pagesCsv ? pagesCsv.split(",") : []; }
            catch (_) {
                try { gear.pages = pagesCsv; }
                catch (error) {
                    verificationError("editor_rejected", `gearDisplay.pages 赋值失败：${String(error)}`, { stage: "editor", target: targetSummary(obj, params.target) });
                }
            }
        }
    }
    doc.SetModified(true);
    doc.RefreshInspectors();
    if (typeof obj.CheckGearDisplay === "function") { try { obj.CheckGearDisplay(); } catch (_) { } }
    const after = gearMemoryValues(obj);

    const wanted: any = { "gearDisplay.controller": controllerName, "gearDisplay.pages": pagesCsv === null ? after["gearDisplay.pages"] : pagesCsv };
    const actual: any = { "gearDisplay.controller": after["gearDisplay.controller"], "gearDisplay.pages": after["gearDisplay.pages"] };
    const rejection = diffExpectedValues(wanted, actual);
    if (rejection.length)
        verificationError("editor_rejected", "编辑器未按请求写入 gearDisplay", { stage: "editor", target: targetSummary(obj, params.target), expected: wanted, actual, differences: rejection });

    const expected = Object.assign({ id: obj.id, name: obj.name || "", type: String(obj.objectType || "").toLowerCase() }, actual);
    return writeVerification(doc, obj, before, after, params, expected, gearReaders());
}

// ---------- Controllers ----------

function controllerMemoryValues(doc: any, name: string): any {
    const c = resolveController(doc, name);
    if (!c) return { name, present: false, pageCount: null, pageNames: null, selectedIndex: null };
    let names: string[] = [];
    try {
        // GetPageNames() returns "id:name" entries in the live editor; the real
        // page names (matching the serialized form) live on the page objects.
        const list = c.GetPages ? c.GetPages() : null;
        if (list) for (let i = 0; i < list.Count; i++) names.push(String(list.get_Item(i).name));
        else {
            const fallback = c.GetPageNames ? c.GetPageNames() : null;
            if (fallback) for (let i = 0; i < fallback.Count; i++) names.push(String(fallback.get_Item(i)));
        }
    } catch (_) { }
    return {
        name, present: true,
        pageCount: numOrNull(c.pageCount),
        pageNames: names.join(","),
        selectedIndex: numOrNull(c.selectedIndex)
    };
}

function persistedControllerValues(doc: any, name: string): any {
    const parsed = documentXml(doc, null);
    let node: any = null;
    for (let i = 0; i < parsed.xml.elements.Count; i++) {
        const candidate = parsed.xml.elements.get_Item(i);
        if (String(candidate.name) === "controller" && String(candidate.GetAttribute("name") || "") === name) {
            if (node) verificationError("persistence_failed", "XML 中存在同名 Controller", { stage: "xml", name });
            node = candidate;
        }
    }
    if (!node) return { values: { name, present: false, pageCount: null, pageNames: null, selectedIndex: null }, file: parsed.file };
    // pages serializes as alternating id,name pairs.
    const rawPages = String(node.GetAttribute("pages") || "").split(",").filter((s: string) => s.length);
    const names: string[] = [];
    for (let i = 1; i < rawPages.length; i += 2) names.push(rawPages[i]);
    const values: any = {
        name, present: true,
        pageCount: names.length,
        pageNames: names.join(","),
        selectedIndex: numOrNull(node.GetAttribute("selected"))
    };
    return { values, file: parsed.file };
}

function externalReloadVerifyController(doc: any, name: string, expected: any, state: any): any {
    const rr = reloadDocument(doc, {});
    const values = compareVerification(expected, controllerMemoryValues(rr.doc, name), "reload", { id: name, name, objectType: "controller" });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, values };
}

// Same ladder as transitionWriteVerification: the controller lives on the
// component rather than in the display list, so every stage re-reads it by name.
function controllerWriteVerification(doc: any, name: string, params: any, expected: any): any {
    const target = { id: null, name, path: null, type: "controller" };
    const stub = { id: name, name, objectType: "controller" };
    validateReloadOptions(params, target);
    const memory = controllerMemoryValues(doc, name);
    compareVerification(expected, memory, "editor", stub);

    let saved = false;
    if (params.save) {
        try { doc.Save(); }
        catch (error) { verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected }); }
        saved = doc.isModified === false;
        if (!saved) verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }

    let xmlReadback = false;
    let xmlFile: any = null;
    let xmlValues: any = null;
    if (saved && params.verify !== false) {
        const disk = persistedControllerValues(doc, name);
        xmlFile = disk.file;
        xmlValues = disk.values;
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }

    const state: any = {};
    let reloaded: any = null;
    if (xmlReadback && params.externalReload)
        reloaded = externalReloadVerifyController(doc, name, expected, state);
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: memory, xml: xmlValues, file: xmlFile, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    return {
        state, saved, persisted: strength !== NONE_STRENGTH, strength, verification,
        note: `${strengthNote(verification, saved, "仅验证 Controller 名称、页面集与选中页；")}失败不自动回滚。`
    };
}

function setController(params: any): any {
    const doc = getActiveDocument();
    const name = String(params.name || "");
    if (!name) verificationError("invalid_argument", "缺少控制器 name", { stage: "input" });
    const content: any = doc.content;
    const target = { id: null, name, path: null, type: "controller" };
    validateReloadOptions(params, target);

    let controller = resolveController(doc, name);
    const removing = params.remove === true;
    if (removing) {
        if (!controller) verificationError("target_not_found", `控制器不存在：${name}`, { stage: "input" });
        const before = controllerMemoryValues(doc, name);
        content.RemoveController(controller);
        doc.SetModified(true);
        doc.RefreshInspectors();
        const verification = controllerWriteVerification(doc, name, params, { name, present: false });
        return {
            ok: true, target, before, removed: before,
            documentModified: Boolean((verification.state && verification.state.doc || doc).isModified),
            saved: verification.saved, persisted: verification.persisted, strength: verification.strength,
            verification: verification.verification, note: verification.note
        };
    }

    if (!controller) {
        if (!params.create)
            verificationError("target_not_found", `控制器不存在：${name}（创建需传 create:true）`, { stage: "input" });
        controller = new (CS as any).FairyEditor.FController();
        controller.name = name;
        content.AddController(controller, false);
    }
    const before = controllerMemoryValues(doc, name);

    if (params.pages !== undefined) {
        if (!Array.isArray(params.pages))
            verificationError("invalid_argument", "pages 必须是页面名数组（整体替换页面集）", { stage: "input" });
        const pageNames = params.pages.map((p: any) => String(p));
        if (pageNames.length !== new Set(pageNames).size)
            verificationError("invalid_argument", "pages 存在重复页面名", { stage: "input" });
        // SetPages regenerates page ids; warn callers that gearDisplay page
        // references by id must be re-checked after a full page replacement.
        try { controller.SetPages(pageNames); }
        catch (_) {
            // Puerts may not coerce a JS array into IList<string>; fall back to
            // rebuilding the page set one entry at a time.
            while (controller.pageCount > 0) controller.RemovePageAt(0);
            for (const pageName of pageNames) controller.AddPage(pageName);
        }
    }
    if (params.addPages !== undefined) {
        if (!Array.isArray(params.addPages))
            verificationError("invalid_argument", "addPages 必须是页面名数组", { stage: "input" });
        for (const pageName of params.addPages) controller.AddPage(String(pageName));
    }
    if (params.selectedIndex !== undefined) {
        const index = Number(params.selectedIndex);
        if (!Number.isInteger(index) || index < 0)
            verificationError("invalid_argument", "selectedIndex 必须是非负整数", { stage: "input" });
        controller.SetSelectedIndex(index);
    }
    if (params.selectedPage !== undefined) {
        const pageName = String(params.selectedPage);
        if (controller.HasPageName && !controller.HasPageName(pageName))
            verificationError("invalid_argument", `selectedPage 页面不存在：${pageName}`, { stage: "input", controller: name });
        controller.selectedPage = pageName;
    }
    if (params.exported !== undefined) controller.exported = Boolean(params.exported);
    if (params.autoRadioGroupDepth !== undefined) controller.autoRadioGroupDepth = Boolean(params.autoRadioGroupDepth);
    if (params.homePage !== undefined) controller.homePage = String(params.homePage);

    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = controllerMemoryValues(doc, name);

    const expected: any = { name, present: true, pageCount: after.pageCount, pageNames: after.pageNames };
    if (params.selectedIndex !== undefined || params.selectedPage !== undefined)
        expected.selectedIndex = after.selectedIndex;
    const verification = controllerWriteVerification(doc, name, params, expected);
    return {
        ok: true, target, before, after,
        documentModified: Boolean((verification.state && verification.state.doc || doc).isModified),
        saved: verification.saved, persisted: verification.persisted, strength: verification.strength,
        verification: verification.verification, note: verification.note
    };
}

function listControllers(): any {
    const doc = getActiveDocument();
    const content: any = doc.content;
    const list: any[] = [];
    if (content && content.controllers) {
        for (let i = 0; i < content.controllers.Count; i++) {
            const c = content.controllers.get_Item(i);
            list.push(controllerMemoryValues(doc, String(c.name)));
        }
    }
    return { ok: true, document: describeDocument(doc), controllers: list };
}

// Transitions and package items live outside the display list, so the
// object-centric verifyObject path cannot check them. The helpers below keep
// the same save → disk readback → optional reload ladder, but verify
// <transition> nodes in the component XML and resource entries in package.xml.

function publicTransitionItemCount(transition: any): number {
    let count = 0;
    for (let i = 0; i < transition.items.Count; i++)
        if (!isSyntheticTweenEndpoint(transition.items.get_Item(i))) count++;
    return count;
}

function transitionMemoryValues(doc: any, name: string): any {
    const transitions = doc && doc.content ? (doc.content as any).transitions : null;
    const transition = transitions && typeof transitions.GetItem === "function" ? transitions.GetItem(name) : null;
    if (!transition)
        return { name, present: false, itemCount: null };
    return { name, present: true, itemCount: publicTransitionItemCount(transition) };
}

// Transition nodes serialize as direct <component> children; tween end
// keyframes fold into a single <item> element, matching the public
// (non-synthetic) item count exposed to callers.
function persistedTransitionValues(doc: any, name: string): any {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml" });
    const XmlType = (CS as any).FairyGUI.Utils.XML;
    const xml = new XmlType(String(IOFile.ReadAllText(item.file)));
    let node: any = null;
    for (let i = 0; i < xml.elements.Count; i++) {
        const candidate = xml.elements.get_Item(i);
        if (String(candidate.name) === "transition" && String(candidate.GetAttribute("name") || "") === name) {
            if (node)
                verificationError("persistence_failed", "XML 中存在同名 Transition", { stage: "xml", name });
            node = candidate;
        }
    }
    if (!node)
        return { values: { name, present: false, itemCount: null }, file: String(item.file) };
    let itemCount = 0;
    for (let i = 0; i < node.elements.Count; i++)
        if (String(node.elements.get_Item(i).name) === "item")
            itemCount++;
    return { values: { name, present: true, itemCount }, file: String(item.file) };
}

function externalReloadVerifyTransition(doc: any, name: string, expected: any, state: any): any {
    const rr = reloadDocument(doc, {});
    const values = compareVerification(expected, transitionMemoryValues(rr.doc, name), "reload", { id: name, name, objectType: "transition" });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, values };
}

// Mirrors writeVerification for transition mutations: the target lives in
// doc.content.transitions rather than the display list, so each stage re-reads
// the transition set by name instead of re-locating a display object.
function transitionWriteVerification(doc: any, name: string, expectPresent: boolean, params: any): any {
    const target = { id: null, name, path: null, type: "transition" };
    const stub = { id: name, name, objectType: "transition" };
    // Guard repeated here so a future caller cannot skip the precondition.
    validateReloadOptions(params, target);
    const memory = transitionMemoryValues(doc, name);
    const expected: any = { name, present: expectPresent };
    if (expectPresent && memory.present)
        expected.itemCount = memory.itemCount;
    compareVerification(expected, memory, "editor", stub);

    let saved = false;
    if (params.save) {
        try { doc.Save(); }
        catch (error) { verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected }); }
        saved = doc.isModified === false;
        if (!saved) verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }

    let xmlReadback = false;
    let xmlFile: any = null;
    let xmlValues: any = null;
    if (saved && params.verify !== false) {
        const disk = persistedTransitionValues(doc, name);
        xmlFile = disk.file;
        xmlValues = disk.values;
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }

    const state: any = {};
    let reloaded: any = null;
    if (xmlReadback && params.externalReload)
        reloaded = externalReloadVerifyTransition(doc, name, expected, state);
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: memory, xml: xmlValues, file: xmlFile, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    return {
        state, saved, persisted: strength !== NONE_STRENGTH, strength, verification,
        note: `${strengthNote(verification, saved, "仅验证 Transition 名称与公开条目数；")}失败不自动回滚。`
    };
}

// Package writes (create/import/movieclip) are verified against the package
// manifest: package.xml is what the editor actually persists for membership,
// and for asset-backed types external reload unloads and reloads the asset
// from disk. Components and deletions have no honest reload primitive, so
// their strength caps at disk.
const PACKAGE_ASSET_RELOAD_TYPES = ["image", "sound", "font", "movieclip"];

function validatePackageWriteOptions(params: any, itemType: string, allowReload: boolean): void {
    validateReloadOptions(params, null);
    if (params.externalReload && !allowReload)
        verificationError("invalid_argument", `external reload 暂不支持该操作：仅 image/sound/font/movieclip 包资源可通过 asset 重新加载验证（当前：${itemType}）`, { stage: "input" });
}

function persistedPackageItemValues(pkg: any, itemId: string): any {
    const file = IOPath.Combine(String(pkg.basePath || ""), "package.xml");
    if (!IOFile.Exists(file))
        verificationError("persistence_failed", "无法读取 package.xml", { stage: "xml", file });
    const XmlType = (CS as any).FairyGUI.Utils.XML;
    let xml: any = null;
    try {
        xml = new XmlType(String(IOFile.ReadAllText(file)));
    } catch (error) {
        verificationError("persistence_failed", "package.xml 解析失败", { stage: "xml", file, reason: String(error) });
    }
    const resources = xml.GetNode("resources");
    let node: any = null;
    if (resources) {
        for (let i = 0; i < resources.elements.Count; i++) {
            const candidate = resources.elements.get_Item(i);
            if (String(candidate.GetAttribute("id") || "") === String(itemId)) {
                if (node)
                    verificationError("persistence_failed", "package.xml 中资源 ID 重复", { stage: "xml", id: itemId });
                node = candidate;
            }
        }
    }
    if (!node)
        return { values: { present: false }, file };
    return { values: { present: true, id: String(node.GetAttribute("id") || ""), name: packageItemNameKey(node.GetAttribute("name") || ""), type: String(node.name) }, file };
}

// FPackageItem.name 的扩展名归一化时机不一致（MovieClip 创建时可能不带
// 扩展名，package.xml 的 name 属性总是文件名带扩展名）。名称比对统一按
// 去掉扩展名的口径进行，id 才是稳定身份。
function packageItemNameKey(name: any): string {
    return String(IOPath.GetFileNameWithoutExtension(String(name || "")) || "");
}

function packageItemMemoryValues(pkg: any, ref: any): any {
    let found: any = null;
    if (ref.url) found = App.project.GetItemByURL(ref.url);
    if (!found && ref.id && typeof pkg.GetItem === "function") found = pkg.GetItem(ref.id);
    const values: any = { present: Boolean(found) };
    if (found) {
        values.id = String(found.id);
        values.name = packageItemNameKey(found.name);
        values.type = String(found.type);
        values.exported = Boolean(found.exported);
        values.file = found.file ? String(found.file) : null;
        if (found.file) values.fileExists = IOFile.Exists(String(found.file));
    }
    return values;
}

function packageItemAssetReload(item: any, target: any): any {
    if (typeof item.UnloadAsset !== "function" || typeof item.GetAsset !== "function")
        verificationError("persistence_failed", "资源不支持 asset 重新加载，无法执行 external reload", { stage: "reload", target });
    try { item.UnloadAsset(); }
    catch (error) { verificationError("persistence_failed", "external reload 卸载资源 asset 失败", { stage: "reload", target, reason: String(error) }); }
    let asset: any = null;
    try { asset = item.GetAsset(); }
    catch (error) { verificationError("persistence_failed", "external reload 重新加载资源失败", { stage: "reload", target, reason: String(error) }); }
    if (!asset) verificationError("persistence_failed", "external reload 后资源 asset 为空", { stage: "reload", target });
    return { performed: true, strategy: "assetReload" };
}

// ref: { id, url, name, type, path, present, file, checkFile } — captured by the
// caller after mutation (or before deletion, for absent checks). checkFile asks
// the verification to hard-fail when the item's backing file is missing.
function writePackageVerification(pkg: any, ref: any, params: any): any {
    const expectPresent = ref.present !== false;
    const target = { id: ref.id || null, name: ref.name || null, path: ref.path || null, type: ref.type || "packageItem", url: ref.url || null };
    const stub = { id: ref.id, name: ref.name, objectType: ref.type || "packageItem" };
    const expected: any = { present: expectPresent };
    if (expectPresent) {
        expected.id = String(ref.id);
        if (ref.name !== undefined) expected.name = packageItemNameKey(ref.name);
        if (ref.checkFile) expected.fileExists = true;
    }
    const memory = packageItemMemoryValues(pkg, ref);
    compareVerification(expected, memory, "editor", stub);

    let saved = false;
    if (params.save) {
        try {
            if (typeof pkg.EnsureOpen === "function") pkg.EnsureOpen();
            pkg.Save();
            App.project.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存包或工程失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = true;
    }

    let xmlReadback = false;
    let xmlFile: any = null;
    let xmlValues: any = null;
    if (saved && params.verify !== false) {
        const disk = persistedPackageItemValues(pkg, String(ref.id));
        xmlFile = disk.file;
        xmlValues = disk.values;
        if (ref.file !== undefined && ref.file !== null)
            xmlValues.file = ref.file;
        if (expectPresent && ref.checkFile)
            xmlValues.fileExists = IOFile.Exists(String(ref.file));
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }

    let reloaded: any = null;
    if (xmlReadback && params.externalReload) {
        const found = ref.url ? App.project.GetItemByURL(ref.url) : null;
        if (!found)
            verificationError("persistence_failed", "external reload 需要存活资源句柄", { stage: "reload", target });
        reloaded = packageItemAssetReload(found, target);
    }
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: memory, xml: xmlValues, file: xmlFile, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    return {
        ok: true, target, saved, persisted: strength !== NONE_STRENGTH, strength, verification,
        note: `${strengthNote(verification, saved, "包资源验证覆盖 package.xml 条目与资源文件；")}失败不自动回滚。`
    };
}

function packageWriteResult(result: any, pkg: any, ref: any, params: any): any {
    const verified = writePackageVerification(pkg, ref, params);
    result.requiresSave = !verified.saved;
    return Object.assign(result, verified);
}

function packageItemRef(item: any, type: string, folderPath: string, checkFile: boolean): any {
    return {
        id: String(item.id),
        url: String(item.GetURL()),
        name: String(item.name),
        type,
        path: folderPath,
        present: true,
        file: item.file ? String(item.file) : null,
        checkFile
    };
}

function replaceObjectResource(params: any): any {
    const doc = getActiveDocument();
    let obj: any = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    const type = String(obj.objectType || "").toLowerCase();
    if (["image", "loader"].indexOf(type) < 0 || params.state)
        verificationError("unsupported_property", "可信资源替换目前仅支持 Image/Loader；Button 状态请使用专用 API", { stage: "input" });
    const url = String(params.resourceURL || params.url || "").trim();
    if (url.indexOf("ui://") !== 0) verificationError("invalid_argument", "resourceURL 必须是 ui:// URL", { stage: "input" });
    const resource = resolveItem({ url });
    if (resource.type !== FairyEditor.FPackageItemType.IMAGE || (params.expectedType && String(params.expectedType).toLowerCase() !== "image"))
        verificationError("invalid_argument", "本切片的资源类型必须是 image", { stage: "input", resourceURL: url });
    const canonicalUrl = String(resource.GetURL());
    const before = verifiedObjectValues(obj);
    const expected: any = { id: before.id, name: before.name, type, resourceURL: canonicalUrl };
    const preserveSize = params.preserveSize !== false;
    if (preserveSize) { expected.width = obj.width; expected.height = obj.height; }
    if (before.resourceURL !== canonicalUrl) {
        if (type === "loader") obj.url = canonicalUrl;
        else {
            doc.SetSelection(obj);
            doc.ReplaceSelection(canonicalUrl);
            // ReplaceSelection can invalidate the old object reference. Re-resolve by stable ID.
            obj = resolveObject(doc, { id: before.id });
        }
        if (preserveSize) { obj.width = expected.width; obj.height = expected.height; }
        doc.SetModified(true);
        doc.RefreshInspectors();
    }
    return writeVerification(doc, obj, before, verifiedObjectValues(obj), params, expected);
}

function colorHex(value: any): any {
    if (value === null || value === undefined) return null;
    const c: any = value;
    const channel = (v: any) => Math.max(0, Math.min(255, Math.round(Number(v) * 255)));
    if (c.r === undefined || c.g === undefined || c.b === undefined) return null;
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    const alpha = c.a === undefined ? 255 : channel(c.a);
    return `#${hex(channel(c.r))}${hex(channel(c.g))}${hex(channel(c.b))}${alpha < 255 ? hex(alpha) : ""}`.toUpperCase();
}

function textStyle(obj: any): any {
    const value: any = {};
    ["font", "fontSize", "align", "verticalAlign", "autoSize", "lineSpacing", "letterSpacing", "stroke", "shadow", "width", "height"].forEach(k => { if (obj[k] !== undefined) value[k] = obj[k]; });
    if (obj.leading !== undefined) value.lineGap = Number(obj.leading);
    if (obj.verticalAlign !== undefined) value.vAlign = String(obj.verticalAlign);
    if (obj.color !== undefined) value.color = colorHex(obj.color);
    if (obj.strokeColor !== undefined) value.strokeColor = colorHex(obj.strokeColor);
    if (obj.shadowColor !== undefined) value.shadowColor = colorHex(obj.shadowColor);
    return value;
}

function getTextStyle(params: any): any {
    const doc = getActiveDocument();
    const obj: any = resolveObject(doc, params.target);
    const type = String(obj.objectType || "").toLowerCase();
    if (type.indexOf("text") < 0 && type.indexOf("rich") < 0) throw new Error("目标不是文本对象");
    return { ok: true, target: targetSummary(obj, params.target), style: textStyle(obj) };
}

function setTextStyle(params: any): any {
    const doc = getActiveDocument();
    const obj: any = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    const type = String(obj.objectType || "").toLowerCase();
    if (type.indexOf("text") < 0 && type.indexOf("rich") < 0) throw new Error("目标不是文本对象");
    const style = validateExpectations(params.style);
    for (const key of Object.keys(style)) {
        if (VERIFIED_TEXT_KEYS.indexOf(key) < 0) verificationError("unsupported_property", `不支持文本样式：${key}`, { stage: "input" });
        if (["fontSize", "lineGap", "letterSpacing", "width", "height", "x", "y"].indexOf(key) >= 0) {
            if (typeof style[key] !== "number") verificationError("invalid_argument", `${key} 必须是数字`, { stage: "input" });
            numberValue(style[key], key, ["fontSize", "width", "height"].indexOf(key) >= 0 ? 0 : -10000, 10000);
        } else if (typeof style[key] !== "string") verificationError("invalid_argument", `${key} 必须是字符串`, { stage: "input" });
    }
    const enums: any = { align: ["left", "center", "right"], vAlign: ["top", "middle", "bottom"], autoSize: ["none", "both", "height", "shrink"] };
    for (const key of Object.keys(enums)) if (style[key] !== undefined && enums[key].indexOf(style[key]) < 0)
        verificationError("invalid_argument", `${key} 枚举值无效`, { stage: "input" });
    if (style.font && style.font.indexOf("ui://") === 0) {
        const font = resolveItem({ url: style.font });
        if (font.type !== FairyEditor.FPackageItemType.FONT) verificationError("invalid_argument", "font 必须引用字体资源", { stage: "input" });
        style.font = String(font.GetURL());
    }
    const before = textStyle(obj);
    const aliases: any = { vAlign: "verticalAlign", lineGap: "leading" };
    for (const key of Object.keys(style)) obj[aliases[key] || key] = key === "color" ? unityColor(style[key], "color") : style[key];
    doc.SetModified(true);
    doc.RefreshInspectors();
    const expected = Object.assign({ id: obj.id, type }, style);
    return writeVerification(doc, obj, before, textStyle(obj), params, expected);
}

// `expected` may describe a subtree rather than a flat property map. Reserved
// structural keys: `children` (array of node specs), `childrenMode`
// ("exact" — default, positional full coverage; "subset" — each spec locates a
// distinct child by id/name/index, extras allowed) and `index` (positional
// locator inside subset specs). Every other key is a property assertion
// validated against VERIFIED_KEYS, so id/name/type double as locator and
// assertion.
const TREE_STRUCTURAL_KEYS = ["children", "childrenMode", "index"];

function isTreeSpec(expected: any): boolean {
    return Boolean(expected) && typeof expected === "object" && !Array.isArray(expected) &&
        (expected.children !== undefined || expected.childrenMode !== undefined || expected.index !== undefined);
}

function validateTreeSpec(spec: any, specPath: string): any {
    if (!spec || typeof spec !== "object" || Array.isArray(spec))
        verificationError("invalid_argument", `expected 树节点必须是对象：${specPath}`, { stage: "input", node: specPath });
    const flat: any = {};
    for (const key of Object.keys(spec))
        if (TREE_STRUCTURAL_KEYS.indexOf(key) < 0) flat[key] = spec[key];
    const node: any = { specPath, assert: validateExpectationsMap(flat, specPath) };
    if (spec.index !== undefined) {
        const index = Number(spec.index);
        if (!Number.isInteger(index) || index < 0)
            verificationError("invalid_argument", `${specPath}.index 必须是非负整数`, { stage: "input", node: specPath });
        node.index = index;
    }
    if (spec.childrenMode !== undefined && spec.childrenMode !== "exact" && spec.childrenMode !== "subset")
        verificationError("invalid_argument", `${specPath}.childrenMode 必须是 "exact" 或 "subset"`, { stage: "input", node: specPath });
    if (spec.childrenMode !== undefined && spec.children === undefined)
        verificationError("invalid_argument", `${specPath}.childrenMode 需要同时提供 children`, { stage: "input", node: specPath });
    if (spec.children !== undefined && !Array.isArray(spec.children))
        verificationError("invalid_argument", `${specPath}.children 必须是节点数组`, { stage: "input", node: specPath });
    if (spec.children) {
        node.childrenMode = spec.childrenMode || "exact";
        node.children = spec.children.map((child: any, i: number) => validateTreeSpec(child, `${specPath}.children[${i}]`));
        // A subset spec without any locator can never say which child it means.
        if (node.childrenMode === "subset")
            for (const child of node.children)
                if (child.assert.id === undefined && child.assert.name === undefined && child.index === undefined)
                    verificationError("invalid_argument", `subset 模式的子节点需要 id、name 或 index 定位：${child.specPath}`, { stage: "input", node: child.specPath });
    }
    return node;
}

function objectChildren(obj: any): any[] {
    const children: any[] = [];
    const component = obj as FairyEditor.FComponent;
    if (typeof component.numChildren !== "number") return children;
    for (let i = 0; i < component.numChildren; i++)
        children.push(component.GetChildAt(i));
    return children;
}

// `stage` controls both the error code and what a mismatch means: an
// editor-stage miss is the live tree disagreeing; an xml/reload miss means the
// structure never persisted.
function stageErrorCode(stage: string): string {
    return stage === "editor" ? "editor_rejected" : "persistence_failed";
}

function locateSpecChild(children: any[], spec: any, used: { [index: number]: boolean }, stage: string): number {
    const locate = (key: string, value: any): number => {
        let found = -1;
        for (let i = 0; i < children.length; i++) {
            if (used[i] || String(children[i][key] || "") !== String(value)) continue;
            if (found >= 0)
                verificationError("ambiguous_target", `子节点定位不唯一：${spec.specPath}`, { stage, node: spec.specPath, locator: { [key]: value } });
            found = i;
        }
        return found;
    };
    if (spec.assert.id !== undefined) return locate("id", spec.assert.id);
    if (spec.assert.name !== undefined) return locate("name", spec.assert.name);
    if (spec.index !== undefined) return !used[spec.index] && spec.index < children.length ? spec.index : -1;
    return -1;
}

function countSpecNodes(children: any[]): number {
    let count = 0;
    for (const child of children || []) {
        count++;
        if (child.children) count += countSpecNodes(child.children);
    }
    return count;
}

function verifyTreeNode(obj: any, spec: any, stage: string, counters: any): void {
    counters.checked++;
    const actual = verifiedObjectValues(obj);
    const differences = diffExpectedValues(spec.assert, actual);
    if (differences.length)
        verificationError(stageErrorCode(stage), `树比对失败（${stage}）：${spec.specPath}`, { stage, node: spec.specPath, target: targetSummary(obj, null), expected: spec.assert, actual, differences });
    if (!spec.children) return;
    const children = objectChildren(obj);
    if (spec.childrenMode === "subset") {
        const used: { [index: number]: boolean } = {};
        for (const childSpec of spec.children) {
            const index = locateSpecChild(children, childSpec, used, stage);
            if (index < 0)
                verificationError(stage === "editor" ? "target_not_found" : "persistence_failed", `未找到子节点（${stage}）：${childSpec.specPath}`, { stage, node: childSpec.specPath, spec: childSpec.assert });
            used[index] = true;
            verifyTreeNode(children[index], childSpec, stage, counters);
        }
        return;
    }
    if (spec.children.length !== children.length)
        verificationError(stageErrorCode(stage), `子节点数量不匹配（${stage}）：${spec.specPath}`, { stage, node: spec.specPath, target: targetSummary(obj, null), expected: spec.children.length, actual: children.length });
    for (let i = 0; i < spec.children.length; i++) {
        const childSpec = spec.children[i];
        if (childSpec.index !== undefined && childSpec.index !== i)
            verificationError(stageErrorCode(stage), `子节点位置不匹配（${stage}）：${childSpec.specPath}`, { stage, node: childSpec.specPath, expected: i, actual: childSpec.index });
        verifyTreeNode(children[i], childSpec, stage, counters);
    }
}

function locateSpecXmlChild(nodes: any[], spec: any, used: { [index: number]: boolean }): number {
    const locate = (key: string, value: any): number => {
        let found = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (used[i] || String(nodes[i].GetAttribute(key) || "") !== String(value)) continue;
            if (found >= 0)
                verificationError("ambiguous_target", `XML 子节点定位不唯一：${spec.specPath}`, { stage: "xml", node: spec.specPath, locator: { [key]: value } });
            found = i;
        }
        return found;
    };
    if (spec.assert.id !== undefined) return locate("id", spec.assert.id);
    if (spec.assert.name !== undefined) return locate("name", spec.assert.name);
    if (spec.index !== undefined) return !used[spec.index] && spec.index < nodes.length ? spec.index : -1;
    return -1;
}

// The component XML only serializes this document's own scope: the root node
// plus flat displayList children. Specs nested inside a child component live in
// that component's file — comparing them against this XML would be dishonest,
// so they are counted as skipped and still covered by the editor and reload
// stages.
function verifyTreeXml(doc: any, obj: any, spec: any, counters: any): string {
    const parsed = documentXml(doc, obj);
    const checkSpecNode = (nodeSpec: any, node: any): void => {
        const values = xmlNodeValues(parsed.item, node);
        const differences = diffExpectedValues(nodeSpec.assert, values);
        if (differences.length)
            verificationError("persistence_failed", `树比对失败（xml）：${nodeSpec.specPath}`, { stage: "xml", node: nodeSpec.specPath, expected: nodeSpec.assert, actual: values, differences });
        counters.xmlChecked++;
    };
    let targetNode: any = null;
    if (obj === doc.content) targetNode = parsed.xml;
    else {
        for (const candidate of displayListElements(parsed.xml))
            if (String(candidate.GetAttribute("id")) === String(obj.id)) { targetNode = candidate; break; }
        if (!targetNode)
            verificationError("persistence_failed", "XML 中未找到目标对象", { stage: "xml", node: spec.specPath, target: targetSummary(obj, null) });
    }
    checkSpecNode(spec, targetNode);
    if (!spec.children) return parsed.file;
    if (obj !== doc.content) {
        counters.xmlSkipped += countSpecNodes(spec.children);
        return parsed.file;
    }
    const nodes = displayListElements(parsed.xml);
    if (spec.childrenMode === "subset") {
        const used: { [index: number]: boolean } = {};
        for (const childSpec of spec.children) {
            const index = locateSpecXmlChild(nodes, childSpec, used);
            if (index < 0)
                verificationError("persistence_failed", `磁盘 XML 中未找到子节点：${childSpec.specPath}`, { stage: "xml", node: childSpec.specPath, spec: childSpec.assert });
            used[index] = true;
            checkSpecNode(childSpec, nodes[index]);
            counters.xmlSkipped += countSpecNodes(childSpec.children);
        }
        return parsed.file;
    }
    if (nodes.length !== spec.children.length)
        verificationError("persistence_failed", `磁盘 XML 子节点数量不匹配：${spec.specPath}`, { stage: "xml", node: spec.specPath, expected: spec.children.length, actual: nodes.length });
    for (let i = 0; i < spec.children.length; i++) {
        const childSpec = spec.children[i];
        if (childSpec.index !== undefined && childSpec.index !== i)
            verificationError("persistence_failed", `磁盘 XML 子节点位置不匹配：${childSpec.specPath}`, { stage: "xml", node: childSpec.specPath, expected: i, actual: childSpec.index });
        checkSpecNode(childSpec, nodes[i]);
        counters.xmlSkipped += countSpecNodes(childSpec.children);
    }
    return parsed.file;
}

// Reload-stage tree verification: close and reopen the document, re-resolve the
// target on the fresh handle, then walk the whole spec against memory the
// Editor re-derived from disk.
function externalReloadVerifyTree(doc: any, locator: any, spec: any, state: any): any {
    const rr = reloadDocument(doc, {});
    let reloaded: any = null;
    try {
        reloaded = locator ? resolveObject(rr.doc, locator) : rr.doc.content;
    } catch (error) {
        verificationError("persistence_failed", "external reload 后无法在重新载入的文档中定位目标", { stage: "reload", url: rr.url, closeStrategy: rr.closeStrategy, target: locator, reason: String(error) });
    }
    const counters: any = { checked: 0 };
    verifyTreeNode(reloaded, spec, "reload", counters);
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, checked: counters.checked };
}

function verifyDocument(params: any): any {
    const doc = getActiveDocument();
    const tree = describeObject(doc.content, 0, params.maxDepth === undefined ? 12 : Number(params.maxDepth));
    if (params.expected !== undefined) {
        const isTree = isTreeSpec(params.expected);
        if (!isTree && !params.target) verificationError("invalid_argument", "expected 必须提供 target", { stage: "input" });
        const expectedOrSpec = isTree ? validateTreeSpec(params.expected, "expected") : validateExpectations(params.expected);
        const obj = params.target ? resolveObject(doc, params.target) : doc.content;
        const wantsReload = Boolean(params.externalReload);
        // Snapshot-only mode must not silently close the user's document. Checked
        // here as well so the failure names this action's read-only contract; the
        // reload stage raises the same precondition for the write path.
        if (wantsReload && doc.isModified)
            verificationError("invalid_argument", "external reload 要求文档已保存；本 Action 不会保存，请先保存后重试", { stage: "reload", url: String(doc.docURL || ""), target: targetSummary(obj, params.target) });

        if (!isTree) {
            const expected = expectedOrSpec;
            const state: any = {};
            const verification = verifyObject(doc, obj, expected, params.readXml !== false, wantsReload ? { target: params.target } : null, state);
            // A reload replaced the document handle; every later read must use the new one.
            const liveDoc = state.doc || doc;
            const saved = !liveDoc.isModified;
            const strength = verificationStrength(verification, saved);
            return {
                ok: true, document: describeDocument(liveDoc), target: targetSummary(obj, params.target), tree, verification,
                saved, persisted: strength !== NONE_STRENGTH, strength,
                note: `${strengthNote(verification, saved, "只验证 expected 字段；不会保存文档。")}`
            };
        }

        const spec = expectedOrSpec;
        const counters: any = { checked: 0, xmlChecked: 0, xmlSkipped: 0 };
        verifyTreeNode(obj, spec, "editor", counters);
        let xmlFile: any = null;
        if (params.readXml !== false)
            xmlFile = verifyTreeXml(doc, obj, spec, counters);
        const state: any = {};
        const reloaded = wantsReload ? externalReloadVerifyTree(doc, params.target || null, spec, state) : null;
        // A reload replaced the document handle; every later read must use the new one.
        const liveDoc = state.doc || doc;
        const saved = !liveDoc.isModified;
        const verification: any = {
            editorReadback: true,
            xmlReadback: xmlFile !== null,
            externalReload: Boolean(reloaded),
            mode: "tree",
            childrenMode: spec.childrenMode || null,
            checked: counters.checked,
            xmlChecked: counters.xmlChecked,
            xmlSkipped: counters.xmlSkipped,
            file: xmlFile,
            reload: reloaded
        };
        const strength = verificationStrength(verification, saved);
        return {
            ok: true, document: describeDocument(liveDoc), target: targetSummary(obj, params.target), tree, verification,
            saved, persisted: strength !== NONE_STRENGTH, strength,
            note: `${strengthNote(verification, saved, `树比对覆盖 ${counters.checked} 个节点，磁盘 XML 覆盖 ${counters.xmlChecked} 个（仅活动文档序列化范围，嵌套组件内部不比对磁盘）；`)}本 Action 不会保存文档。`
        };
    }
    return { ok: true, document: describeDocument(doc), target: params.target ? describeObject(resolveObject(doc, params.target), 0, 1) : null, tree, verification: { editorReadback: false, xmlReadback: false, externalReload: false, strength: NONE_STRENGTH }, persisted: false, strength: NONE_STRENGTH, note: "仅返回快照，未比对预期值。传入 expected 执行验证，expected.children 执行对象树比对。" };
}

// Animation bridge helpers. FairyGUI Editor 6.1.4 exposes these APIs through Puerts.
const TRANSITION_TYPES = [
    "XY", "Size", "Pivot", "Scale", "Skew", "Alpha", "Rotation", "Color",
    "Animation", "Visible", "Sound", "Transition", "Shake", "ColorFilter", "Text", "Icon"
];
const TRANSITION_TYPE_SET: { [key: string]: boolean } = {};
for (const transitionType of TRANSITION_TYPES)
    TRANSITION_TYPE_SET[transitionType] = true;

interface AgentAnimationHistoryEntry {
    kind: "animation";
    documentUrl: string;
    before: string;
    after: string;
    documentModifiedBefore: boolean;
}

function numberValue(value: any, label: string, minimum: number = -1000000, maximum: number = 1000000): number {
    const result = Number(value);
    if (!Number.isFinite(result) || result < minimum || result > maximum)
        throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的有限数字`);
    return result;
}

function nonNegativeInt(value: any, label: string, fallback: number = 0): number {
    const result = value === undefined || value === null ? fallback : Number(value);
    if (!Number.isInteger(result) || result < 0 || result > 1000000)
        throw new Error(`${label}必须是 0 到 1000000 之间的整数`);
    return result;
}

function normalizeTransitionName(value: any): string {
    return validateResourceName(value, "transitionName");
}

function normalizeTransitionType(value: any): string {
    const type = String(value || "").trim();
    if (!TRANSITION_TYPE_SET[type])
        throw new Error(`不支持的 Transition 轨道类型：${type}`);
    return type;
}

function normalizeEase(value: any): string {
    const ease = String(value || "Quad.Out").trim();
    const normalized = ease.replace(/\./g, "");
    const allowed = [
        "Linear", "SineIn", "SineOut", "SineInOut", "QuadIn", "QuadOut", "QuadInOut",
        "CubicIn", "CubicOut", "CubicInOut", "QuartIn", "QuartOut", "QuartInOut",
        "QuintIn", "QuintOut", "QuintInOut", "ExpoIn", "ExpoOut", "ExpoInOut",
        "CircIn", "CircOut", "CircInOut", "ElasticIn", "ElasticOut", "ElasticInOut",
        "BackIn", "BackOut", "BackInOut", "BounceIn", "BounceOut", "BounceInOut", "Custom"
    ];
    if (allowed.indexOf(normalized) < 0)
        throw new Error(`不支持的缓动类型：${ease}`);
    if (normalized === "Linear" || normalized === "Custom")
        return normalized;
    return normalized.replace(/(InOut|In|Out)$/, ".$1");
}

function transitionValueObject(raw: any): any {
    if (raw === null || raw === undefined)
        return {};
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string")
        return { value: raw };
    if (typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Transition value 必须是对象、数字、布尔值或字符串");
    return raw;
}

function assertKnownKeys(value: any, allowed: string[], label: string): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return;
    for (const key of Object.keys(value)) {
        if (allowed.indexOf(key) < 0)
            throw new Error(`${label} 包含未知字段：${key}`);
    }
}

function validateTransitionValueKeys(type: string, raw: any): void {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return;
    const common2 = ["x", "y", "f1", "f2", "b1", "b2"];
    const allowed: { [key: string]: string[] } = {
        XY: common2.concat(["percent", "b3"]), Size: common2, Pivot: common2, Scale: common2, Skew: common2,
        Alpha: ["value", "f1"], Rotation: ["value", "f1"], Color: ["r", "g", "b", "a"],
        Animation: ["playing", "frame", "animationName", "skinName"], Visible: ["visible", "value"],
        Sound: ["soundUrl", "volume", "s", "i"], Transition: ["transitionName", "playTimes", "stopTime", "s", "i", "f1"],
        Shake: ["amplitude", "duration", "f1", "f2"],
        ColorFilter: ["brightness", "contrast", "saturation", "hue", "f1", "f2", "f3", "f4"],
        Text: ["text", "value", "s"], Icon: ["text", "value", "s"]
    };
    assertKnownKeys(raw, allowed[type] || [], `${type} value`);
}

function describePathPoints(points: any): any[] {
    const result: any[] = [];
    if (!points)
        return result;
    for (let index = 0; index < points.Count; index++) {
        const point = points.get_Item(index);
        result.push({
            x: Number(point.pos.x), y: Number(point.pos.y), curveType: String(point.curveType), smooth: Boolean(point.smooth),
            control1: point.control1 ? { x: Number(point.control1.x), y: Number(point.control1.y) } : null,
            control2: point.control2 ? { x: Number(point.control2.x), y: Number(point.control2.y) } : null
        });
    }
    return result;
}

function applyPathPoints(item: any, raw: any, custom: boolean): void {
    if (raw === undefined || raw === null)
        return;
    if (typeof raw === "string" || (typeof raw === "object" && !Array.isArray(raw) && raw.encoded !== undefined)) {
        const encoded = typeof raw === "string" ? raw : String(raw.encoded || "");
        if (custom) item.customEaseData = encoded;
        else item.pathData = encoded;
        return;
    }
    if (!Array.isArray(raw))
        throw new Error(`${custom ? "customEase" : "path"} 必须是路径点数组、{encoded, points}、内部编码字符串或 null`);
    if (custom) {
        const customEase = item.customEase;
        customEase.points.Clear();
        const PointType = (CS as any).FairyGUI.GPathPoint;
        const Vector3Type = (CS.UnityEngine as any).Vector3;
        for (let index = 0; index < raw.length; index++) {
            const point = raw[index];
            assertKnownKeys(point, ["x", "y", "curveType", "smooth", "control1", "control2", "near"], `customEase[${index}]`);
            const pos = new Vector3Type(numberValue(point.x, `customEase[${index}].x`), numberValue(point.y, `customEase[${index}].y`), 0);
            let value: any;
            if (point.control1 && point.control2) {
                const c1 = new Vector3Type(numberValue(point.control1.x, "control1.x"), numberValue(point.control1.y, "control1.y"), 0);
                const c2 = new Vector3Type(numberValue(point.control2.x, "control2.x"), numberValue(point.control2.y, "control2.y"), 0);
                value = new PointType(pos, c1, c2);
            }
            else if (point.control1) {
                const c = new Vector3Type(numberValue(point.control1.x, "control1.x"), numberValue(point.control1.y, "control1.y"), 0);
                value = new PointType(pos, c);
            }
            else value = new PointType(pos);
            value.smooth = Boolean(point.smooth);
            customEase.points.Add(value);
        }
        customEase.Update();
        return;
    }
    item.usePath = true;
    for (let index = 0; index < raw.length; index++) {
        const point = raw[index];
        assertKnownKeys(point, ["x", "y", "curveType", "smooth", "control1", "control2", "near"], `path[${index}]`);
        item.AddPathPoint(numberValue(point.x, `path[${index}].x`), numberValue(point.y, `path[${index}].y`), Boolean(point.near));
        if (point.control1)
            item.UpdateControlPoint(index, 1, numberValue(point.control1.x, "control1.x"), numberValue(point.control1.y, "control1.y"));
        if (point.control2)
            item.UpdateControlPoint(index, 2, numberValue(point.control2.x, "control2.x"), numberValue(point.control2.y, "control2.y"));
        if (point.smooth !== undefined && item.pathPoints && item.pathPoints.Count > index) {
            const stored = item.pathPoints.get_Item(index);
            stored.smooth = Boolean(point.smooth);
            item.pathPoints.set_Item(index, stored);
        }
    }
}

function colorFromValue(raw: any): any {
    const value = transitionValueObject(raw);
    const r = numberValue(value.r, "color.r", 0, 1);
    const g = numberValue(value.g, "color.g", 0, 1);
    const b = numberValue(value.b, "color.b", 0, 1);
    const a = value.a === undefined ? 1 : numberValue(value.a, "color.a", 0, 1);
    return new (CS.UnityEngine as any).Color(r, g, b, a);
}

function colorToValue(color: any): any {
    if (!color)
        return null;
    return { r: Number(color.r), g: Number(color.g), b: Number(color.b), a: Number(color.a) };
}

function applyTransitionValue(doc: FairyEditor.View.Document, type: string, destination: any, raw: any): void {
    validateTransitionValueKeys(type, raw);
    const value = transitionValueObject(raw);
    switch (type) {
        case "XY":
        case "Size":
        case "Pivot":
        case "Scale":
        case "Skew":
            destination.f1 = numberValue(value.x === undefined ? value.f1 : value.x, `${type}.x`);
            destination.f2 = numberValue(value.y === undefined ? value.f2 : value.y, `${type}.y`);
            destination.b1 = value.b1 === undefined ? true : Boolean(value.b1);
            destination.b2 = value.b2 === undefined ? true : Boolean(value.b2);
            if (type === "XY")
                destination.b3 = Boolean(value.percent === undefined ? value.b3 : value.percent);
            break;
        case "Alpha":
        case "Rotation":
            destination.f1 = numberValue(value.value === undefined ? value.f1 : value.value, `${type}.value`);
            break;
        case "Color":
            destination.iu = colorFromValue(value);
            break;
        case "Animation":
            destination.b1 = Boolean(value.playing);
            destination.i = nonNegativeInt(value.frame, "Animation.frame", 0);
            destination.s = value.animationName === undefined || value.animationName === null ? "" : String(value.animationName);
            destination.s2 = value.skinName === undefined || value.skinName === null ? "" : String(value.skinName);
            break;
        case "Visible":
            destination.b1 = Boolean(value.visible === undefined ? value.value : value.visible);
            break;
        case "Sound":
            destination.s = String(value.soundUrl === undefined ? value.s || "" : value.soundUrl);
            if (!destination.s)
                throw new Error("Sound.soundUrl 不能为空");
            const soundItem = resolveItem({ url: destination.s });
            if (soundItem.type !== FairyEditor.FPackageItemType.SOUND)
                throw new Error(`Sound.soundUrl 不是声音资源：${destination.s}`);
            const volume = value.volume === undefined ? 1 : numberValue(value.volume, "Sound.volume", 0, 1);
            destination.i = Math.round(volume * 100);
            break;
        case "Transition":
            destination.s = normalizeTransitionName(value.transitionName === undefined ? value.s : value.transitionName);
            if (!(doc.content as any).transitions.GetItem(destination.s))
                throw new Error(`嵌套 Transition 不存在：${destination.s}`);
            destination.i = value.playTimes === undefined ? 1 : Number(value.playTimes);
            if (!Number.isInteger(destination.i) || destination.i < -1 || destination.i > 1000000)
                throw new Error("Transition.playTimes 必须是 -1 到 1000000 之间的整数");
            destination.f1 = value.stopTime === undefined ? 0 : numberValue(value.stopTime, "Transition.stopTime", -1);
            break;
        case "Shake":
            destination.f1 = numberValue(value.amplitude === undefined ? value.f1 : value.amplitude, "Shake.amplitude", 0);
            destination.f2 = numberValue(value.duration === undefined ? value.f2 : value.duration, "Shake.duration", 0);
            break;
        case "ColorFilter":
            destination.f1 = numberValue(value.brightness === undefined ? value.f1 : value.brightness, "ColorFilter.brightness");
            destination.f2 = numberValue(value.contrast === undefined ? value.f2 : value.contrast, "ColorFilter.contrast");
            destination.f3 = numberValue(value.saturation === undefined ? value.f3 : value.saturation, "ColorFilter.saturation");
            destination.f4 = numberValue(value.hue === undefined ? value.f4 : value.hue, "ColorFilter.hue");
            break;
        case "Text":
        case "Icon":
            destination.s = String(value.text === undefined ? (value.value === undefined ? value.s || "" : value.value) : value.text);
            break;
    }
}

function describeTransitionValue(type: string, source: any): any {
    if (!source)
        return null;
    switch (type) {
        case "XY":
        case "Size":
        case "Pivot":
        case "Scale":
        case "Skew":
            return { x: source.f1, y: source.f2, b1: source.b1, b2: source.b2, percent: type === "XY" ? source.b3 : undefined };
        case "Alpha":
        case "Rotation":
            return source.f1;
        case "Color":
            return colorToValue(source.iu);
        case "Animation":
            return { playing: source.b1, frame: source.i, animationName: source.s || "", skinName: source.s2 || "" };
        case "Visible":
            return { visible: source.b1 };
        case "Sound":
            return { soundUrl: source.s || "", volume: Number(source.i) / 100 };
        case "Transition":
            return { transitionName: source.s || "", playTimes: source.i, stopTime: source.f1 };
        case "Shake":
            return { amplitude: source.f1, duration: source.f2 };
        case "ColorFilter":
            return { brightness: source.f1, contrast: source.f2, saturation: source.f3, hue: source.f4 };
        case "Text":
        case "Icon":
            return { text: source.s || "" };
    }
    return null;
}

function resolveTransition(doc: FairyEditor.View.Document, name: any): any {
    const transitionName = normalizeTransitionName(name);
    const transition = (doc.content as any).transitions.GetItem(transitionName);
    if (!transition)
        throw new Error(`当前组件中不存在 Transition：${transitionName}`);
    return transition;
}

function isSyntheticTweenEndpoint(item: any): boolean {
    return Boolean(item && item.prevItem && item.prevItem.tween && !item.tween);
}

function describeTransitionItem(item: any): any {
    const type = String(item.type);
    const result: any = {
        targetId: item.targetId || "",
        type,
        frame: item.frame,
        label: item.label || "",
        value: describeTransitionValue(type, item.value),
        tween: null
    };
    if (item.tween) {
        const next = item.nextItem;
        if (!next)
            throw new Error(`Transition Tween 缺少结束关键帧：${type}@${item.frame}`);
        result.tween = {
            duration: Math.max(0, Number(next.frame) - Number(item.frame)),
            ease: item.easeName || item.easeType || "Quad.Out",
            repeat: item.repeat || 0,
            yoyo: Boolean(item.yoyo),
            start: describeTransitionValue(type, item.value),
            end: describeTransitionValue(type, next.value),
            path: item.usePath ? { encoded: item.pathData, points: describePathPoints(item.pathPoints) } : null,
            customEase: String(item.easeType || "").replace(/\./g, "") === "Custom" ? { encoded: item.customEaseData, points: describePathPoints(item.customEase.points) } : null
        };
    }
    return result;
}

function describeTransition(transition: any): any {
    const items: any[] = [];
    for (let index = 0; index < transition.items.Count; index++) {
        const item = transition.items.get_Item(index);
        if (!isSyntheticTweenEndpoint(item))
            items.push(describeTransitionItem(item));
    }
    return {
        name: transition.name,
        options: transition.options,
        autoPlay: transition.autoPlay,
        autoPlayDelay: transition.autoPlayDelay,
        autoPlayRepeat: transition.autoPlayRepeat,
        frameRate: transition.frameRate,
        playTimes: transition.playTimes,
        maxFrame: transition.maxFrame,
        playing: transition.playing,
        items
    };
}

function summarizeTransitions(doc: FairyEditor.View.Document): any[] {
    const result: any[] = [];
    if (!doc || !doc.content || !(doc.content as any).transitions)
        return result;
    const transitions = (doc.content as any).transitions.items;
    for (let index = 0; index < transitions.Count; index++) {
        const transition = transitions.get_Item(index);
        let publicItemCount = 0;
        for (let itemIndex = 0; itemIndex < transition.items.Count; itemIndex++) {
            if (!isSyntheticTweenEndpoint(transition.items.get_Item(itemIndex)))
                publicItemCount++;
        }
        result.push({ name: transition.name, frameRate: transition.frameRate, maxFrame: transition.maxFrame, itemCount: publicItemCount, autoPlay: transition.autoPlay });
    }
    return result;
}

function listTransitions(doc: FairyEditor.View.Document): any[] {
    const list: any[] = [];
    const transitions = (doc.content as any).transitions.items;
    for (let index = 0; index < transitions.Count; index++)
        list.push(describeTransition(transitions.get_Item(index)));
    return list;
}

function validateTransitionTarget(doc: FairyEditor.View.Document, targetId: any, type?: string): string {
    const id = targetId === undefined || targetId === null ? "" : String(targetId);
    const target = id ? findObjectById(doc.content, id) : doc.content;
    if (!target)
        throw new Error(`Transition targetId 不存在：${id}`);
    if (type && !(FairyEditor as any).FTransition.GetAllowType(target, type))
        throw new Error(`目标 ${id || "root"} 不支持 Transition 轨道：${type}`);
    return id;
}

function getOrCreateTransitionItem(transition: any, targetId: string, type: string, frame: number): any {
    for (let index = 0; index < transition.items.Count; index++) {
        const existing = transition.items.get_Item(index);
        if (Number(existing.frame) === frame && String(existing.targetId || "") === targetId && String(existing.type) === type)
            return existing;
    }
    const item = transition.CreateItem(targetId, type, frame);
    if (!item)
        throw new Error(`无法创建 Transition 轨道：${type}@${frame}`);
    return item;
}

function applyTransitionItem(doc: FairyEditor.View.Document, transition: any, raw: any): any {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Transition item 必须是对象");
    assertKnownKeys(raw, ["targetId", "type", "frame", "label", "value", "tween"], "Transition item");
    const type = normalizeTransitionType(raw.type);
    const targetId = validateTransitionTarget(doc, raw.targetId, type);
    const frame = nonNegativeInt(raw.frame, "item.frame", 0);
    const item = getOrCreateTransitionItem(transition, targetId, type, frame);
    item.label = raw.label === undefined || raw.label === null ? "" : String(raw.label);
    if (raw.tween !== undefined && raw.tween !== null && raw.tween !== false) {
        const tween = raw.tween;
        if (typeof tween !== "object" || Array.isArray(tween))
            throw new Error("item.tween 必须是对象");
        assertKnownKeys(tween, ["duration", "ease", "repeat", "yoyo", "start", "end", "path", "customEase"], "Transition tween");
        const duration = nonNegativeInt(tween.duration, "tween.duration", 1);
        if (duration <= 0)
            throw new Error("tween.duration 必须大于 0");
        const endItem = getOrCreateTransitionItem(transition, targetId, type, frame + duration);
        item.tween = true;
        const ease = normalizeEase(tween.ease);
        const easeParts = ease.split(".");
        item.easeType = easeParts[0];
        if (easeParts.length > 1 && String(item.easeInOutType || "") !== easeParts[1])
            item.easeInOutType = easeParts[1];
        item.repeat = tween.repeat === undefined ? 0 : Number(tween.repeat);
        if (!Number.isInteger(item.repeat) || item.repeat < -1 || item.repeat > 1000000)
            throw new Error("tween.repeat 必须是 -1 到 1000000 之间的整数");
        item.yoyo = Boolean(tween.yoyo);
        applyPathPoints(item, tween.path, false);
        applyPathPoints(item, tween.customEase, true);
        applyTransitionValue(doc, type, item.value, tween.start === undefined ? raw.value : tween.start);
        applyTransitionValue(doc, type, endItem.value, tween.end === undefined ? raw.value : tween.end);
    }
    else {
        item.tween = false;
        applyTransitionValue(doc, type, item.value, raw.value);
    }
    return item;
}

function applyTransitionDefinition(doc: FairyEditor.View.Document, transition: any, raw: any): any {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Transition 定义必须是对象");
    assertKnownKeys(raw, ["name", "options", "autoPlay", "autoPlayDelay", "autoPlayRepeat", "frameRate", "playTimes", "items", "maxFrame", "playing"], "Transition");
    const name = normalizeTransitionName(raw.name || transition.name);
    if (transition.name !== name)
        transition.name = name;
    transition.frameRate = nonNegativeInt(raw.frameRate, "frameRate", 60);
    if (transition.frameRate < 1 || transition.frameRate > 255)
        throw new Error("frameRate 必须是 1 到 255 之间的整数");
    transition.options = raw.options === undefined ? 0 : Number(raw.options);
    if (!Number.isInteger(transition.options) || transition.options < 0 || transition.options > 0xffff)
        throw new Error("options 必须是 0 到 65535 之间的整数");
    transition.autoPlay = Boolean(raw.autoPlay);
    transition.autoPlayDelay = raw.autoPlayDelay === undefined ? 0 : numberValue(raw.autoPlayDelay, "autoPlayDelay", 0);
    transition.autoPlayRepeat = raw.autoPlayRepeat === undefined ? 1 : Number(raw.autoPlayRepeat);
    if (!Number.isInteger(transition.autoPlayRepeat) || transition.autoPlayRepeat < -1 || transition.autoPlayRepeat > 1000000)
        throw new Error("autoPlayRepeat 必须是 -1 到 1000000 之间的整数");
    if (raw.playTimes !== undefined) {
        transition.playTimes = Number(raw.playTimes);
        if (!Number.isInteger(transition.playTimes) || transition.playTimes < -1 || transition.playTimes > 1000000)
            throw new Error("playTimes 必须是 -1 到 1000000 之间的整数");
    }

    const existing: any[] = [];
    for (let index = 0; index < transition.items.Count; index++)
        existing.push(transition.items.get_Item(index));
    for (const item of existing)
        transition.DeleteItem(item);

    const items = raw.items === undefined ? [] : raw.items;
    if (!Array.isArray(items))
        throw new Error("Transition.items 必须是数组");
    for (const item of items)
        applyTransitionItem(doc, transition, item);
    transition.Validate();
    return transition;
}

function restoreTransitions(doc: FairyEditor.View.Document, snapshot: string): void {
    const XmlType = (CS as any).FairyGUI.Utils.XML;
    const xml = new XmlType(snapshot);
    doc.UpdateTransitions(xml);
    doc.RefreshTransition();
    doc.RefreshInspectors();
}

function transitionSnapshot(doc: FairyEditor.View.Document): string {
    return String((doc.content as any).transitions.Write().ToXMLString(false));
}

function pushAnimationHistory(doc: FairyEditor.View.Document, before: string, documentModifiedBefore: boolean): void {
    const after = transitionSnapshot(doc);
    if (JSON.stringify(before) === JSON.stringify(after))
        return;
    agentUndoStack.push({ kind: "animation", documentUrl: doc.docURL, before, after, documentModifiedBefore } as any);
    agentRedoStack.length = 0;
}

function applyAnimationHistory(entry: AgentAnimationHistoryEntry, undo: boolean): any {
    const doc = openDocumentByUrl(entry.documentUrl);
    const expected = undo ? entry.after : entry.before;
    const next = undo ? entry.before : entry.after;
    if (JSON.stringify(transitionSnapshot(doc)) !== JSON.stringify(expected))
        throw new Error("动画结构已被其他操作修改，拒绝撤销或重做");
    restoreTransitions(doc, next);
    doc.SetModified(undo ? entry.documentModifiedBefore : true);
    return { mode: "agent-animation", document: describeDocument(doc), transitions: listTransitions(doc) };
}

function mutateTransitions(params: any, operation: string, mutate: (doc: FairyEditor.View.Document) => any, verifySpec: { name: string; present: boolean }): any {
    const doc = getActiveDocument();
    const transitionTarget = { id: null, name: verifySpec.name, path: null, type: "transition" };
    // Reject impossible reload combinations before any mutation, so a bad
    // request never leaves the user's document half-written.
    validateReloadOptions(params, transitionTarget);
    const before = transitionSnapshot(doc);
    const documentModifiedBefore = doc.isModified;
    let result: any;
    try {
        result = mutate(doc);
        doc.RefreshTransition();
        doc.RefreshInspectors();
        doc.SetModified(true);
        pushAnimationHistory(doc, before, documentModifiedBefore);
    }
    catch (error) {
        try { restoreTransitions(doc, before); doc.SetModified(documentModifiedBefore); } catch (_) { /* preserve the original editor error */ }
        throw error;
    }
    // Verification runs outside the mutation try: a failed save must not roll
    // back an editor mutation that already landed (and may already be saved).
    const verified = transitionWriteVerification(doc, verifySpec.name, verifySpec.present, params);
    const liveDoc = verified.state.doc || doc;
    return {
        ok: true, operation, result, target: transitionTarget,
        document: describeDocument(liveDoc), transitions: listTransitions(liveDoc),
        documentModified: Boolean(liveDoc.isModified),
        saved: verified.saved, persisted: verified.persisted, strength: verified.strength,
        verification: verified.verification, note: verified.note
    };
}

function upsertTransition(params: any): any {
    const definition = params.transition;
    if (!definition || typeof definition !== "object" || Array.isArray(definition))
        throw new Error("transition 必须是对象");
    const name = normalizeTransitionName(definition.name || params.name);
    return mutateTransitions(params, "upserted", (doc) => {
        const transitions = (doc.content as any).transitions;
        const existing = transitions.GetItem(name);
        const transition = existing || transitions.AddItem(name);
        return describeTransition(applyTransitionDefinition(doc, transition, { ...definition, name }));
    }, { name, present: true });
}

function addTransitionItem(params: any): any {
    return mutateTransitions(params, "item_added", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        definition.items.push(params.item);
        applyTransitionDefinition(doc, transition, definition);
        return describeTransition(transition);
    }, { name: normalizeTransitionName(params.name), present: true });
}

function publicTransitionItem(definition: any, index: any): any {
    const itemIndex = nonNegativeInt(index, "itemIndex");
    if (itemIndex >= definition.items.length)
        throw new Error(`Transition itemIndex 超出范围：${itemIndex}`);
    return { itemIndex, item: definition.items[itemIndex] };
}

function mergePlainObjects(base: any, patch: any): any {
    if (!base || typeof base !== "object" || Array.isArray(base) || !patch || typeof patch !== "object" || Array.isArray(patch))
        return patch;
    const result: any = { ...base };
    for (const key of Object.keys(patch))
        result[key] = mergePlainObjects(base[key], patch[key]);
    return result;
}

function updateTransitionItem(params: any): any {
    return mutateTransitions(params, "item_updated", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        const found = publicTransitionItem(definition, params.itemIndex);
        const raw = params.item;
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new Error("item 必须是对象");
        const replacement = mergePlainObjects(found.item, raw);
        definition.items[found.itemIndex] = replacement;
        applyTransitionDefinition(doc, transition, definition);
        return describeTransition(transition);
    }, { name: normalizeTransitionName(params.name), present: true });
}

function removeTransitionItem(params: any): any {
    return mutateTransitions(params, "item_removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        const found = publicTransitionItem(definition, params.itemIndex);
        definition.items.splice(found.itemIndex, 1);
        applyTransitionDefinition(doc, transition, definition);
        return found.item;
    }, { name: normalizeTransitionName(params.name), present: true });
}

function removeTransition(params: any): any {
    return mutateTransitions(params, "removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const removed = describeTransition(transition);
        (doc.content as any).transitions.RemoveItem(transition);
        return removed;
    }, { name: normalizeTransitionName(params.name), present: false });
}

async function importSound(params: any): Promise<any> {
    validatePackageWriteOptions(params, "sound", true);
    const pkg = resolvePackage(params);
    const rawSourcePath = String(params.sourcePath || "").trim();
    if (!rawSourcePath || !IOPath.IsPathRooted(rawSourcePath))
        throw new Error("sourcePath 必须是存在的绝对路径");
    const sourcePath = IOPath.GetFullPath(rawSourcePath);
    if (!IOFile.Exists(sourcePath))
        throw new Error(`声音文件不存在：${sourcePath}`);
    if (FairyEditor.FPackageItemType.GetFileType(sourcePath) !== FairyEditor.FPackageItemType.SOUND)
        throw new Error(`文件不是 FairyGUI 支持的声音资源：${sourcePath}`);
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    let requestedName = params.resourceName ? String(params.resourceName).trim() : String(IOPath.GetFileNameWithoutExtension(sourcePath));
    if (IOPath.GetExtension(requestedName))
        requestedName = String(IOPath.GetFileNameWithoutExtension(requestedName));
    requestedName = validateResourceName(requestedName, "resourceName");
    const policy = normalizeConflictPolicy(params.conflictPolicy);
    let existing = findItemInFolder(pkg, folder, requestedName);
    let actualName = requestedName;
    if (existing && policy === "error") throw new Error(`资源已存在：${requestedName}`);
    if (existing && policy === "auto_rename") { actualName = resolveNewItemName(pkg, folder, requestedName, true); existing = null; }
    if (existing && policy === "replace") {
        if (existing.type !== FairyEditor.FPackageItemType.SOUND)
            throw new Error(`同名资源不是声音，不能替换：${requestedName}`);
        await puerts.$promise(pkg.UpdateResource(existing, sourcePath));
        existing.exported = params.exported !== false;
        existing.SetChanged();
        markPackageChanged(pkg);
        return packageWriteResult({ operation: "replaced", requestedName, actualName: existing.name, sourcePath, folderPath, item: describeItem(existing), packageModified: true, requiresSave: true, diskWrite: true }, pkg, packageItemRef(existing, "sound", folderPath, true), params);
    }
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, folderPath, `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`));
    if (!item || item.type !== FairyEditor.FPackageItemType.SOUND)
        throw new Error(`导入声音失败：${sourcePath}`);
    item.exported = params.exported !== false;
    item.SetChanged();
    markPackageChanged(pkg);
    return packageWriteResult({ operation: "imported", requestedName, actualName: item.name, sourcePath, folderPath, item: describeItem(item), packageModified: true, requiresSave: true, diskWrite: true }, pkg, packageItemRef(item, "sound", folderPath, true), params);
}

function normalizeFramePaths(value: any): string[] {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error("framePaths 必须是至少包含一帧的绝对图片路径数组");
    return value.map((raw, index) => {
        const path = String(raw || "").trim();
        if (!path || !IOPath.IsPathRooted(path))
            throw new Error(`framePaths[${index}] 必须是绝对路径`);
        const fullPath = IOPath.GetFullPath(path);
        if (!IOFile.Exists(fullPath) || FairyEditor.FPackageItemType.GetFileType(fullPath) !== FairyEditor.FPackageItemType.IMAGE)
            throw new Error(`framePaths[${index}] 不是 FairyGUI 支持的图片：${fullPath}`);
        return fullPath;
    });
}

function movieClipAsset(item: any): any {
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    const asset = item.GetAsset();
    if (!asset)
        throw new Error(`无法加载 MovieClip 资源：${item.name}`);
    return asset;
}

async function ensureMovieClipAsset(item: any): Promise<any> {
    const asset = movieClipAsset(item);
    if (asset.Load)
        await puerts.$promise(asset.Load());
    if (!asset.animation)
        throw new Error(`MovieClip 动画数据不可用：${item.name}`);
    return asset;
}

function describeLoadedMovieClip(item: any, asset: any): any {
    const animation = asset.animation;
    const frames: any[] = [];
    for (let index = 0; index < animation.frameList.Count; index++) {
        const frame = animation.frameList.get_Item(index);
        frames.push({ index, spriteIndex: frame.spriteIndex, delay: frame.delay, rect: frame.rect ? { x: frame.rect.x, y: frame.rect.y, width: frame.rect.width, height: frame.rect.height } : null });
    }
    return { item: describeItem(item), fps: animation.fps, speed: animation.speed, repeatDelay: animation.repeatDelay, swing: animation.swing, frameCount: animation.frameCount, frames };
}

async function getMovieClip(params: any): Promise<any> {
    const item = resolveItem(params.movieClip || params);
    return describeLoadedMovieClip(item, await ensureMovieClipAsset(item));
}

function movieClipFileState(item: any): any {
    const Convert = (CS.System as any).Convert;
    return {
        fileBase64: IOFile.Exists(item.file) ? String(Convert.ToBase64String(IOFile.ReadAllBytes(item.file))) : null,
        width: Number(item.width),
        height: Number(item.height),
        exported: Boolean(item.exported)
    };
}

function movieClipStatesEqual(left: any, right: any): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function pushMovieClipHistory(item: any, before: any): void {
    const after = movieClipFileState(item);
    if (movieClipStatesEqual(before, after))
        return;
    agentUndoStack.push({ kind: "movieclip", packageId: item.owner.id, itemId: item.id, before, after });
    agentRedoStack.length = 0;
}

function applyMovieClipHistory(entry: AgentMovieClipHistoryEntry, undo: boolean): any {
    const item = App.project.GetItem(entry.packageId, entry.itemId);
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("MovieClip 资源不存在，无法撤销或重做");
    const expected = undo ? entry.after : entry.before;
    const next = undo ? entry.before : entry.after;
    if (!movieClipStatesEqual(movieClipFileState(item), expected))
        throw new Error("MovieClip 资源已被其他操作修改，拒绝撤销或重做");
    if (next.fileBase64 === null)
        throw new Error("MovieClip 历史缺少可恢复的资源数据");
    const Convert = (CS.System as any).Convert;
    IOFile.WriteAllBytes(item.file, Convert.FromBase64String(next.fileBase64));
    item.width = next.width;
    item.height = next.height;
    item.exported = next.exported;
    item.UnloadAsset();
    item.SetChanged();
    item.owner.SetChanged();
    App.project.SetChanged();
    return { mode: "agent-movieclip", item: describeItem(item), requiresSave: true, diskWrite: true };
}

async function configureMovieClip(item: any, params: any): Promise<any> {
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    const recordHistory = params.recordHistory === true;
    const beforeFileState = movieClipFileState(item);
    const asset = await ensureMovieClipAsset(item);
    const animation = asset.animation;
    const framePaths = params.framePaths === undefined ? null : normalizeFramePaths(params.framePaths);
    if (params.fps !== undefined) {
        const fps = nonNegativeInt(params.fps, "fps");
        if (fps < 1 || fps > 255) throw new Error("fps 必须是 1 到 255 之间的整数");
    }
    if (params.speed !== undefined)
        numberValue(params.speed, "speed", 0.001, 1000);
    if (params.repeatDelay !== undefined) {
        const repeatDelay = nonNegativeInt(params.repeatDelay, "repeatDelay");
        if (repeatDelay > 255) throw new Error("repeatDelay 必须是 0 到 255 之间的额外延迟帧数");
    }
    if (params.frameDelays !== undefined && !Array.isArray(params.frameDelays))
        throw new Error("frameDelays 必须是数组");

    const AniDataType = (FairyEditor as any).AniData;
    const backup = new AniDataType();
    backup.CopyFrom(animation);
    try {
        if (framePaths)
            animation.ImportImages(toCsStringArray(framePaths), Boolean(params.compressPng));
        if (!animation.frameCount)
            throw new Error("MovieClip 至少需要一帧图片");
        if (params.fps !== undefined) animation.fps = Number(params.fps);
        if (params.speed !== undefined) animation.speed = Number(params.speed);
        if (params.repeatDelay !== undefined) animation.repeatDelay = Number(params.repeatDelay);
        if (params.swing !== undefined) animation.swing = Boolean(params.swing);
        if (params.frameDelays !== undefined) {
            if (params.frameDelays.length !== animation.frameList.Count)
                throw new Error("frameDelays 必须与 MovieClip 帧数相同");
            for (let index = 0; index < animation.frameList.Count; index++) {
                const delay = nonNegativeInt(params.frameDelays[index], `frameDelays[${index}]`);
                if (delay > 255) throw new Error(`frameDelays[${index}] 必须是 0 到 255 之间的整数`);
                animation.frameList.get_Item(index).delay = delay;
            }
        }
        animation.CalculateBoundsRect();
        if (animation.boundsRect) {
            item.width = Number(animation.boundsRect.width);
            item.height = Number(animation.boundsRect.height);
        }
        if (params.exported !== undefined)
            item.exported = Boolean(params.exported);
        animation.Save(item.file);
        item.SetChanged();
        item.owner.SetChanged();
        App.project.SetChanged();
    }
    catch (error) {
        animation.CopyFrom(backup);
        item.width = beforeFileState.width;
        item.height = beforeFileState.height;
        item.exported = beforeFileState.exported;
        try {
            const Convert = (CS.System as any).Convert;
            if (beforeFileState.fileBase64 === null) {
                if (IOFile.Exists(item.file)) IOFile.Delete(item.file);
            }
            else {
                IOFile.WriteAllBytes(item.file, Convert.FromBase64String(beforeFileState.fileBase64));
            }
            item.UnloadAsset();
        }
        catch (_) { /* 尽力恢复磁盘快照，保留原始错误。 */ }
        throw error;
    }
    if (recordHistory)
        pushMovieClipHistory(item, beforeFileState);
    const result = describeLoadedMovieClip(item, asset);
    result.frameSources = framePaths || [];
    result.resourceChanges = framePaths ? framePaths.map((sourcePath: string, index: number) => ({ index, sourcePath, operation: "embedded" })) : [];
    return result;
}

async function createMovieClip(params: any): Promise<any> {
    validatePackageWriteOptions(params, "movieclip", true);
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.movieClipName, "movieClipName");
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    const policy = normalizeConflictPolicy(params.conflictPolicy);
    let name = requestedName;
    let item = findItemInFolder(pkg, folder, name);
    if (item && policy === "error") throw new Error(`资源已存在：${name}`);
    if (item && policy === "auto_rename") { name = resolveNewItemName(pkg, folder, name, true); item = null; }
    if (item && item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error(`同名资源不是 MovieClip：${requestedName}`);
    const created = !item;
    if (!item) item = pkg.CreateMovieClipItem(name, folderPath, false);
    if (!item) throw new Error(`创建 MovieClip 失败：${name}`);
    try {
        const result = await configureMovieClip(item, { ...params, exported: params.exported !== false, recordHistory: !created });
        if (created)
            clearAgentHistory();
        return packageWriteResult({
            operation: created ? "created" : "replaced",
            requestedName,
            actualName: item.name,
            folderPath,
            movieClip: result,
            resourceChanges: [{ operation: created ? "created" : "replaced", item: describeItem(item) }].concat(result.resourceChanges || []),
            packageModified: true,
            requiresSave: true,
            diskWrite: true,
            undoable: !created
        }, pkg, packageItemRef(item, "movieclip", folderPath, true), params);
    }
    catch (error) {
        if (created) {
            try {
                if (IOFile.Exists(item.file)) IOFile.Delete(item.file);
                pkg.DeleteItem(item);
                markPackageChanged(pkg);
            }
            catch (_) { /* 尽力清理本次新建资源，保留原始错误。 */ }
        }
        throw error;
    }
}

async function updateMovieClip(params: any): Promise<any> {
    validatePackageWriteOptions(params, "movieclip", true);
    const item = resolveItem(params.movieClip || params);
    const updateKeys = ["framePaths", "fps", "speed", "repeatDelay", "swing", "frameDelays", "exported", "compressPng"];
    if (!updateKeys.some((key) => params[key] !== undefined))
        throw new Error("update_movieclip 至少需要提供一个更新字段");
    const result = await configureMovieClip(item, { ...params, recordHistory: true });
    return packageWriteResult({ operation: "updated", movieClip: result, resourceChanges: result.resourceChanges || [], packageModified: true, requiresSave: true, diskWrite: true, undoable: true }, item.owner, packageItemRef(item, "movieclip", String(item.path || ""), true), params);
}

function findMovieClipReferences(item: any): string[] {
    const references: string[] = [];
    const seen: { [path: string]: boolean } = {};
    const add = (value: string) => {
        if (!seen[value]) { seen[value] = true; references.push(value); }
    };
    try {
        const activeDoc = App.activeDoc;
        if (activeDoc) {
            const matches: FairyEditor.FObject[] = [];
            findObjectsByResourceUrl(activeDoc.content, item.GetURL(), matches);
            for (const match of matches)
                add(`${activeDoc.docURL}#${match.id || match.name}`);
        }
    }
    catch (_) { /* 继续执行磁盘引用扫描。 */ }
    const files = IODirectory.GetFiles(App.project.assetsPath, "*.xml", IOSearchOption.AllDirectories);
    const ownBasePath = String(item.owner.basePath || "");
    const url = String(item.GetURL());
    for (let index = 0; index < files.Length; index++) {
        const file = String(files.GetValue(index));
        if (String(IOPath.GetFileName(file)).toLowerCase() === "package.xml")
            continue;
        let text = "";
        try { text = String(IOFile.ReadAllText(file)); } catch (_) { continue; }
        const samePackage = ownBasePath && file.indexOf(ownBasePath) === 0;
        const localReference = samePackage && (text.indexOf(`src="${item.id}"`) >= 0 || text.indexOf(`src='${item.id}'`) >= 0);
        const urlReference = text.indexOf(url) >= 0;
        const crossPackageReference = (text.indexOf(`pkg="${item.owner.id}"`) >= 0 || text.indexOf(`pkg='${item.owner.id}'`) >= 0)
            && (text.indexOf(`src="${item.id}"`) >= 0 || text.indexOf(`src='${item.id}'`) >= 0);
        if (localReference || urlReference || crossPackageReference)
            add(file);
    }
    return references;
}

async function removeMovieClip(params: any): Promise<any> {
    // 删除没有诚实的重载基元（资源句柄已随删除失效），externalReload 不支持。
    validatePackageWriteOptions(params, "movieclip", false);
    const item = resolveItem(params.movieClip || params);
    if (item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    if (params.force !== true)
        throw new Error("删除 MovieClip 是不可逆包资源操作；请显式传 force=true 确认");
    const references = findMovieClipReferences(item);
    if (references.length > 0)
        throw new Error(`MovieClip 正在被引用，不能删除：${references.join(", ")}`);
    const pkg = item.owner;
    const removed = describeLoadedMovieClip(item, await ensureMovieClipAsset(item));
    const ref = { id: String(item.id), url: String(item.GetURL()), name: String(item.name), type: "movieclip", path: String(item.path || ""), present: false, file: item.file ? String(item.file) : null };
    clearAgentHistory();
    pkg.DeleteItem(item);
    markPackageChanged(pkg);
    return packageWriteResult({ operation: "removed", movieClip: removed, references, packageModified: true, requiresSave: true, diskWrite: true, undoable: false }, pkg, ref, params);
}

async function previewAnimation(params: any): Promise<any> {
    const kind = String(params.kind || "").toLowerCase();
    const operation = String(params.operation || "").toLowerCase();
    if (["play", "pause", "stop", "seek", "next", "previous", "status"].indexOf(operation) < 0)
        throw new Error(`不支持的预览操作：${operation}`);
    if (kind === "transition") {
        const doc = params.target && params.target.documentUrl ? openDocumentByUrl(String(params.target.documentUrl)) : getActiveDocument();
        const transition = resolveTransition(doc, params.target ? params.target.name : params.name);
        const contextKey = `transition:${doc.docURL}:${transition.name}`;
        const context = animationPreviewContexts[contextKey] || { frame: Number(doc.head) || 0, paused: false };
        let frame = params.frame === undefined
            ? (params.startFrame === undefined ? (context.paused ? context.frame : Number(doc.head) || 0) : nonNegativeInt(params.startFrame, "startFrame"))
            : nonNegativeInt(params.frame, "frame");
        if (operation === "play") {
            const times = params.times === undefined ? 1 : Number(params.times);
            if (!Number.isInteger(times) || times < -1 || times > 1000000)
                throw new Error("times 必须是 -1 到 1000000 之间的整数");
            const delay = params.delay === undefined ? 0 : numberValue(params.delay, "delay", 0);
            const endFrame = params.endFrame === undefined ? -1 : Number(params.endFrame);
            if (!Number.isInteger(endFrame) || endFrame < -1)
                throw new Error("endFrame 必须是 -1 或非负整数");
            transition.Play(undefined, times, delay, frame, endFrame, true);
            animationPreviewContexts[contextKey] = { frame, paused: false, endFrame };
        }
        else if (operation === "pause") {
            transition.Stop(false, false);
            frame = Number(doc.head) || context.frame || 0;
            animationPreviewContexts[contextKey] = { ...context, frame, paused: true };
        }
        else if (operation === "stop") {
            transition.Stop(false, false);
            doc.EnterTimelineMode(transition.name);
            doc.head = 0;
            frame = 0;
            delete animationPreviewContexts[contextKey];
        }
        else if (operation !== "status") {
            doc.EnterTimelineMode(transition.name);
            frame = operation === "next" ? frame + 1 : operation === "previous" ? Math.max(0, frame - 1) : frame;
            doc.head = frame;
            animationPreviewContexts[contextKey] = { ...context, frame, paused: true };
        }
        else {
            frame = Number(doc.head) || context.frame || 0;
        }
        return { kind, operation, transition: describeTransition(transition), frame, playing: Boolean(transition.playing), paused: Boolean(animationPreviewContexts[contextKey] && animationPreviewContexts[contextKey].paused), document: describeDocument(doc), persisted: false };
    }
    if (kind === "movieclip") {
        const doc = getActiveDocument();
        const object = resolveObject(doc, params.target);
        if (String(object.objectType) !== FairyEditor.FObjectType.MOVIECLIP)
            throw new Error("预览目标不是 MovieClip 对象");
        const movieClip = object as any;
        let frameCount: number = null;
        if (object.resourceURL) {
            const resourceItem = resolveItem({ url: object.resourceURL });
            const asset = await ensureMovieClipAsset(resourceItem);
            frameCount = Number(asset.animation.frameCount);
        }
        if (operation === "play") movieClip.playing = true;
        if (operation === "pause") movieClip.playing = false;
        if (operation === "stop") { movieClip.playing = false; movieClip.frame = 0; }
        if (operation === "seek") movieClip.frame = nonNegativeInt(params.frame, "frame");
        if (operation === "next") movieClip.frame = Number(movieClip.frame) + 1;
        if (operation === "previous") movieClip.frame = Math.max(0, Number(movieClip.frame) - 1);
        if (frameCount !== null && movieClip.frame >= frameCount) movieClip.frame = Math.max(0, frameCount - 1);
        return { kind, operation, target: { id: object.id, name: object.name, resourceURL: object.resourceURL || null }, playing: Boolean(movieClip.playing), frame: Number(movieClip.frame), frameCount, persisted: false };
    }
    throw new Error("kind 必须是 transition 或 movieclip");
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
    font: true,
    tooltips: true,
    blendMode: true,
    customData: true,
    notes: true
};

const numericWritableProperties: { [key: string]: boolean } = {
    x: true, y: true, width: true, height: true,
    scaleX: true, scaleY: true, skewX: true, skewY: true,
    pivotX: true, pivotY: true, rotation: true, alpha: true
};
const booleanWritableProperties: { [key: string]: boolean } = {
    anchor: true, visible: true, touchable: true, opaque: true, grayed: true,
    enabled: true, locked: true, hideByEditor: true, useSourceSize: true
};
const stringWritableProperties: { [key: string]: boolean } = {
    name: true, text: true, icon: true, font: true,
    tooltips: true, blendMode: true, customData: true, notes: true
};

// Normalizes once, before the mutation, so the value sent to the Editor and the
// value used as the verification expectation can never diverge.
function normalizeWritableValue(property: string, value: any): any {
    if (numericWritableProperties[property]) {
        const number = Number(value);
        if (!Number.isFinite(number))
            verificationError("invalid_argument", `${property} 必须是有限数字`, { stage: "input", property, value });
        return number;
    }
    if (booleanWritableProperties[property]) {
        if (typeof value === "boolean") return value;
        if (value === 0 || value === 1) return Boolean(value);
        if (value === "true" || value === "false") return value === "true";
        verificationError("invalid_argument", `${property} 只接受布尔值`, { stage: "input", property, value });
    }
    if (stringWritableProperties[property]) {
        if (value === null || value === undefined)
            verificationError("invalid_argument", `${property} 不能为 null`, { stage: "input", property });
        return String(value);
    }
    return value;
}

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
        largeImageAtlasRule: {
            longSideMin: LARGE_IMAGE_LONG_SIDE_MIN,
            shortSideMin: LARGE_IMAGE_SHORT_SIDE_MIN,
            side2kMin: LARGE_IMAGE_2K_SIDE_MIN,
            atlas: LARGE_IMAGE_ATLAS
        },
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

function forEachPackageItem(items: any, visit: (item: any) => void): void {
    if (!items)
        return;

    for (let i = 0; i < items.Count; i++) {
        const item = items.get_Item(i);
        visit(item);
        forEachPackageItem(item.children, visit);
    }
}

function enforceLargeImageAtlasRule(pkg: FairyEditor.FPackage): any[] {
    const changed: any[] = [];
    forEachPackageItem(pkg.items, (item) => {
        if (!applyLargeImageAtlasRule(item))
            return;
        changed.push({
            id: item.id,
            name: item.name,
            width: item.width,
            height: item.height,
            folderAtlas: LARGE_IMAGE_ATLAS,
            url: item.GetURL()
        });
    });
    if (changed.length > 0)
        pkg.SetChanged();
    return changed;
}

async function publishPackages(params: any): Promise<any> {
    if (publishInProgress)
        throw new Error("已有 FairyGUI 发布任务正在执行");

    const packages = resolvePublishPackages(params);
    const branch = params.branch === undefined ? String(App.project.activeBranch || "") : String(params.branch || "");
    const saveBeforePublish = params.saveBeforePublish !== false;
    const publishDescOnly = params.publishDescOnly === true;
    validatePublishBranch(branch);

    const largeImageAtlasChanges: any[] = [];
    for (let i = 0; i < packages.length; i++) {
        const changes = enforceLargeImageAtlasRule(packages[i]);
        for (let j = 0; j < changes.length; j++) {
            largeImageAtlasChanges.push({
                package: packages[i].name,
                ...changes[j]
            });
        }
    }
    if (largeImageAtlasChanges.length > 0)
        App.project.SetChanged();

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
            largeImageAtlasRule: {
                longSideMin: LARGE_IMAGE_LONG_SIDE_MIN,
                shortSideMin: LARGE_IMAGE_SHORT_SIDE_MIN,
                side2kMin: LARGE_IMAGE_2K_SIDE_MIN,
                atlas: LARGE_IMAGE_ATLAS,
                changedCount: largeImageAtlasChanges.length,
                changes: largeImageAtlasChanges
            },
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
        import_font: true,
        create_button: true,
        import_sound: true,
        create_movieclip: true,
        update_movieclip: true,
        remove_movieclip: true,
        upsert_transition: true,
        remove_transition: true,
        add_transition_item: true,
        update_transition_item: true,
        remove_transition_item: true,
        select_object: true,
        set_property: true,
        insert_object: true,
        remove_object: true,
        set_list_layout: true,
        set_group_layout: true,
        set_relation: true,
        set_gear_display: true,
        set_controller: true,
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

        case "import_font":
            return importFont(params);

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

        case "import_sound":
            return importSound(params);

        case "create_movieclip":
            return createMovieClip(params);

        case "get_movieclip":
            return getMovieClip(params);

        case "update_movieclip":
            return updateMovieClip(params);

        case "remove_movieclip":
            return removeMovieClip(params);

        case "list_transitions":
            return listTransitions(getActiveDocument());

        case "get_transition":
            return describeTransition(resolveTransition(getActiveDocument(), params.name));

        case "upsert_transition":
            return upsertTransition(params);

        case "remove_transition":
            return removeTransition(params);

        case "add_transition_item":
            return addTransitionItem(params);

        case "update_transition_item":
            return updateTransitionItem(params);

        case "remove_transition_item":
            return removeTransitionItem(params);

        case "preview_animation":
            return previewAnimation(params);

        case "replace_object_resource":
            return replaceObjectResource(params);

        case "get_text_style":
            return getTextStyle(params);

        case "set_text_style":
            return setTextStyle(params);

        case "verify_document":
            return verifyDocument(params);

        case "set_list_layout": {
            const doc = getActiveDocument();
            const fields = layoutFieldSubset(params);
            return applyTypedLayoutWrite(doc, params, "list", LIST_LAYOUT_KEYS, fields);
        }

        case "set_group_layout": {
            const doc = getActiveDocument();
            const fields = layoutFieldSubset(params);
            return applyTypedLayoutWrite(doc, params, "group", GROUP_LAYOUT_KEYS, fields);
        }

        case "set_relation":
            return setRelation(params);

        case "set_gear_display":
            return setGearDisplay(params);

        case "set_controller":
            return setController(params);

        case "list_controllers":
            return listControllers();

        case "set_property": {
            const doc = getActiveDocument();
            const obj = resolveObject(doc, params.target);
            const property = String(params.property || "");
            if (!writableProperties[property])
                verificationError("unsupported_property", `属性不在安全写入白名单中：${property}`, { stage: "input", property });

            validatePropertyTarget(doc, obj, property);
            validateReloadOptions(params, targetSummary(obj, params.target));
            let value = normalizeWritableValue(property, params.value);
            if (property === "font" && typeof value === "string" && value.indexOf("ui://") === 0) {
                const font = resolveItem({ url: value });
                if (font.type !== FairyEditor.FPackageItemType.FONT)
                    verificationError("invalid_argument", "font 必须引用字体资源", { stage: "input", resourceURL: value });
                value = String(font.GetURL());
            }
            const before = safeValue(getWritableProperty(obj, property));
            const documentModifiedBefore = doc.isModified;
            setWritableProperty(obj, property, value);
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

            // font 的 XML 序列化形式取决于编辑器接受的值，而不是输入形式；
            // 其余已覆盖属性用请求值做 expected，让编辑器擅自调整能被检出。
            const expected: any = { id: obj.id, name: obj.name, type: String(obj.objectType || "").toLowerCase() };
            if (VERIFIED_KEYS.indexOf(property) >= 0 && property !== "name")
                expected[property] = property === "font" ? after : value;
            const result = writeVerification(doc, obj, before, after, params, expected);
            result.property = property;
            result.history = {
                agentUndoCount: agentUndoStack.length,
                agentRedoCount: agentRedoStack.length,
                nativeCanUndo: doc.history.CanUndo(),
                nativeCanRedo: doc.history.CanRedo(),
                nativePendingCount: doc.history.GetPendingList().Count
            };
            return result;
        }

        case "insert_object": {
            const doc = getActiveDocument();
            const item = resolveItem(params);
            validateReloadOptions(params, null);
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
            const expected: any = {
                id: obj.id,
                name: obj.name || "",
                type: String(obj.objectType || "").toLowerCase(),
                x,
                y
            };
            if (obj.resourceURL || String(obj.objectType).toLowerCase() === "loader")
                expected.resourceURL = String(item.GetURL());
            return writeVerification(doc, obj, null, describeObject(obj, 0, 1), params, expected);
        }

        case "remove_object": {
            const doc = getActiveDocument();
            const obj = resolveObject(doc, params.target);
            if (obj === doc.content)
                throw new Error("不允许删除文档根组件");
            const target = targetSummary(obj, params.target);
            validateReloadOptions(params, target);
            const removed = describeObject(obj, 0, 1);
            const removedId = String(obj.id || "");
            const locator = removedId ? { id: removedId } : params.target;
            doc.RemoveObject(obj);
            doc.SetModified(true);
            clearAgentHistory();

            let stillPresent: any = null;
            if (removedId)
                stillPresent = findObjectById(doc.content, removedId);
            else {
                try {
                    stillPresent = resolveObject(doc, params.target);
                } catch (error) {
                    stillPresent = null;
                }
            }
            if (stillPresent)
                verificationError("editor_rejected", "删除后目标仍可解析", { stage: "editor", target });

            let saved = false;
            if (params.save) {
                try { doc.Save(); }
                catch (error) { verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error) }); }
                saved = doc.isModified === false;
                if (!saved) verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target });
            }

            let xmlReadback = false;
            let xmlFile: any = null;
            if (saved && params.verify !== false) {
                const persisted = persistedNodeExists(doc, removedId);
                xmlFile = persisted.file;
                if (persisted.exists)
                    verificationError("persistence_failed", "保存后磁盘 XML 仍包含目标节点", { stage: "xml", target });
                xmlReadback = true;
            }

            const state: any = {};
            let reloaded: any = null;
            if (xmlReadback && params.externalReload)
                reloaded = externalReloadVerifyAbsent(doc, locator, state);
            const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), file: xmlFile, reload: reloaded };
            const liveDoc = state.doc || doc;
            const strength = verificationStrength(verification, saved);
            return {
                ok: true, target, removed,
                documentModified: Boolean(liveDoc.isModified),
                saved, persisted: strength !== NONE_STRENGTH, strength, verification,
                note: `${strengthNote(verification, saved, "目标已删除；")}失败不自动回滚。`
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
                    const result = (entry as any).kind === "animation"
                        ? applyAnimationHistory(entry as AgentAnimationHistoryEntry, true)
                        : (entry as any).kind === "movieclip"
                            ? applyMovieClipHistory(entry as AgentMovieClipHistoryEntry, true)
                            : applyAgentHistory(entry as AgentPropertyHistoryEntry, true);
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
                    const result = (entry as any).kind === "animation"
                        ? applyAnimationHistory(entry as AgentAnimationHistoryEntry, false)
                        : (entry as any).kind === "movieclip"
                            ? applyMovieClipHistory(entry as AgentMovieClipHistoryEntry, false)
                            : applyAgentHistory(entry as AgentPropertyHistoryEntry, false);
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
    const text = message.toLowerCase();
    let code = "editor_rejected";
    if (text.indexOf("未找到对象") >= 0 || text.indexOf("未找到资源引用") >= 0) code = "target_not_found";
    else if (text.indexOf("不唯一") >= 0) code = "ambiguous_target";
    else if (text.indexOf("不支持") >= 0 || text.indexOf("白名单") >= 0 || text.indexOf("不是文本对象") >= 0) code = "unsupported_property";
    else if (text.indexOf("必须") >= 0 || text.indexOf("格式") >= 0) code = "invalid_argument";
    const response: AgentResponse = {
        id: requestId,
        ok: false,
        action,
        error: { code: error && error.code ? String(error.code) : code, message, stack, details: error && error.details ? error.details : undefined },
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

        if (isStaleFile(claimedPath)) {
            completeRequestError(claimedPath, requestId, action, new Error(`请求已过期（超过 ${REQUEST_MAX_AGE_MS / 1000} 秒未被认领，可能来自已中断的客户端）`));
            return;
        }

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
    // 心跳按真实时间写入，编辑器帧率下降时不再被客户端误判为离线。
    if (Date.now() - lastStatusWrittenMs >= STATUS_MIN_INTERVAL_MS)
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
