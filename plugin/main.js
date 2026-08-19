"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var FairyEditor = CS.FairyEditor;
var UnityEngine = CS.UnityEngine;
const puerts = require("puerts");
const IOFile = CS.System.IO.File;
const IODirectory = CS.System.IO.Directory;
const IOPath = CS.System.IO.Path;
const IOFileInfo = CS.System.IO.FileInfo;
const IOSearchOption = CS.System.IO.SearchOption;
const App = FairyEditor.App;
const previousRunInBackground = UnityEngine.Application.runInBackground;
UnityEngine.Application.runInBackground = true;
const BRIDGE_VERSION = "0.8.1";
const PROTOCOL_VERSION = "1.0";
const POLL_INTERVAL_FRAMES = 6;
const STATUS_INTERVAL_FRAMES = 60;
const MAX_COMMANDS_PER_POLL = 4;
const agentUndoStack = [];
const agentRedoStack = [];
let frameCount = 0;
let queueRoot = "";
let requestFolder = "";
let processingFolder = "";
let responseFolder = "";
let statusFile = "";
let logFile = "";
let initialized = false;
let publishInProgress = false;
const animationPreviewContexts = {};
function nowIso() {
    return new Date().toISOString();
}
function appendLog(message) {
    try {
        if (!logFile)
            return;
        IOFile.AppendAllText(logFile, `[${nowIso()}] ${message}\n`);
    }
    catch (_) {
        // 日志失败不能阻断桥接命令。
    }
}
function ensureDirectory(path) {
    if (!IODirectory.Exists(path))
        IODirectory.CreateDirectory(path);
}
function initializeBridge() {
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
function writeJsonAtomic(path, data) {
    const tempPath = `${path}.tmp`;
    IOFile.WriteAllText(tempPath, JSON.stringify(data, null, 2));
    if (IOFile.Exists(path))
        IOFile.Delete(path);
    IOFile.Move(tempPath, path);
}
function writeStatus() {
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
            "redo"
        ]
    });
}
function describeProject() {
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
function describePackage(pkg) {
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
function isLargeImageDimensions(width, height) {
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
function applyLargeImageAtlasRule(item) {
    if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE || !isLargeImageDimensions(item.width, item.height))
        return false;
    if (String(item.folderAtlas || "") === LARGE_IMAGE_ATLAS)
        return false;
    // FairyGUI 的 alone 纹理集会为每张图片单独生成图集，不会与小图混排。
    item.folderAtlas = LARGE_IMAGE_ATLAS;
    item.SetChanged();
    return true;
}
function describeItem(item) {
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
function describeDocument(doc) {
    return {
        url: doc.docURL,
        title: doc.displayTitle,
        itemId: doc.packageItem ? doc.packageItem.id : null,
        itemName: doc.packageItem ? doc.packageItem.name : null,
        packageName: doc.packageItem && doc.packageItem.owner ? doc.packageItem.owner.name : null,
        modified: doc.isModified,
        savedVersion: doc.savedVersion,
        selectionCount: doc.GetSelection().Count,
        transitionCount: doc.content && doc.content.transitions ? doc.content.transitions.items.Count : 0,
        transitions: summarizeTransitions(doc)
    };
}
function safeRequestId(value) {
    const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    return sanitized || `request-${Date.now()}`;
}
function safeValue(value) {
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
function describeObject(obj, depth, maxDepth) {
    const result = {
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
        const movieClip = obj;
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
    const component = obj;
    if (typeof component.numChildren === "number")
        result.opaque = component.opaque;
    if (depth < maxDepth && typeof component.numChildren === "number") {
        const children = [];
        for (let i = 0; i < component.numChildren; i++)
            children.push(describeObject(component.GetChildAt(i), depth + 1, maxDepth));
        result.children = children;
    }
    else if (typeof component.numChildren === "number") {
        result.childCount = component.numChildren;
    }
    return result;
}
function getActiveDocument() {
    const doc = App.activeDoc;
    if (!doc)
        throw new Error("当前没有打开的 FairyGUI 文档");
    return doc;
}
function resolvePackage(params) {
    const project = App.project;
    let pkg = null;
    if (params && params.packageId)
        pkg = project.GetPackage(String(params.packageId));
    if (!pkg && params && params.packageName)
        pkg = project.GetPackageByName(String(params.packageName));
    if (!pkg)
        throw new Error("未找到指定 FairyGUI 包，请提供 packageId 或 packageName");
    pkg.EnsureOpen();
    return pkg;
}
function resolveItem(params) {
    const project = App.project;
    let item = null;
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
function normalizePackagePath(value) {
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
function validateResourceName(value, label) {
    const name = String(value || "").trim();
    if (!name)
        throw new Error(`${label}不能为空`);
    if (name === "." || name === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(name))
        throw new Error(`${label}包含非法字符：${name}`);
    return name;
}
function validateSize(value, fallback, label) {
    const numberValue = value === undefined || value === null ? fallback : Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0 || numberValue > 32768)
        throw new Error(`${label}必须大于 0 且不超过 32768`);
    return numberValue;
}
function resolvePackageFolder(pkg, pathValue, createIfMissing) {
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
function findItemInFolder(pkg, folder, name) {
    return pkg.GetItemByName(folder, name);
}
function resolveNewItemName(pkg, folder, requestedName, autoRename) {
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
function toCsStringArray(values) {
    const result = CS.System.Array.CreateInstance(puerts.$typeof(CS.System.String), values.length);
    for (let i = 0; i < values.length; i++)
        result.SetValue(values[i], i);
    return result;
}
function markPackageChanged(pkg) {
    pkg.SetChanged();
    App.project.SetChanged();
    clearAgentHistory();
    writeStatus();
}
function describeCreatedItem(item, operation, requestedName, folderPath, document = null) {
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
function createComponent(params) {
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.componentName, "componentName");
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    const actualName = resolveNewItemName(pkg, folder, requestedName, params.autoRename === true);
    const width = validateSize(params.width, 800, "width");
    const height = validateSize(params.height, 600, "height");
    const extensionId = params.extensionId ? String(params.extensionId).trim() : "";
    const exported = params.exported !== false;
    const item = pkg.CreateComponentItem(actualName, width, height, folderPath, extensionId, exported, false);
    if (!item)
        throw new Error(`创建组件失败：${requestedName}`);
    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    return describeCreatedItem(item, "created", requestedName, folderPath, document);
}
function normalizeConflictPolicy(value) {
    const policy = String(value || "error").toLowerCase();
    if (policy !== "error" && policy !== "auto_rename" && policy !== "replace")
        throw new Error(`未知冲突策略：${policy}`);
    return policy;
}
async function importImage(params) {
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
        return {
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
    const largeImageAtlasApplied = applyLargeImageAtlasRule(item);
    markPackageChanged(pkg);
    return {
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
    };
}
async function importFont(params) {
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
        throw new Error(`导入字体失败：${sourcePath}`);
    if (item.type !== FairyEditor.FPackageItemType.FONT)
        throw new Error(`导入结果不是字体资源：${item.name}`);
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
function normalizeButtonMode(value) {
    const mode = String(value || "common").toLowerCase();
    if (mode === "common")
        return "Common";
    if (mode === "check")
        return "Check";
    if (mode === "radio")
        return "Radio";
    throw new Error(`未知按钮模式：${mode}`);
}
function resolveButtonImages(params) {
    const input = params.imageUrls === undefined || params.imageUrls === null ? [] : params.imageUrls;
    if (!Array.isArray(input))
        throw new Error("imageUrls 必须是数组");
    if (input.length > 6)
        throw new Error("imageUrls 最多包含 6 个状态图片");
    const result = [];
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
function createButton(params) {
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
    const item = templates.CreateButtonItem(actualName, extensionId, mode, toCsStringArray(images), width, height, params.asListItem === true, params.createRelations !== false, params.createText !== false, params.createIcon !== false, params.exported !== false, folderPath);
    if (!item)
        throw new Error(`创建按钮失败：${requestedName}`);
    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    const result = describeCreatedItem(item, "created", requestedName, folderPath, document);
    result.mode = mode;
    result.imageUrls = images;
    return result;
}
function openDocument(params) {
    const item = resolveItem(params);
    if (item.type !== FairyEditor.FPackageItemType.COMPONENT)
        throw new Error(`资源 ${item.name} 不是组件，无法作为文档打开`);
    const opened = App.docView.OpenDocument(item.GetURL(), true);
    if (!opened)
        throw new Error(`打开文档失败：${item.GetURL()}`);
    return opened;
}
function findObjectById(root, id) {
    if (root.id === id)
        return root;
    const component = root;
    if (typeof component.numChildren !== "number")
        return null;
    for (let i = 0; i < component.numChildren; i++) {
        const found = findObjectById(component.GetChildAt(i), id);
        if (found)
            return found;
    }
    return null;
}
function findObjectsByResourceUrl(root, resourceUrl, result) {
    if (String(root.resourceURL || "") === resourceUrl)
        result.push(root);
    const component = root;
    if (typeof component.numChildren !== "number")
        return;
    for (let i = 0; i < component.numChildren; i++)
        findObjectsByResourceUrl(component.GetChildAt(i), resourceUrl, result);
}
function findObjectsByName(root, name, result) {
    if (root.name === name)
        result.push(root);
    const component = root;
    if (typeof component.numChildren !== "number")
        return;
    for (let i = 0; i < component.numChildren; i++)
        findObjectsByName(component.GetChildAt(i), name, result);
}
function findObjectByPath(root, path) {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized === "root")
        return root;
    const parts = normalized.split("/");
    if (parts[0] === "root")
        parts.shift();
    let current = root;
    for (const part of parts) {
        const component = current;
        if (typeof component.numChildren !== "number")
            return null;
        current = component.GetChild(part);
        if (!current)
            return null;
    }
    return current;
}
function resolveObject(doc, locator) {
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
        const matches = [];
        findObjectsByName(doc.content, String(locator.name), matches);
        if (matches.length === 0)
            throw new Error(`未找到对象名称：${locator.name}`);
        if (matches.length > 1)
            throw new Error(`对象名称不唯一：${locator.name}，共找到 ${matches.length} 个，请改用 path 或 id`);
        return matches[0];
    }
    throw new Error("对象定位信息缺失，请提供 target.path、target.id 或 target.name");
}
// Animation bridge helpers. FairyGUI Editor 6.1.4 exposes these APIs through Puerts.
const TRANSITION_TYPES = [
    "XY", "Size", "Pivot", "Scale", "Skew", "Alpha", "Rotation", "Color",
    "Animation", "Visible", "Sound", "Transition", "Shake", "ColorFilter", "Text", "Icon"
];
const TRANSITION_TYPE_SET = {};
for (const transitionType of TRANSITION_TYPES)
    TRANSITION_TYPE_SET[transitionType] = true;
function numberValue(value, label, minimum = -1000000, maximum = 1000000) {
    const result = Number(value);
    if (!Number.isFinite(result) || result < minimum || result > maximum)
        throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的有限数字`);
    return result;
}
function nonNegativeInt(value, label, fallback = 0) {
    const result = value === undefined || value === null ? fallback : Number(value);
    if (!Number.isInteger(result) || result < 0 || result > 1000000)
        throw new Error(`${label}必须是 0 到 1000000 之间的整数`);
    return result;
}
function normalizeTransitionName(value) {
    return validateResourceName(value, "transitionName");
}
function normalizeTransitionType(value) {
    const type = String(value || "").trim();
    if (!TRANSITION_TYPE_SET[type])
        throw new Error(`不支持的 Transition 轨道类型：${type}`);
    return type;
}
function normalizeEase(value) {
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
function transitionValueObject(raw) {
    if (raw === null || raw === undefined)
        return {};
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string")
        return { value: raw };
    if (typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Transition value 必须是对象、数字、布尔值或字符串");
    return raw;
}
function assertKnownKeys(value, allowed, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return;
    for (const key of Object.keys(value)) {
        if (allowed.indexOf(key) < 0)
            throw new Error(`${label} 包含未知字段：${key}`);
    }
}
function validateTransitionValueKeys(type, raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return;
    const common2 = ["x", "y", "f1", "f2", "b1", "b2"];
    const allowed = {
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
function describePathPoints(points) {
    const result = [];
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
function applyPathPoints(item, raw, custom) {
    if (raw === undefined || raw === null)
        return;
    if (typeof raw === "string" || (typeof raw === "object" && !Array.isArray(raw) && raw.encoded !== undefined)) {
        const encoded = typeof raw === "string" ? raw : String(raw.encoded || "");
        if (custom)
            item.customEaseData = encoded;
        else
            item.pathData = encoded;
        return;
    }
    if (!Array.isArray(raw))
        throw new Error(`${custom ? "customEase" : "path"} 必须是路径点数组、{encoded, points}、内部编码字符串或 null`);
    if (custom) {
        const customEase = item.customEase;
        customEase.points.Clear();
        const PointType = CS.FairyGUI.GPathPoint;
        const Vector3Type = CS.UnityEngine.Vector3;
        for (let index = 0; index < raw.length; index++) {
            const point = raw[index];
            assertKnownKeys(point, ["x", "y", "curveType", "smooth", "control1", "control2", "near"], `customEase[${index}]`);
            const pos = new Vector3Type(numberValue(point.x, `customEase[${index}].x`), numberValue(point.y, `customEase[${index}].y`), 0);
            let value;
            if (point.control1 && point.control2) {
                const c1 = new Vector3Type(numberValue(point.control1.x, "control1.x"), numberValue(point.control1.y, "control1.y"), 0);
                const c2 = new Vector3Type(numberValue(point.control2.x, "control2.x"), numberValue(point.control2.y, "control2.y"), 0);
                value = new PointType(pos, c1, c2);
            }
            else if (point.control1) {
                const c = new Vector3Type(numberValue(point.control1.x, "control1.x"), numberValue(point.control1.y, "control1.y"), 0);
                value = new PointType(pos, c);
            }
            else
                value = new PointType(pos);
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
function colorFromValue(raw) {
    const value = transitionValueObject(raw);
    const r = numberValue(value.r, "color.r", 0, 1);
    const g = numberValue(value.g, "color.g", 0, 1);
    const b = numberValue(value.b, "color.b", 0, 1);
    const a = value.a === undefined ? 1 : numberValue(value.a, "color.a", 0, 1);
    return new CS.UnityEngine.Color(r, g, b, a);
}
function colorToValue(color) {
    if (!color)
        return null;
    return { r: Number(color.r), g: Number(color.g), b: Number(color.b), a: Number(color.a) };
}
function applyTransitionValue(doc, type, destination, raw) {
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
            if (!doc.content.transitions.GetItem(destination.s))
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
function describeTransitionValue(type, source) {
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
function resolveTransition(doc, name) {
    const transitionName = normalizeTransitionName(name);
    const transition = doc.content.transitions.GetItem(transitionName);
    if (!transition)
        throw new Error(`当前组件中不存在 Transition：${transitionName}`);
    return transition;
}
function isSyntheticTweenEndpoint(item) {
    return Boolean(item && item.prevItem && item.prevItem.tween && !item.tween);
}
function describeTransitionItem(item) {
    const type = String(item.type);
    const result = {
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
function describeTransition(transition) {
    const items = [];
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
function summarizeTransitions(doc) {
    const result = [];
    if (!doc || !doc.content || !doc.content.transitions)
        return result;
    const transitions = doc.content.transitions.items;
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
function listTransitions(doc) {
    const list = [];
    const transitions = doc.content.transitions.items;
    for (let index = 0; index < transitions.Count; index++)
        list.push(describeTransition(transitions.get_Item(index)));
    return list;
}
function validateTransitionTarget(doc, targetId, type) {
    const id = targetId === undefined || targetId === null ? "" : String(targetId);
    const target = id ? findObjectById(doc.content, id) : doc.content;
    if (!target)
        throw new Error(`Transition targetId 不存在：${id}`);
    if (type && !FairyEditor.FTransition.GetAllowType(target, type))
        throw new Error(`目标 ${id || "root"} 不支持 Transition 轨道：${type}`);
    return id;
}
function getOrCreateTransitionItem(transition, targetId, type, frame) {
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
function applyTransitionItem(doc, transition, raw) {
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
function applyTransitionDefinition(doc, transition, raw) {
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
    const existing = [];
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
function restoreTransitions(doc, snapshot) {
    const XmlType = CS.FairyGUI.Utils.XML;
    const xml = new XmlType(snapshot);
    doc.UpdateTransitions(xml);
    doc.RefreshTransition();
    doc.RefreshInspectors();
}
function transitionSnapshot(doc) {
    return String(doc.content.transitions.Write().ToXMLString(false));
}
function pushAnimationHistory(doc, before, documentModifiedBefore) {
    const after = transitionSnapshot(doc);
    if (JSON.stringify(before) === JSON.stringify(after))
        return;
    agentUndoStack.push({ kind: "animation", documentUrl: doc.docURL, before, after, documentModifiedBefore });
    agentRedoStack.length = 0;
}
function applyAnimationHistory(entry, undo) {
    const doc = openDocumentByUrl(entry.documentUrl);
    const expected = undo ? entry.after : entry.before;
    const next = undo ? entry.before : entry.after;
    if (JSON.stringify(transitionSnapshot(doc)) !== JSON.stringify(expected))
        throw new Error("动画结构已被其他操作修改，拒绝撤销或重做");
    restoreTransitions(doc, next);
    doc.SetModified(undo ? entry.documentModifiedBefore : true);
    return { mode: "agent-animation", document: describeDocument(doc), transitions: listTransitions(doc) };
}
function mutateTransitions(params, operation, mutate) {
    const doc = getActiveDocument();
    const before = transitionSnapshot(doc);
    const documentModifiedBefore = doc.isModified;
    try {
        const result = mutate(doc);
        doc.RefreshTransition();
        doc.RefreshInspectors();
        doc.SetModified(true);
        pushAnimationHistory(doc, before, documentModifiedBefore);
        return { operation, result, document: describeDocument(doc), transitions: listTransitions(doc) };
    }
    catch (error) {
        try {
            restoreTransitions(doc, before);
            doc.SetModified(documentModifiedBefore);
        }
        catch (_) { /* preserve the original editor error */ }
        throw error;
    }
}
function upsertTransition(params) {
    const definition = params.transition;
    if (!definition || typeof definition !== "object" || Array.isArray(definition))
        throw new Error("transition 必须是对象");
    const name = normalizeTransitionName(definition.name || params.name);
    return mutateTransitions(params, "upserted", (doc) => {
        const transitions = doc.content.transitions;
        const existing = transitions.GetItem(name);
        const transition = existing || transitions.AddItem(name);
        return describeTransition(applyTransitionDefinition(doc, transition, { ...definition, name }));
    });
}
function addTransitionItem(params) {
    return mutateTransitions(params, "item_added", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        definition.items.push(params.item);
        applyTransitionDefinition(doc, transition, definition);
        return describeTransition(transition);
    });
}
function publicTransitionItem(definition, index) {
    const itemIndex = nonNegativeInt(index, "itemIndex");
    if (itemIndex >= definition.items.length)
        throw new Error(`Transition itemIndex 超出范围：${itemIndex}`);
    return { itemIndex, item: definition.items[itemIndex] };
}
function mergePlainObjects(base, patch) {
    if (!base || typeof base !== "object" || Array.isArray(base) || !patch || typeof patch !== "object" || Array.isArray(patch))
        return patch;
    const result = { ...base };
    for (const key of Object.keys(patch))
        result[key] = mergePlainObjects(base[key], patch[key]);
    return result;
}
function updateTransitionItem(params) {
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
    });
}
function removeTransitionItem(params) {
    return mutateTransitions(params, "item_removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        const found = publicTransitionItem(definition, params.itemIndex);
        definition.items.splice(found.itemIndex, 1);
        applyTransitionDefinition(doc, transition, definition);
        return found.item;
    });
}
function removeTransition(params) {
    return mutateTransitions(params, "removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const removed = describeTransition(transition);
        doc.content.transitions.RemoveItem(transition);
        return removed;
    });
}
async function importSound(params) {
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
    if (existing && policy === "error")
        throw new Error(`资源已存在：${requestedName}`);
    if (existing && policy === "auto_rename") {
        actualName = resolveNewItemName(pkg, folder, requestedName, true);
        existing = null;
    }
    if (existing && policy === "replace") {
        if (existing.type !== FairyEditor.FPackageItemType.SOUND)
            throw new Error(`同名资源不是声音，不能替换：${requestedName}`);
        await puerts.$promise(pkg.UpdateResource(existing, sourcePath));
        existing.exported = params.exported !== false;
        existing.SetChanged();
        markPackageChanged(pkg);
        return { operation: "replaced", requestedName, actualName: existing.name, sourcePath, folderPath, item: describeItem(existing), packageModified: true, requiresSave: true, diskWrite: true };
    }
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, folderPath, `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`));
    if (!item || item.type !== FairyEditor.FPackageItemType.SOUND)
        throw new Error(`导入声音失败：${sourcePath}`);
    item.exported = params.exported !== false;
    item.SetChanged();
    markPackageChanged(pkg);
    return { operation: "imported", requestedName, actualName: item.name, sourcePath, folderPath, item: describeItem(item), packageModified: true, requiresSave: true, diskWrite: true };
}
function normalizeFramePaths(value) {
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
function movieClipAsset(item) {
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    const asset = item.GetAsset();
    if (!asset)
        throw new Error(`无法加载 MovieClip 资源：${item.name}`);
    return asset;
}
async function ensureMovieClipAsset(item) {
    const asset = movieClipAsset(item);
    if (asset.Load)
        await puerts.$promise(asset.Load());
    if (!asset.animation)
        throw new Error(`MovieClip 动画数据不可用：${item.name}`);
    return asset;
}
function describeLoadedMovieClip(item, asset) {
    const animation = asset.animation;
    const frames = [];
    for (let index = 0; index < animation.frameList.Count; index++) {
        const frame = animation.frameList.get_Item(index);
        frames.push({ index, spriteIndex: frame.spriteIndex, delay: frame.delay, rect: frame.rect ? { x: frame.rect.x, y: frame.rect.y, width: frame.rect.width, height: frame.rect.height } : null });
    }
    return { item: describeItem(item), fps: animation.fps, speed: animation.speed, repeatDelay: animation.repeatDelay, swing: animation.swing, frameCount: animation.frameCount, frames };
}
async function getMovieClip(params) {
    const item = resolveItem(params.movieClip || params);
    return describeLoadedMovieClip(item, await ensureMovieClipAsset(item));
}
function movieClipFileState(item) {
    const Convert = CS.System.Convert;
    return {
        fileBase64: IOFile.Exists(item.file) ? String(Convert.ToBase64String(IOFile.ReadAllBytes(item.file))) : null,
        width: Number(item.width),
        height: Number(item.height),
        exported: Boolean(item.exported)
    };
}
function movieClipStatesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function pushMovieClipHistory(item, before) {
    const after = movieClipFileState(item);
    if (movieClipStatesEqual(before, after))
        return;
    agentUndoStack.push({ kind: "movieclip", packageId: item.owner.id, itemId: item.id, before, after });
    agentRedoStack.length = 0;
}
function applyMovieClipHistory(entry, undo) {
    const item = App.project.GetItem(entry.packageId, entry.itemId);
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("MovieClip 资源不存在，无法撤销或重做");
    const expected = undo ? entry.after : entry.before;
    const next = undo ? entry.before : entry.after;
    if (!movieClipStatesEqual(movieClipFileState(item), expected))
        throw new Error("MovieClip 资源已被其他操作修改，拒绝撤销或重做");
    if (next.fileBase64 === null)
        throw new Error("MovieClip 历史缺少可恢复的资源数据");
    const Convert = CS.System.Convert;
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
async function configureMovieClip(item, params) {
    if (!item || item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    const recordHistory = params.recordHistory === true;
    const beforeFileState = movieClipFileState(item);
    const asset = await ensureMovieClipAsset(item);
    const animation = asset.animation;
    const framePaths = params.framePaths === undefined ? null : normalizeFramePaths(params.framePaths);
    if (params.fps !== undefined) {
        const fps = nonNegativeInt(params.fps, "fps");
        if (fps < 1 || fps > 255)
            throw new Error("fps 必须是 1 到 255 之间的整数");
    }
    if (params.speed !== undefined)
        numberValue(params.speed, "speed", 0.001, 1000);
    if (params.repeatDelay !== undefined) {
        const repeatDelay = nonNegativeInt(params.repeatDelay, "repeatDelay");
        if (repeatDelay > 255)
            throw new Error("repeatDelay 必须是 0 到 255 之间的额外延迟帧数");
    }
    if (params.frameDelays !== undefined && !Array.isArray(params.frameDelays))
        throw new Error("frameDelays 必须是数组");
    const AniDataType = FairyEditor.AniData;
    const backup = new AniDataType();
    backup.CopyFrom(animation);
    try {
        if (framePaths)
            animation.ImportImages(toCsStringArray(framePaths), Boolean(params.compressPng));
        if (!animation.frameCount)
            throw new Error("MovieClip 至少需要一帧图片");
        if (params.fps !== undefined)
            animation.fps = Number(params.fps);
        if (params.speed !== undefined)
            animation.speed = Number(params.speed);
        if (params.repeatDelay !== undefined)
            animation.repeatDelay = Number(params.repeatDelay);
        if (params.swing !== undefined)
            animation.swing = Boolean(params.swing);
        if (params.frameDelays !== undefined) {
            if (params.frameDelays.length !== animation.frameList.Count)
                throw new Error("frameDelays 必须与 MovieClip 帧数相同");
            for (let index = 0; index < animation.frameList.Count; index++) {
                const delay = nonNegativeInt(params.frameDelays[index], `frameDelays[${index}]`);
                if (delay > 255)
                    throw new Error(`frameDelays[${index}] 必须是 0 到 255 之间的整数`);
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
            const Convert = CS.System.Convert;
            if (beforeFileState.fileBase64 === null) {
                if (IOFile.Exists(item.file))
                    IOFile.Delete(item.file);
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
    result.resourceChanges = framePaths ? framePaths.map((sourcePath, index) => ({ index, sourcePath, operation: "embedded" })) : [];
    return result;
}
async function createMovieClip(params) {
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.movieClipName, "movieClipName");
    const folderPath = normalizePackagePath(params.folderPath);
    const folder = resolvePackageFolder(pkg, folderPath, params.createFolders !== false);
    const policy = normalizeConflictPolicy(params.conflictPolicy);
    let name = requestedName;
    let item = findItemInFolder(pkg, folder, name);
    if (item && policy === "error")
        throw new Error(`资源已存在：${name}`);
    if (item && policy === "auto_rename") {
        name = resolveNewItemName(pkg, folder, name, true);
        item = null;
    }
    if (item && item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error(`同名资源不是 MovieClip：${requestedName}`);
    const created = !item;
    if (!item)
        item = pkg.CreateMovieClipItem(name, folderPath, false);
    if (!item)
        throw new Error(`创建 MovieClip 失败：${name}`);
    try {
        const result = await configureMovieClip(item, { ...params, exported: params.exported !== false, recordHistory: !created });
        if (created)
            clearAgentHistory();
        return {
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
        };
    }
    catch (error) {
        if (created) {
            try {
                if (IOFile.Exists(item.file))
                    IOFile.Delete(item.file);
                pkg.DeleteItem(item);
                markPackageChanged(pkg);
            }
            catch (_) { /* 尽力清理本次新建资源，保留原始错误。 */ }
        }
        throw error;
    }
}
async function updateMovieClip(params) {
    const item = resolveItem(params.movieClip || params);
    const updateKeys = ["framePaths", "fps", "speed", "repeatDelay", "swing", "frameDelays", "exported", "compressPng"];
    if (!updateKeys.some((key) => params[key] !== undefined))
        throw new Error("update_movieclip 至少需要提供一个更新字段");
    const result = await configureMovieClip(item, { ...params, recordHistory: true });
    return { operation: "updated", movieClip: result, resourceChanges: result.resourceChanges || [], packageModified: true, requiresSave: true, diskWrite: true, undoable: true };
}
function findMovieClipReferences(item) {
    const references = [];
    const seen = {};
    const add = (value) => {
        if (!seen[value]) {
            seen[value] = true;
            references.push(value);
        }
    };
    try {
        const activeDoc = App.activeDoc;
        if (activeDoc) {
            const matches = [];
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
        try {
            text = String(IOFile.ReadAllText(file));
        }
        catch (_) {
            continue;
        }
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
async function removeMovieClip(params) {
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
    clearAgentHistory();
    pkg.DeleteItem(item);
    markPackageChanged(pkg);
    return { operation: "removed", movieClip: removed, references, packageModified: true, requiresSave: true, diskWrite: true, undoable: false };
}
async function previewAnimation(params) {
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
        const movieClip = object;
        let frameCount = null;
        if (object.resourceURL) {
            const resourceItem = resolveItem({ url: object.resourceURL });
            const asset = await ensureMovieClipAsset(resourceItem);
            frameCount = Number(asset.animation.frameCount);
        }
        if (operation === "play")
            movieClip.playing = true;
        if (operation === "pause")
            movieClip.playing = false;
        if (operation === "stop") {
            movieClip.playing = false;
            movieClip.frame = 0;
        }
        if (operation === "seek")
            movieClip.frame = nonNegativeInt(params.frame, "frame");
        if (operation === "next")
            movieClip.frame = Number(movieClip.frame) + 1;
        if (operation === "previous")
            movieClip.frame = Math.max(0, Number(movieClip.frame) - 1);
        if (frameCount !== null && movieClip.frame >= frameCount)
            movieClip.frame = Math.max(0, frameCount - 1);
        return { kind, operation, target: { id: object.id, name: object.name, resourceURL: object.resourceURL || null }, playing: Boolean(movieClip.playing), frame: Number(movieClip.frame), frameCount, persisted: false };
    }
    throw new Error("kind 必须是 transition 或 movieclip");
}
const writableProperties = {
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
function validatePropertyTarget(doc, obj, property) {
    const isRoot = obj === doc.content;
    if (isRoot && property === "touchable") {
        throw new Error("FairyGUI 组件根节点不序列化 touchable，无法持久化该属性；" +
            "如需让透明根区域不拦截点击，请设置根组件 opaque=false，并分别设置需要穿透的子对象 touchable=false");
    }
    if (property === "opaque" && !isRoot)
        throw new Error("opaque 是组件定义属性，只能对当前文档根组件设置");
}
function getWritableProperty(obj, property) {
    if (property === "opaque")
        return obj.opaque;
    return obj.GetProperty(property);
}
function setWritableProperty(obj, property, value) {
    if (property === "opaque") {
        if (typeof value !== "boolean")
            throw new Error("opaque 只接受布尔值");
        obj.opaque = value;
        return;
    }
    obj.SetProperty(property, value);
}
function valuesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function historyTarget(obj, requestedTarget) {
    if (obj.id)
        return { id: obj.id };
    if (requestedTarget && requestedTarget.path)
        return { path: requestedTarget.path };
    return { path: "root" };
}
function clearAgentHistory() {
    agentUndoStack.length = 0;
    agentRedoStack.length = 0;
}
function openDocumentByUrl(url) {
    const opened = App.docView.OpenDocument(url, true);
    if (!opened)
        throw new Error(`无法打开历史记录对应文档：${url}`);
    return opened;
}
function applyAgentHistory(entry, undo) {
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
function getActivePackage() {
    const doc = getActiveDocument();
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.owner)
        throw new Error("无法从当前文档确定所属包");
    return item.owner;
}
function resolvePublishPackages(params) {
    const scope = String(params.scope || "active");
    const result = [];
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
        const seen = {};
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
function validatePublishBranch(branch) {
    if (!branch)
        return;
    const branches = App.project.allBranches;
    for (let i = 0; i < branches.Count; i++) {
        if (branches.get_Item(i) === branch)
            return;
    }
    throw new Error(`未找到分支：${branch}`);
}
function normalizeOutputPath(path) {
    if (!path)
        return "";
    if (/^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path))
        return path;
    if (IOPath.IsPathRooted(path))
        return IOPath.GetFullPath(path);
    return IOPath.GetFullPath(IOPath.Combine(App.project.basePath, path));
}
function stringListToArray(list) {
    const result = [];
    for (let i = 0; i < list.Count; i++)
        result.push(String(list.get_Item(i)));
    return result;
}
function describePublishSettings(params) {
    const settings = App.project.GetSettings("Publish");
    if (!settings)
        throw new Error("FairyGUI 工程缺少 Publish 设置");
    const packages = [];
    const packageName = params && params.packageName ? String(params.packageName) : "";
    const sourcePackages = [];
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
function snapshotOutputPaths(paths) {
    const snapshot = {};
    const visited = {};
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
                modifiedTicks: String(IOFile.GetLastWriteTimeUtc(file).Ticks)
            };
        }
    }
    return snapshot;
}
function diffSnapshots(before, after) {
    const created = [];
    const updated = [];
    const deleted = [];
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
function forEachPackageItem(items, visit) {
    if (!items)
        return;
    for (let i = 0; i < items.Count; i++) {
        const item = items.get_Item(i);
        visit(item);
        forEachPackageItem(item.children, visit);
    }
}
function enforceLargeImageAtlasRule(pkg) {
    const changed = [];
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
async function publishPackages(params) {
    if (publishInProgress)
        throw new Error("已有 FairyGUI 发布任务正在执行");
    const packages = resolvePublishPackages(params);
    const branch = params.branch === undefined ? String(App.project.activeBranch || "") : String(params.branch || "");
    const saveBeforePublish = params.saveBeforePublish !== false;
    const publishDescOnly = params.publishDescOnly === true;
    validatePublishBranch(branch);
    const largeImageAtlasChanges = [];
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
    const handlers = [];
    try {
        if (saveBeforePublish) {
            App.docView.SaveAllDocuments();
            App.project.Save();
            clearAgentHistory();
        }
        const outputPaths = [];
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
        const published = [];
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
function handleCommand(request) {
    const action = String(request.action || "");
    const params = request.params || {};
    const requestProtocol = String(request.protocolVersion || "");
    if (requestProtocol && requestProtocol.split(".")[0] !== PROTOCOL_VERSION.split(".")[0])
        throw new Error(`协议版本不兼容：编辑器 ${PROTOCOL_VERSION}，客户端 ${requestProtocol}`);
    const actionsBlockedDuringPublish = {
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
            const packages = [];
            const list = App.project.allPackages;
            for (let i = 0; i < list.Count; i++)
                packages.push(describePackage(list.get_Item(i)));
            return packages;
        }
        case "list_items": {
            const pkg = resolvePackage(params);
            const items = [];
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
            const savedPackages = [];
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
                    const result = entry.kind === "animation"
                        ? applyAnimationHistory(entry, true)
                        : entry.kind === "movieclip"
                            ? applyMovieClipHistory(entry, true)
                            : applyAgentHistory(entry, true);
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
                    const result = entry.kind === "animation"
                        ? applyAnimationHistory(entry, false)
                        : entry.kind === "movieclip"
                            ? applyMovieClipHistory(entry, false)
                            : applyAgentHistory(entry, false);
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
function completeRequestSuccess(claimedPath, requestId, action, result) {
    const response = {
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
function completeRequestError(claimedPath, requestId, action, error) {
    const message = error && error.message ? String(error.message) : String(error);
    const stack = error && error.stack ? String(error.stack) : undefined;
    const response = {
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
function processRequestFile(sourcePath) {
    const fileName = IOPath.GetFileName(sourcePath);
    const claimedPath = IOPath.Combine(processingFolder, fileName);
    let request = null;
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
            result.then((value) => completeRequestSuccess(claimedPath, requestId, action, value))
                .catch((error) => completeRequestError(claimedPath, requestId, action, error));
            return;
        }
        completeRequestSuccess(claimedPath, requestId, action, result);
    }
    catch (error) {
        completeRequestError(claimedPath, requestId, action, error);
    }
}
function pollRequests() {
    const files = IODirectory.GetFiles(requestFolder, "*.json");
    const paths = [];
    for (let i = 0; i < files.Length; i++)
        paths.push(String(files.GetValue(i)));
    paths.sort();
    const count = Math.min(paths.length, MAX_COMMANDS_PER_POLL);
    for (let i = 0; i < count; i++)
        processRequestFile(paths[i]);
}
function onUpdate() {
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
function onProjectOpened() {
    initializeBridge();
}
function onProjectClosed() {
    if (initialized)
        appendLog("project closed");
    initialized = false;
}
App.add_onUpdate(onUpdate);
App.add_onProjectOpened(onProjectOpened);
App.add_onProjectClosed(onProjectClosed);
let pluginInfo = null;
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
