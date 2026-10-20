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
const BRIDGE_VERSION = "0.8.20";
const PROTOCOL_VERSION = "1.0";
const POLL_INTERVAL_FRAMES = 6;
const STATUS_MIN_INTERVAL_MS = 1000;
const MAX_COMMANDS_PER_POLL = 4;
// 超过该时长仍未被认领的请求视为残留（客户端可能已中断），拒绝执行。
const REQUEST_MAX_AGE_MS = 60000;
const DOTNET_EPOCH_TICKS = 62135596800000;
const agentUndoStack = [];
const agentRedoStack = [];
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
    sweepStaleQueueFiles();
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
function isStaleFile(path) {
    try {
        const ticks = Number(IOFile.GetLastWriteTimeUtc(path).Ticks);
        return ticks < (Date.now() - REQUEST_MAX_AGE_MS + DOTNET_EPOCH_TICKS) * 10000;
    }
    catch (_) {
        return false;
    }
}
function sweepStaleQueueFiles() {
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
            "verify_transition",
            "upsert_transition",
            "remove_transition",
            "add_keyframes",
            "set_keyframe",
            "duplicate_transition",
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
            "set_publish_settings",
            "analyze_atlas_fit",
            "clear_atlas_markers",
            "publish",
            "get_history",
            "discard_document",
            "undo",
            "redo",
            "verify_document", "replace_object_resource", "get_text_style", "set_text_style",
            "set_list_layout", "set_group_layout", "set_relation", "set_gear_display",
            "set_controller", "list_controllers",
            "query_references", "query_dependencies", "find_unused", "find_duplicate", "replace_references",
            "list_branches", "create_branch", "switch_branch"
        ]
    });
    lastStatusWrittenMs = Date.now();
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
// alone 是 FairyGUI 的内建图集名：每张图单独生成一张图集，不与小图混排。
const ALONE_ATLAS = "alone";
// 0.8.14 起退役：这三个常量只保留在 analyze_atlas_fit 的 retiredRule 诊断块里，
// 用于解释「磁盘上为什么已经存在这些 alone 标记」，不再参与任何判定。
// 真机证据（Editor 6.1.4）：1920x1080 在 maxSize=2048 的页里装得下，旧常量却给它
// alone；4096x4096 确实装不下，那时 alone 才是对的。见 tests/reports/p8-5-atlas-fit-live.json。
const RETIRED_LARGE_IMAGE_LONG_SIDE_MIN = 1920;
const RETIRED_LARGE_IMAGE_SHORT_SIDE_MIN = 1080;
const RETIRED_LARGE_IMAGE_2K_SIDE_MIN = 2048;
function retiredLargeImageRuleWouldAssign(width, height) {
    const normalizedWidth = Number(width);
    const normalizedHeight = Number(height);
    if (!isFinite(normalizedWidth) || !isFinite(normalizedHeight) || normalizedWidth <= 0 || normalizedHeight <= 0)
        return false;
    const longSide = Math.max(normalizedWidth, normalizedHeight);
    const shortSide = Math.min(normalizedWidth, normalizedHeight);
    return (longSide >= RETIRED_LARGE_IMAGE_LONG_SIDE_MIN && shortSide >= RETIRED_LARGE_IMAGE_SHORT_SIDE_MIN)
        || longSide >= RETIRED_LARGE_IMAGE_2K_SIDE_MIN;
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
        // 空串表示主干资源；分支资源带 assets_<branch> 归属。
        branch: String(item.branch || ""),
        isBranchRoot: Boolean(item.isBranchRoot),
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
        // 文档实际归属的分支。切换活跃分支后，同一 URL 打开的文档可能来自分支版本。
        branch: doc.packageItem ? String(doc.packageItem.branch || "") : null,
        isBranchRoot: doc.packageItem ? Boolean(doc.packageItem.isBranchRoot) : null,
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
// 编辑器在活跃分支下会把 FindItemByName 解析到分支资源；branch="" 要求主干时
// 必须再按 branch 字段确认，否则「显式主干」会静默打开另一分支的同名文档。
function resolveTrunkItem(params) {
    if (params && params.url)
        return resolveItem({ url: params.url });
    const item = resolveItem(params);
    if (!String(item.branch || "") && !item.isBranchRoot)
        return item;
    if (params && params.packageName) {
        const pkg = App.project.GetPackageByName(String(params.packageName));
        if (pkg) {
            pkg.EnsureOpen();
            for (let i = 0; i < pkg.items.Count; i++) {
                const candidate = pkg.items.get_Item(i);
                if (candidate.isBranchRoot || String(candidate.branch || ""))
                    continue;
                if (params.itemId && String(candidate.id) === String(params.itemId))
                    return candidate;
                if (params.itemPath && String(candidate.path) === String(params.itemPath))
                    return candidate;
                if (params.itemName) {
                    const wanted = String(params.itemName);
                    const name = String(candidate.name);
                    if (name === wanted || name.replace(/\.[^.]+$/, "") === wanted.replace(/\.[^.]+$/, ""))
                        return candidate;
                }
            }
        }
    }
    verificationError("target_not_found", `主干中没有匹配的资源：${params.itemName || params.itemId || params.itemPath || ""}`, {
        stage: "branch", branch: "", itemName: params.itemName || null, itemId: params.itemId || null, itemPath: params.itemPath || null
    });
    return null;
}
// ------------------------------------------------------------------
// Phase 8 / P8-6 分支
//
// 编辑器分支是"多态资源"：分支目录 assets_<branch> 只存与主干有差异的
// 资源，活跃分支由 FProject.activeBranch 决定。文档打开、资源解析、保存
// 都跟随活跃分支，因此 Bridge 不隐式改活跃分支，而是要求调用方显式
// switch_branch 后再带 branch 参数操作，避免"以为写分支、实际写主干"。
// ------------------------------------------------------------------
const WRITE_PATH_PROJECT_NATIVE = "project-native";
function normalizeBranchName(value) {
    const name = String(value === undefined || value === null ? "" : value).trim();
    if (!name)
        return "";
    if (name === "." || name === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(name))
        throw new Error(`分支名包含非法字符：${name}`);
    return name;
}
function activeBranchName() {
    return String((App.project && App.project.activeBranch) || "");
}
function knownBranches(refresh) {
    let scanChanged = null;
    if (refresh) {
        try {
            scanChanged = Boolean(App.project.ScanBranches());
        }
        catch (_) {
            scanChanged = null;
        }
    }
    return { names: stringListToArray(App.project.allBranches), scanChanged };
}
function branchRequested(params) {
    return Boolean(params) && Object.prototype.hasOwnProperty.call(params, "branch");
}
function branchScopeName(params) {
    return normalizeBranchName(params.branch);
}
function assertBranchScope(params, action) {
    if (!branchRequested(params))
        return;
    const requested = branchScopeName(params);
    const active = activeBranchName();
    if (requested !== active) {
        verificationError("branch_mismatch", `分支作用域不匹配：请求 ${requested || "(trunk)"}，当前活跃分支 ${active || "(trunk)"}`, {
            stage: "branch",
            action,
            requestedBranch: requested,
            activeBranch: active,
            hint: "先调用 switch_branch 切换活跃分支，再重试该操作"
        });
    }
}
function listToArray(list) {
    const result = [];
    if (!isHostObject(list))
        return result;
    for (let i = 0; i < list.Count; i++)
        result.push(list.get_Item(i));
    return result;
}
function describeItemSafe(item) {
    if (!item)
        return null;
    try {
        return describeItem(item);
    }
    catch (error) {
        return {
            id: item.id || null,
            name: item.name || null,
            type: item.type || null,
            path: item.path || null,
            branch: String(item.branch || ""),
            isBranchRoot: Boolean(item.isBranchRoot),
            url: null,
            describeError: String(error)
        };
    }
}
function branchRootItem(pkg, branch) {
    if (!branch || typeof pkg.GetBranchRootItem !== "function")
        return null;
    try {
        return pkg.GetBranchRootItem(branch);
    }
    catch (_) {
        return null;
    }
}
function describeBranchPackage(pkg, branch, includeItems) {
    let branchDirectory = null;
    if (typeof pkg.GetBranchPath === "function") {
        try {
            branchDirectory = String(pkg.GetBranchPath(branch) || "");
        }
        catch (_) {
            branchDirectory = null;
        }
    }
    const root = branchRootItem(pkg, branch);
    const children = listToArray(root ? root.children : null);
    const result = {
        package: describePackage(pkg),
        branchDirectory,
        branchPackagePath: branchPackagePath(branch, "/"),
        rootItem: describeItemSafe(root),
        childCount: children.length
    };
    if (includeItems)
        result.children = children.map(describeItemSafe);
    return result;
}
function branchDiskInfo(name) {
    const directory = IOPath.Combine(String((App.project && App.project.basePath) || ""), `assets_${name}`);
    const exists = IODirectory.Exists(directory);
    const packages = [];
    if (exists) {
        const entries = IODirectory.GetDirectories(directory);
        for (let i = 0; i < entries.Length; i++)
            packages.push(IOPath.GetFileName(String(entries.GetValue(i))));
    }
    return {
        directory,
        exists,
        packageCount: packages.length,
        packages
    };
}
function listBranches(params) {
    const refresh = params.refresh === true;
    const known = knownBranches(refresh);
    const active = activeBranchName();
    const includePackages = params.includePackages === true;
    const includeItems = params.includeItems === true;
    const branches = [];
    for (let i = 0; i < known.names.length; i++) {
        const name = known.names[i];
        const entry = {
            name,
            active: name === active,
            disk: branchDiskInfo(name)
        };
        if (includePackages) {
            entry.packages = [];
            for (let p = 0; p < App.project.allPackages.Count; p++)
                entry.packages.push(describeBranchPackage(App.project.allPackages.get_Item(p), name, includeItems));
        }
        branches.push(entry);
    }
    return {
        activeBranch: active,
        trunkActive: active === "",
        count: branches.length,
        branches,
        refresh: refresh ? { requested: true, changed: known.scanChanged } : { requested: false }
    };
}
function createBranch(params) {
    const name = normalizeBranchName(params.name);
    if (!name)
        verificationError("invalid_argument", "分支名不能为空", { stage: "input" });
    if (typeof App.project.CreateBranch !== "function")
        verificationError("unsupported_property", "编辑器未暴露 FProject.CreateBranch", { stage: "input" });
    const before = knownBranches(false).names;
    if (before.indexOf(name) >= 0)
        verificationError("invalid_argument", `分支已存在：${name}`, { stage: "input", branch: name, branches: before });
    const previousBranch = activeBranchName();
    App.project.CreateBranch(name);
    // 工程级 CreateBranch 只登记分支并建立 assets_<name>；每个包的 branch 根
    // 由 FPackage.CreateBranch 建立。缺少这一步时，切到活跃分支后新资源仍会
    // 写进主干（真机 6.1.4 已实测）。
    const packageBranches = [];
    for (let i = 0; i < App.project.allPackages.Count; i++) {
        const pkg = App.project.allPackages.get_Item(i);
        pkg.EnsureOpen();
        let packageCreated = false;
        let error = null;
        if (typeof pkg.CreateBranch === "function") {
            try {
                pkg.CreateBranch(name);
                packageCreated = true;
            }
            catch (caught) {
                error = String(caught);
            }
        }
        const root = branchRootItem(pkg, name);
        if (!root && !error)
            error = "GetBranchRootItem 未返回分支根";
        packageBranches.push({
            package: pkg.name,
            created: packageCreated,
            branchDirectory: typeof pkg.GetBranchPath === "function" ? String(pkg.GetBranchPath(name) || "") : null,
            branchPackagePath: branchPackagePath(name, "/"),
            rootItem: describeItemSafe(root),
            error
        });
    }
    // 创建后立即重扫，让 allBranches 与磁盘同步。扫描返回是否发生变化；
    // 真机上 CreateBranch 已自行刷新时它是 false，不能据此判失败。
    const after = knownBranches(true);
    const appears = after.names.indexOf(name) >= 0;
    const disk = branchDiskInfo(name);
    if (params.verify !== false) {
        if (!appears)
            verificationError("persistence_failed", "创建分支后 allBranches 中未出现该分支", {
                stage: "readback", branch: name, branches: after.names
            });
        if (!disk.exists)
            verificationError("persistence_failed", "创建分支后磁盘目录不存在", {
                stage: "disk", branch: name, directory: disk.directory
            });
        const packageErrors = packageBranches.filter(entry => entry.error);
        if (packageErrors.length > 0)
            verificationError("persistence_failed", "部分包创建分支失败", {
                stage: "package-branch", branch: name, packages: packageErrors
            });
    }
    let switched = false;
    let switchResult = null;
    if (params.switch === true) {
        switchResult = switchBranch({ name, saveOpenDocuments: params.saveOpenDocuments === true });
        switched = switchResult.switched;
    }
    lastWritePath = WRITE_PATH_PROJECT_NATIVE;
    return {
        ok: true,
        branch: name,
        created: true,
        switched,
        previousBranch: switchResult ? switchResult.previousBranch : previousBranch,
        activeBranch: activeBranchName(),
        branches: after.names,
        documents: switchResult ? switchResult.documents : undefined,
        disk,
        packageBranches,
        verification: {
            editorReadback: appears,
            disk: { performed: true, directory: disk.directory, exists: disk.exists, packageCount: disk.packageCount },
            scanChanged: after.scanChanged
        },
        writePath: WRITE_PATH_PROJECT_NATIVE,
        undoable: false,
        requiresSave: false,
        note: "分支创建走编辑器原生工程 API，立即落盘；不进入组件文档撤销栈。"
    };
}
function switchBranch(params) {
    if (!Object.prototype.hasOwnProperty.call(params, "name"))
        verificationError("invalid_argument", "必须提供 name；空字符串表示切回主干", { stage: "input" });
    const requested = normalizeBranchName(params.name);
    const known = knownBranches(false);
    if (requested && known.names.indexOf(requested) < 0)
        verificationError("target_not_found", `未找到分支：${requested}`, {
            stage: "input", branch: requested, branches: known.names
        });
    const previousBranch = activeBranchName();
    const docView = App.docView;
    const unsaved = docView && typeof docView.HasUnsavedDocuments === "function"
        ? Boolean(docView.HasUnsavedDocuments())
        : false;
    if (unsaved && params.saveOpenDocuments !== true)
        verificationError("invalid_argument", "有未保存文档，切换分支前必须先保存", {
            stage: "input", unsavedDocuments: true,
            hint: "传 saveOpenDocuments:true 让 Bridge 先保存全部文档，或手动保存后重试"
        });
    if (unsaved && params.saveOpenDocuments === true) {
        if (typeof docView.SaveAllDocuments !== "function")
            verificationError("unsupported_property", "编辑器未暴露 SaveAllDocuments，无法保存后切换", { stage: "input" });
        docView.SaveAllDocuments();
        if (typeof docView.HasUnsavedDocuments === "function" && docView.HasUnsavedDocuments())
            verificationError("persistence_failed", "保存后仍有未保存文档，拒绝切换分支", { stage: "save" });
    }
    const activeDocumentBefore = App.activeDoc ? String(App.activeDoc.docURL || "") : null;
    const changed = previousBranch !== requested;
    if (changed)
        App.project.activeBranch = requested;
    const readback = activeBranchName();
    if (readback !== requested)
        verificationError("persistence_failed", "切换分支后 activeBranch 回读不一致", {
            stage: "switch", requested, activeBranch: readback
        });
    lastWritePath = WRITE_PATH_PROJECT_NATIVE;
    return {
        ok: true,
        previousBranch,
        activeBranch: readback,
        switched: changed,
        branches: known.names,
        documents: {
            unsavedBefore: unsaved,
            activeDocumentBefore,
            activeDocumentAfter: App.activeDoc ? String(App.activeDoc.docURL || "") : null,
            activeDocumentBranch: App.activeDoc && App.activeDoc.packageItem
                ? String(App.activeDoc.packageItem.branch || "")
                : null
        },
        writePath: WRITE_PATH_PROJECT_NATIVE,
        undoable: false,
        requiresSave: false,
        note: "切换活跃分支只改变编辑器分支上下文；真机 6.1.4 上文档保存与资源创建不会自动改道，Bridge 的写操作按 branch 参数或活跃分支显式寻址。"
    };
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
// 分支写入必须显式寻址到 /:branch/ 前缀：真机 6.1.4 上 activeBranch 不会把
// CreateComponentItem / ImportResource / 文档保存改道到分支，只有包内路径能
// 决定落盘位置。缺省使用活跃分支，显式 branch:"" 只能配合切回主干使用。
function branchWriteName(params) {
    return branchRequested(params) ? branchScopeName(params) : activeBranchName();
}
function branchPackagePath(branch, folderPath) {
    const suffix = folderPath === "/" ? "" : String(folderPath).replace(/^\/+/, "");
    return `/:${branch}/${suffix}`;
}
function logicalBranchPath(item, branch) {
    if (!branch)
        return String(item.path || "/");
    const prefix = `/:${branch}/`;
    const path = String(item.path || "/");
    return path.indexOf(prefix) === 0 ? `/${path.slice(prefix.length)}` : path;
}
function resolveWriteFolder(pkg, params, folderPath, createIfMissing) {
    const branch = branchWriteName(params);
    if (!branch)
        return { folder: resolvePackageFolder(pkg, folderPath, createIfMissing), path: folderPath, branch: "" };
    const branches = knownBranches(false).names;
    if (branches.indexOf(branch) < 0)
        verificationError("target_not_found", `未找到分支：${branch}`, {
            stage: "branch", branch, branches, hint: "先调用 create_branch 创建分支"
        });
    const root = branchRootItem(pkg, branch);
    if (!root)
        verificationError("branch_mismatch", `分支 ${branch} 在包 ${pkg.name} 中没有分支根`, {
            stage: "branch", branch, package: pkg.name, hint: "重新调用 create_branch，或确认该包属于此分支"
        });
    pkg.EnsureOpen();
    if (folderPath === "/")
        return { folder: root, path: branchPackagePath(branch, "/"), branch };
    const parts = folderPath.split("/").filter(part => !!part);
    let current = root;
    let currentPath = branchPackagePath(branch, "/");
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        let next = pkg.GetItemByName(current, part);
        if (!next && createIfMissing)
            next = pkg.CreateFolder(part, currentPath, false);
        if (!next)
            throw new Error(`分支 ${branch} 中不存在目录：${folderPath}`);
        if (next.type !== FairyEditor.FPackageItemType.FOLDER)
            throw new Error(`分支 ${branch} 中路径不是目录：${folderPath}`);
        current = next;
        currentPath = branchPackagePath(branch, `/${parts.slice(0, index + 1).join("/")}/`);
    }
    return { folder: current, path: currentPath, branch };
}
function resolveBranchItem(pkg, branch, params) {
    const root = branchRootItem(pkg, branch);
    if (!root)
        return null;
    const listing = listToArray(pkg.GetItemListing(root, null, false, true, null));
    const itemId = params.itemId ? String(params.itemId) : "";
    const itemName = params.itemName ? String(params.itemName) : "";
    const itemPath = params.itemPath ? normalizePackagePath(params.itemPath) : "";
    for (let index = 0; index < listing.length; index++) {
        const item = listing[index];
        if (String(item.branch || "") !== branch)
            continue;
        if (itemId && String(item.id) === itemId)
            return item;
        if (itemName && String(item.name) === itemName)
            return item;
        if (itemPath && logicalBranchPath(item, branch) === itemPath)
            return item;
    }
    return null;
}
function assertItemBranchScope(item, params, action) {
    const target = branchWriteName(params);
    const actual = String((item && item.branch) || "");
    if (actual !== target)
        verificationError("branch_mismatch", `资源分支与请求作用域不一致：资源 ${actual || "(trunk)"}，请求 ${target || "(trunk)"}`, {
            stage: "branch", action, itemId: item ? String(item.id) : null, itemBranch: actual, requestedBranch: target,
            hint: target ? "改用分支内资源，或先 create/import 到该分支" : "先 switch_branch 切回主干"
        });
}
function assertDocumentBranchScope(params, action) {
    const doc = App.activeDoc;
    if (!doc || !doc.packageItem)
        return;
    const docBranch = String(doc.packageItem.branch || "");
    const requested = branchRequested(params) ? branchScopeName(params) : activeBranchName();
    if (docBranch !== requested)
        verificationError("branch_mismatch", `文档分支与请求作用域不一致：文档 ${docBranch || "(trunk)"}，请求 ${requested || "(trunk)"}`, {
            stage: "branch", action, documentBranch: docBranch, requestedBranch: requested,
            hint: "分支文档要求该分支为活跃分支；Bridge 无法把主干文档的保存改道到分支"
        });
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
    // 包资源创建/导入/删除走 FPackage.ImportResource / UpdateResource / DeleteItem 等
    // 包层 API，组件文档模型不参与这条路径。
    lastWritePath = WRITE_PATH_MODEL;
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
    // 组件清单写入 package.xml；组件类资源没有可靠的 asset 重载手段，故不支持 externalReload。
    validatePackageWriteOptions(params, "component", false);
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.componentName, "componentName");
    const folderPath = normalizePackagePath(params.folderPath);
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
    const actualName = resolveNewItemName(pkg, folder, requestedName, params.autoRename === true);
    const width = validateSize(params.width, 800, "width");
    const height = validateSize(params.height, 600, "height");
    const extensionId = params.extensionId ? String(params.extensionId).trim() : "";
    const exported = params.exported !== false;
    const item = pkg.CreateComponentItem(actualName, width, height, target.path, extensionId, exported, false);
    if (!item)
        throw new Error(`创建组件失败：${requestedName}`);
    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    const result = describeCreatedItem(item, "created", requestedName, folderPath, document);
    return packageWriteResult(result, pkg, packageItemRef(item, "component", target.path, false), params);
}
function normalizeConflictPolicy(value) {
    const policy = String(value || "error").toLowerCase();
    if (policy !== "error" && policy !== "auto_rename" && policy !== "replace")
        throw new Error(`未知冲突策略：${policy}`);
    return policy;
}
async function importImage(params) {
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
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
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
        const atlasAssignment = applyAtlasAssignmentForItem(pkg, existing);
        markPackageChanged(pkg);
        return packageWriteResult({
            operation: "replaced",
            requestedName,
            actualName: existing.name,
            autoRenamed: false,
            sourcePath,
            folderPath,
            atlasAssignment,
            item: describeItem(existing),
            packageModified: true,
            requiresSave: true,
            diskWrite: true
        }, pkg, packageItemRef(existing, "image", target.path, true), params);
    }
    const importFileName = `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`;
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, target.path, importFileName));
    if (!item)
        throw new Error(`导入图片失败：${sourcePath}`);
    if (item.type !== FairyEditor.FPackageItemType.IMAGE)
        throw new Error(`导入结果不是图片资源：${item.name}`);
    item.exported = params.exported !== false;
    item.SetChanged();
    const atlasAssignment = applyAtlasAssignmentForItem(pkg, item);
    markPackageChanged(pkg);
    return packageWriteResult({
        operation: "imported",
        requestedName,
        actualName: item.name,
        autoRenamed: item.name !== requestedName,
        sourcePath,
        folderPath,
        atlasAssignment,
        item: describeItem(item),
        packageModified: true,
        requiresSave: true,
        diskWrite: true
    }, pkg, packageItemRef(item, "image", target.path, true), params);
}
async function importFont(params) {
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
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
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
        }, pkg, packageItemRef(existing, "font", target.path, true), params);
    }
    const importFileName = `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`;
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, target.path, importFileName));
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
    }, pkg, packageItemRef(item, "font", target.path, true), params);
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
    validatePackageWriteOptions(params, "component", false);
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.buttonName, "buttonName");
    const folderPath = normalizePackagePath(params.folderPath);
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
    const actualName = resolveNewItemName(pkg, folder, requestedName, params.autoRename === true);
    const width = validateSize(params.width, 160, "width");
    const height = validateSize(params.height, 60, "height");
    const mode = normalizeButtonMode(params.mode);
    const images = resolveButtonImages(params);
    const extensionId = params.extensionId
        ? String(params.extensionId).trim()
        : FairyEditor.FObjectType.EXT_BUTTON;
    const templates = new FairyEditor.ComponentTemplates(pkg);
    const item = templates.CreateButtonItem(actualName, extensionId, mode, toCsStringArray(images), width, height, params.asListItem === true, params.createRelations !== false, params.createText !== false, params.createIcon !== false, params.exported !== false, target.path);
    if (!item)
        throw new Error(`创建按钮失败：${requestedName}`);
    markPackageChanged(pkg);
    const document = params.openAfterCreate === false ? null : openDocument({ url: item.GetURL() });
    const result = describeCreatedItem(item, "created", requestedName, folderPath, document);
    result.mode = mode;
    result.imageUrls = images;
    return packageWriteResult(result, pkg, packageItemRef(item, "component", target.path, false), params);
}
function openDocument(params) {
    let item = null;
    // 显式 branch 优先；省略时按活跃分支解析，branch="" 才表示主干。
    // 仅传 url 的内部调用保持按 URL 直接解析，不叠加分支上下文。
    const scopeBranch = branchRequested(params) ? branchScopeName(params) : (params && params.url ? "" : activeBranchName());
    if (scopeBranch) {
        const branch = scopeBranch;
        if (params.url) {
            item = resolveItem({ url: params.url });
        }
        else {
            const pkg = resolvePackage(params);
            item = resolveBranchItem(pkg, branch, params);
        }
        if (!item || String(item.branch || "") !== branch)
            verificationError("target_not_found", `分支 ${branch} 中没有匹配的资源`, {
                stage: "branch", branch, itemId: params.itemId || null, itemName: params.itemName || null, itemPath: params.itemPath || null,
                hint: "分支资源需先在分支内创建或导入；要打开主干资源请显式传 branch=\"\""
            });
    }
    else {
        item = resolveTrunkItem(params);
    }
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
    if (locator.name || locator.resourceURL) {
        const matches = [];
        if (locator.name)
            findObjectsByName(doc.content, String(locator.name), matches);
        else
            findObjectsByResourceUrl(doc.content, String(locator.resourceURL), matches);
        const filtered = locator.type ? matches.filter((candidate) => String(candidate.objectType || candidate.type || "") === String(locator.type)) : matches;
        if (filtered.length === 0)
            throw new Error(locator.resourceURL ? `未找到资源引用对象：${locator.resourceURL}` : `未找到对象名称：${locator.name}`);
        if (filtered.length > 1)
            throw new Error(`对象定位不唯一，共找到 ${filtered.length} 个，请改用 path 或 id`);
        return filtered[0];
    }
    throw new Error("对象定位信息缺失，请提供 target.path、target.id、target.name 或 target.resourceURL");
}
function unityColor(value, label) {
    const hex = normalizedColor(value, label).substring(1);
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    const Color = CS.UnityEngine.Color;
    return new Color(r, g, b, a);
}
function normalizedColor(value, label) {
    const color = String(value || "").trim().toUpperCase();
    if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(color))
        throw new Error(`${label} 必须是 #RRGGBB 或 #RRGGBBAA`);
    return color;
}
function targetSummary(obj, target) {
    return { id: obj.id || null, name: obj.name || null, path: target && target.path ? String(target.path) : null, type: String(obj.objectType || "unknown") };
}
// Verification is deliberately limited to properties with a known serialized meaning.
// 文本样式键的 XML 形态是 6.1.4 真机实测钉住的（tests/reports/p9-0-p9-1-probe-live.json）：
//   描边宽度 → strokeSize（**不是** stroke：stroke 只是内存里的启用布尔位，不落盘）
//   描边颜色 → strokeColor
//   投影偏移 → shadowOffset="x,y"（Bridge 侧拆成 shadowX / shadowY）
//   投影颜色 → shadowColor
//   bold/italic/underline → 同名布尔属性，false 时属性整个消失
const VERIFIED_TEXT_KEYS = ["font", "fontSize", "color", "align", "vAlign", "autoSize", "lineGap", "letterSpacing",
    "width", "height", "x", "y",
    "bold", "italic", "underline",
    "strokeSize", "strokeColor",
    "shadowX", "shadowY", "shadowColor",
    // shadow 是内存里的启用开关，不直接落盘：XML 侧由 shadowOffset 是否非零派生。
    "shadow"];
// Whitelist properties whose serialized attribute and default are pinned, so
// set_property can be covered by the same write verification semantics.
const VERIFIED_GENERIC_KEYS = ["scaleX", "scaleY", "rotation", "alpha", "visible", "touchable", "grayed", "text", "icon"];
const VERIFIED_KEYS = ["id", "name", "type", "resourceURL"].concat(VERIFIED_TEXT_KEYS, VERIFIED_GENERIC_KEYS);
function verificationError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
}
function validateExpectationsMap(flat, specPath) {
    const result = {};
    for (const key of Object.keys(flat)) {
        if (VERIFIED_KEYS.indexOf(key) < 0)
            verificationError("unsupported_property", `不支持验证属性：${key}`, { stage: "input", property: key, node: specPath });
        const value = flat[key];
        if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
            verificationError("invalid_argument", `expected.${key} 必须是字符串、数字、布尔或 null`, { stage: "input", node: specPath });
        if (typeof value === "number" && !Number.isFinite(value))
            verificationError("invalid_argument", `expected.${key} 必须是有限数字`, { stage: "input", node: specPath });
        result[key] = key === "color" ? normalizedColor(value, "color") : value;
    }
    return result;
}
function validateExpectations(expected) {
    if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length === 0)
        verificationError("invalid_argument", "expected 必须是非空属性对象", { stage: "input" });
    return validateExpectationsMap(expected, "expected");
}
function genericObjectValue(obj, key) {
    if (obj[key] !== undefined)
        return safeValue(obj[key]);
    try {
        const value = obj.GetProperty ? obj.GetProperty(key) : null;
        return value === undefined || value === null ? null : safeValue(value);
    }
    catch (error) {
        return null;
    }
}
function verifiedObjectValues(obj) {
    const value = { id: obj.id || "", name: obj.name || "", type: String(obj.objectType || "unknown").toLowerCase(), resourceURL: String(obj.objectType).toLowerCase() === "loader" ? (obj.url || null) : (obj.resourceURL || null) };
    const aliases = { vAlign: "verticalAlign", lineGap: "leading" };
    for (const key of VERIFIED_TEXT_KEYS) {
        const property = aliases[key] || key;
        if (key === "color" || key === "strokeColor" || key === "shadowColor")
            value[key] = colorHex(obj[property]);
        else if (key === "bold" || key === "italic" || key === "underline")
            value[key] = obj[property] === undefined ? null : Boolean(obj[property]);
        else
            value[key] = obj[property] === undefined ? null : safeValue(obj[property]);
    }
    // An unspecified/default font is represented by the empty string in XML.
    if (value.font === null)
        value.font = "";
    for (const key of VERIFIED_GENERIC_KEYS)
        value[key] = genericObjectValue(obj, key);
    return value;
}
function diffExpectedValues(expected, actual) {
    const differences = [];
    for (const key of Object.keys(expected)) {
        const a = actual[key] === undefined ? null : actual[key];
        const e = expected[key];
        if (!(typeof e === "number" && typeof a === "number" ? Math.abs(e - a) <= 0.00001 : e === a))
            differences.push({ property: key, expected: e, actual: a });
    }
    return differences;
}
function compareVerification(expected, actual, stage, obj) {
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
const XML_SERIALIZED_DEFAULTS = {
    font: "",
    fontSize: 12,
    color: "#FFFFFF",
    align: "left",
    vAlign: "top",
    autoSize: "none",
    letterSpacing: 0,
    lineGap: 0
};
function serializedAttr(attr, key) {
    const v = attr(key === "lineGap" ? "leading" : key);
    if (v !== null)
        return v;
    const fallback = XML_SERIALIZED_DEFAULTS[key];
    return fallback === undefined ? null : fallback;
}
// Loads and parses the XML file the active document serializes to. Read or
// parse failures are persistence failures: the ladder cannot claim disk state
// it cannot read.
function documentXml(doc, obj) {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml", target: obj ? targetSummary(obj, null) : null });
    const XmlType = CS.FairyGUI.Utils.XML;
    let xml = null;
    try {
        xml = new XmlType(String(IOFile.ReadAllText(item.file)));
    }
    catch (error) {
        verificationError("persistence_failed", "组件 XML 解析失败", { stage: "xml", file: String(item.file), reason: String(error) });
    }
    return { xml, item, file: String(item.file) };
}
function displayListElements(xml) {
    const nodes = [];
    const list = xml.GetNode("displayList");
    if (list)
        for (let i = 0; i < list.elements.Count; i++)
            nodes.push(list.elements.get_Item(i));
    return nodes;
}
function findPersistedObjectNode(doc, obj) {
    const parsed = documentXml(doc, obj);
    let node = null;
    if (obj === doc.content)
        node = parsed.xml;
    else {
        // Only direct displayList children belong to this component's serialized document.
        // Do not accidentally match a nested component or transition's target ID.
        for (const candidate of displayListElements(parsed.xml)) {
            if (String(candidate.GetAttribute("id")) === String(obj.id)) {
                if (node)
                    verificationError("persistence_failed", "XML 对象 ID 不唯一", { stage: "xml", id: obj.id });
                node = candidate;
            }
        }
    }
    if (!node)
        verificationError("persistence_failed", "XML 中未找到目标对象", { stage: "xml", target: targetSummary(obj, null) });
    return { node, item: parsed.item, file: parsed.file };
}
function persistedObjectValues(doc, obj) {
    const found = findPersistedObjectNode(doc, obj);
    return { values: xmlNodeValues(found.item, found.node), file: found.file };
}
function childXmlNodes(node, tag) {
    const out = [];
    for (let i = 0; i < node.elements.Count; i++) {
        const child = node.elements.get_Item(i);
        if (String(child.name) === tag)
            out.push(child);
    }
    return out;
}
function xmlNodeValues(item, node) {
    const attr = (key) => { const v = node.GetAttribute(key); return v === null || v === undefined ? null : String(v); };
    const value = { id: attr("id") || "", name: attr("name") || "", type: String(node.name), resourceURL: null };
    if (value.type === "loader")
        value.resourceURL = attr("url");
    else if (attr("src"))
        value.resourceURL = `ui://${attr("pkg") || item.owner.id}${attr("src")}`;
    for (const key of ["font", "fontSize", "color", "align", "vAlign", "autoSize", "letterSpacing", "lineGap"])
        value[key] = serializedAttr(attr, key);
    if (value.color !== null)
        value.color = normalizedColor(value.color, "XML color");
    for (const key of ["fontSize", "letterSpacing", "lineGap"])
        if (value[key] !== null)
            value[key] = Number(value[key]);
    // 0.8.20：字重与描边/投影的 XML 形态由真机 6.1.4 钉死
    // （tests/reports/p9-0-p9-1-probe-live.json A2/A3/A5/A8）：
    //   描边宽度是 strokeSize（不是 stroke）；投影偏移是 shadowOffset="x,y"；
    //   布尔字重为 false 时属性整个不存在；描边宽度的缺省是 1（不是 0）。
    for (const key of ["bold", "italic", "underline"]) {
        const raw = attr(key);
        value[key] = raw === null ? false : raw === "true";
    }
    const strokeSize = attr("strokeSize");
    value.strokeSize = strokeSize === null ? 1 : Number(strokeSize);
    const strokeColor = attr("strokeColor");
    value.strokeColor = strokeColor === null ? "#000000" : normalizedColor(strokeColor, "XML strokeColor");
    const shadowOffset = attr("shadowOffset");
    const offset = shadowOffset ? shadowOffset.split(",").map(Number) : [];
    value.shadowX = offset.length > 0 && !isNaN(offset[0]) ? offset[0] : 0;
    value.shadowY = offset.length > 1 && !isNaN(offset[1]) ? offset[1] : 0;
    const shadowColor = attr("shadowColor");
    value.shadowColor = shadowColor === null ? "#000000" : normalizedColor(shadowColor, "XML shadowColor");
    // 投影开关不落盘：编辑器只在启用时写 shadowOffset，所以由它反推。
    value.shadow = shadowOffset !== null && shadowOffset !== "0,0";
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
    value.x = xy[0];
    value.y = xy[1];
    let size = attr("size");
    // Image size may be omitted when it equals the referenced resource's dimensions.
    if (!size && value.type === "image" && value.resourceURL) {
        const resource = App.project.GetItemByURL(value.resourceURL);
        if (resource)
            size = `${resource.width},${resource.height}`;
    }
    const dimensions = size ? size.split(",").map(Number) : [null, null];
    value.width = dimensions[0];
    value.height = dimensions[1];
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
function closeDocumentForReload(docView, url) {
    const attempts = [];
    const strategies = [
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
function reloadDocument(doc, context) {
    const url = String(doc.docURL || "");
    const details = context || {};
    if (!url)
        verificationError("persistence_failed", "无法获取文档 URL，拒绝执行 external reload", Object.assign({ stage: "reload" }, details));
    if (doc.isModified)
        verificationError("invalid_argument", "external reload 要求文档已保存：有未保存改动时重载只会回到旧值", Object.assign({ stage: "reload", url }, details));
    const docView = App.docView;
    if (!docView || typeof docView.OpenDocument !== "function")
        verificationError("persistence_failed", "编辑器未暴露可用的 docView.OpenDocument，无法执行 external reload", Object.assign({ stage: "reload", url }, details));
    const closeStrategy = closeDocumentForReload(docView, url);
    let reopened = null;
    try {
        reopened = docView.OpenDocument(url, true);
    }
    catch (error) {
        verificationError("persistence_failed", "external reload 重新打开文档失败", Object.assign({ stage: "reload", url, closeStrategy, reason: String(error) }, details));
    }
    if (!reopened)
        verificationError("persistence_failed", "external reload 重新打开文档失败：文档未载入", Object.assign({ stage: "reload", url, closeStrategy }, details));
    return { doc: reopened, url, closeStrategy };
}
function externalReloadVerify(doc, locator, expected, state, memoryFn) {
    const rr = reloadDocument(doc, { expected });
    // Every handle captured before the close is now stale; re-locate the target by
    // its recorded locator instead of reusing the pre-close object reference.
    let reloaded = null;
    try {
        reloaded = resolveObject(rr.doc, locator);
    }
    catch (error) {
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
function persistedNodeExists(doc, objectId) {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml" });
    const XmlType = CS.FairyGUI.Utils.XML;
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
function externalReloadVerifyAbsent(doc, locator, state) {
    const rr = reloadDocument(doc, {});
    let stillPresent = null;
    try {
        stillPresent = resolveObject(rr.doc, locator);
    }
    catch (error) {
        stillPresent = null;
    }
    if (stillPresent)
        verificationError("persistence_failed", "external reload 后目标节点仍然存在", { stage: "reload", url: rr.url, closeStrategy: rr.closeStrategy, target: locator });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, absent: true };
}
function verificationStrength(verification, saved) {
    if (verification && verification.reload && verification.reload.performed)
        return RELOAD_STRENGTH;
    if (saved && verification && verification.xmlReadback)
        return DISK_STRENGTH;
    return NONE_STRENGTH;
}
function strengthNote(verification, saved, base) {
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
function verifyObject(doc, obj, expected, readXml, reload, state, readers) {
    const memoryReader = readers && readers.memory ? readers.memory : verifiedObjectValues;
    const persistedReader = readers && readers.persisted ? readers.persisted : persistedObjectValues;
    const editor = compareVerification(expected, memoryReader(obj), "editor", obj);
    let disk = null;
    if (readXml) {
        try {
            disk = persistedReader(doc, obj);
            // Skipped keys (absent serialized attrs whose default is not pinned)
            // are reported via xmlSkippedKeys rather than compared — the absent
            // attribute is ambiguous, not evidence of a failed write.
            const skipped = {};
            for (const k of (disk.skipped || []))
                skipped[k] = true;
            const xmlExpected = {};
            for (const k of Object.keys(expected)) {
                if (skipped[k])
                    continue;
                // 组件根节点不序列化 name（文件名即组件名），拿它做 XML 断言会让每次根对象写入都误报。
                if (obj === doc.content && k === "name")
                    continue;
                xmlExpected[k] = expected[k];
            }
            compareVerification(xmlExpected, disk.values, "xml", obj);
        }
        catch (error) {
            if (error.code)
                throw error;
            verificationError("persistence_failed", "XML 读取或解析失败", { stage: "xml", target: targetSummary(obj, null), reason: String(error), expected });
        }
    }
    // Must run last: it closes the document, and the disk read above still needs
    // the open handle to resolve the component URL.
    let reloaded = null;
    if (reload)
        reloaded = externalReloadVerify(doc, reload.target, expected, state || {}, memoryReader);
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
function validateReloadOptions(params, target) {
    if (!params.externalReload)
        return;
    if (params.verify === false)
        verificationError("invalid_argument", "external reload 与 verify:false 冲突：verify:false 表示调用方主动关闭验证", { stage: "input", target });
    if (!params.save)
        verificationError("invalid_argument", "external reload 需要 save:true：未保存时重载只会回到旧值，无法证明持久化", { stage: "input", target });
}
function writeVerification(doc, obj, before, after, params, expected, readers) {
    const wantsReload = Boolean(params.externalReload);
    // Captured before any reload: the target summary must not read a closed handle.
    const target = targetSummary(obj, params.target);
    // Guard repeated here so a new write action cannot skip the precondition.
    validateReloadOptions(params, target);
    // Editor acceptance is checked even with verify=false; that flag only skips disk readback.
    const verification = verifyObject(doc, obj, expected, false, null, null, readers);
    let saved = false;
    if (params.save) {
        // Silent-save precondition: if neither the editor's document model nor the
        // explicit doc.SetModified(true) registered the change, doc.Save() would
        // report success while writing nothing — the exact failure signature seen
        // with FRelations.Reset()+AddItem on 6.1.4. Fail closed before attempting it.
        //
        // Only meaningful when the write actually changed something: a request that
        // resolves to the value already present (e.g. replacing an image with the
        // same resource again) legitimately leaves the document unmodified, and
        // treating that as a bypass would reject a correct no-op.
        const changedInMemory = !valuesEqual(before, after);
        if (changedInMemory && doc.isModified !== true)
            verificationError("persistence_failed", "写入后文档未进入修改状态，保存会静默跳过；这通常意味着写入绕过了编辑器文档模型", { stage: "modified", target, writePath: lastWritePath, expected });
        try {
            doc.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = doc.isModified === false;
        if (!saved)
            verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }
    const state = {};
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
        // Which editor layer actually applied the write. object-model here means the
        // write bypassed the document model and persistence rests on the explicit
        // SetModified + disk readback alone.
        writePath: lastWritePath,
        note: `${strengthNote(checked, saved, "仅验证 expected 中的字段；")}失败不自动回滚。`
    };
}
// ---------- Phase 4: typed layout / relation / gear / controller writes ----------
function numOrNull(value) {
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
const LIST_LAYOUT_KEYS = {
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
const GROUP_LAYOUT_KEYS = {
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
function layoutMemberValue(obj, spec) {
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined)
        return safeValue(obj[member]);
    if (typeof obj.GetProperty === "function") {
        try {
            const v = obj.GetProperty(spec.attr);
            if (v !== undefined && v !== null)
                return safeValue(v);
        }
        catch (_) { }
    }
    if (spec.kind === "number")
        return 0;
    if (spec.kind === "bool")
        return false;
    return "";
}
function assignLayoutMember(obj, spec, value) {
    // List/Group 布局成员在编辑器对象模型里就是公开字段，直接成员赋值，
    // 不经过 DocElement（序列化属性名与成员名不一定一致）。
    lastWritePath = WRITE_PATH_MODEL;
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined) {
        obj[member] = value;
        return;
    }
    if (typeof obj.SetProperty === "function") {
        obj.SetProperty(spec.attr, value);
        return;
    }
    obj[member] = value;
}
// Write-path support probe run during validation, before any mutation: a field
// the editor has neither as member nor as generic property is reported as
// unsupported_property instead of blowing up mid-apply (C# side throws
// "<prop> not exists").
function layoutMemberSupported(obj, spec) {
    const member = spec.member || spec.attr;
    if (obj[member] !== undefined)
        return true;
    if (typeof obj.GetProperty === "function") {
        try {
            obj.GetProperty(spec.attr);
            return true;
        }
        catch (_) {
            return false;
        }
    }
    return false;
}
function typedLayoutValues(obj, keys) {
    const out = { id: obj.id || "", name: obj.name || "", type: String(obj.objectType || "unknown").toLowerCase() };
    for (const key of Object.keys(keys)) {
        const spec = keys[key];
        const raw = layoutMemberValue(obj, spec);
        if (spec.kind === "number")
            out[key] = numOrNull(raw) === null ? 0 : numOrNull(raw);
        else if (spec.kind === "bool")
            out[key] = raw === true || raw === "true";
        else
            out[key] = raw === null || raw === undefined ? "" : String(raw);
    }
    return out;
}
function persistedLayoutValues(doc, obj, keys) {
    const found = findPersistedObjectNode(doc, obj);
    const node = found.node;
    const attr = (key) => { const v = node.GetAttribute(key); return v === null || v === undefined ? null : String(v); };
    const out = { id: attr("id") || "", name: attr("name") || "", type: String(node.name) };
    const skipped = [];
    for (const key of Object.keys(keys)) {
        const spec = keys[key];
        const raw = attr(spec.attr);
        if (raw === null) {
            if (spec.skipIfAbsent || spec.kind === "enum") {
                skipped.push(key);
                continue;
            }
            if (spec.xmlDefault !== undefined) {
                out[key] = spec.xmlDefault;
                continue;
            }
            out[key] = spec.kind === "number" ? 0 : spec.kind === "bool" ? false : "";
        }
        else if (spec.kind === "number")
            out[key] = Number(raw);
        else if (spec.kind === "bool")
            out[key] = raw === "true";
        else
            out[key] = raw;
    }
    return { values: out, file: found.file, skipped };
}
function layoutReaders(keys) {
    return {
        memory: (o) => typedLayoutValues(o, keys),
        persisted: (d, o) => persistedLayoutValues(d, o, keys)
    };
}
// Layout fields arrive as flat params alongside the control keys; everything
// outside the reserved set is treated as a field to write.
const LAYOUT_RESERVED_PARAMS = ["target", "save", "verify", "externalReload"];
function layoutFieldSubset(params) {
    const fields = {};
    for (const key of Object.keys(params || {}))
        if (LAYOUT_RESERVED_PARAMS.indexOf(key) < 0)
            fields[key] = params[key];
    return fields;
}
function listLayoutConstant(value) {
    const key = String(value);
    const map = {
        single_column: "SINGLE_COLUMN", single_row: "SINGLE_ROW",
        flow_horizontal: "FLOW_HZ", flow_vertical: "FLOW_VT", pagination: "PAGINATION"
    };
    const constants = FairyEditor.FList || {};
    if (map[key] !== undefined) {
        const resolved = constants[map[key]];
        if (resolved === undefined || resolved === null)
            verificationError("invalid_argument", `编辑器未暴露 FList.${map[key]} 常量`, { stage: "input", layout: key });
        return String(resolved);
    }
    const raw = ["hz", "vt", "flow_hz", "flow_vt", "pagination"];
    if (raw.indexOf(key) >= 0)
        return key;
    verificationError("invalid_argument", `layout 无效：${key}`, { stage: "input", allowed: Object.keys(map).concat(raw) });
}
function groupLayoutConstant(value) {
    const key = String(value);
    const map = { horizontal: "HORIZONTAL", vertical: "VERTICAL" };
    const constants = FairyEditor.FGroup || {};
    if (map[key] !== undefined) {
        const resolved = constants[map[key]];
        if (resolved === undefined || resolved === null)
            verificationError("invalid_argument", `编辑器未暴露 FGroup.${map[key]} 常量`, { stage: "input", layout: key });
        return String(resolved);
    }
    const raw = ["hz", "vt"];
    if (raw.indexOf(key) >= 0)
        return key;
    verificationError("invalid_argument", `layout 无效：${key}`, { stage: "input", allowed: Object.keys(map).concat(raw) });
}
function applyTypedLayoutWrite(doc, params, objectType, keys, values) {
    const obj = resolveObject(doc, params.target);
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
    const coerced = [];
    for (const key of provided) {
        const spec = keys[key];
        const value = values[key];
        if (!spec)
            verificationError("unsupported_property", `不支持的布局字段：${key}`, { stage: "input", property: key });
        if (!layoutMemberSupported(obj, spec))
            verificationError("unsupported_property", `当前编辑器不支持写入属性：${spec.attr}`, { stage: "input", property: key });
        switch (key) {
            case "layout":
                coerced.push({ key, spec, value: type === "list" ? listLayoutConstant(value) : groupLayoutConstant(value) });
                break;
            case "selectionMode":
                if (["none", "single", "multiple", "multiple_singleclick"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `selectionMode 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) });
                break;
            case "lineGap":
            case "columnGap":
            case "mainGridMinSize":
            case "mainGridIndex": {
                const n = numOrNull(value);
                if (n === null)
                    verificationError("invalid_argument", `${key} 必须是数字`, { stage: "input", property: key });
                coerced.push({ key, spec, value: n });
                break;
            }
            case "defaultItem": {
                const url = String(value || "");
                if (url === "") {
                    coerced.push({ key, spec, value: "" });
                    break;
                }
                if (url.indexOf("ui://") !== 0)
                    verificationError("invalid_argument", "defaultItem 必须是 ui:// URL", { stage: "input", value: url });
                const item = resolveItem({ url });
                if (String(item.type) !== FairyEditor.FPackageItemType.COMPONENT)
                    verificationError("invalid_argument", "defaultItem 必须引用组件资源", { stage: "input", resourceURL: url });
                coerced.push({ key, spec, value: String(item.GetURL()) });
                break;
            }
            case "autoItemSize":
            case "foldInvisibleItems":
            case "clearOnPublish":
            case "scrollItemToViewOnClick":
            case "advanced":
            case "excludeInvisibles":
            case "autoSizeDisabled":
            case "collapsed":
                coerced.push({ key, spec, value: Boolean(value) });
                break;
            case "align":
                if (["none", "left", "center", "right"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `align 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) });
                break;
            case "vAlign":
                if (["none", "top", "middle", "bottom"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `vAlign 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) });
                break;
            case "selectionController": {
                const name = String(value || "");
                if (name && !doc.content.GetController(name))
                    verificationError("invalid_argument", `selectionController 引用的控制器不存在：${name}`, { stage: "input" });
                coerced.push({ key, spec, value: name });
                break;
            }
            case "overflow":
                if (["visible", "auto", "hidden", "scroll"].indexOf(String(value)) < 0)
                    verificationError("invalid_argument", `overflow 枚举值无效：${value}`, { stage: "input" });
                coerced.push({ key, spec, value: String(value) });
                break;
            case "margin":
                coerced.push({ key, spec, value: String(value) });
                break;
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
    for (const entry of coerced)
        assignLayoutMember(obj, entry.spec, entry.value);
    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = typedLayoutValues(obj, keys);
    const expected = { id: obj.id, name: obj.name || "", type };
    for (const key of provided)
        expected[key] = specValueForExpected(key, values[key], after, keys[key]);
    return writeVerification(doc, obj, before, after, params, expected, layoutReaders(keys));
}
// Enum-ish values are normalized to the canonical serialized form only where a
// constant is known; otherwise the post-write readback is used as expected so
// editor-side canonicalization cannot produce a false mismatch.
function specValueForExpected(key, requested, after, spec) {
    // Enum members store the serialized string in the editor object model, but
    // the Editor may still canonicalize differently from what was requested —
    // trust the readback for every enum-kind field.
    if (spec && spec.kind === "enum")
        return after[key];
    if (spec && spec.kind === "bool")
        return Boolean(requested);
    if (spec && spec.kind === "number")
        return numOrNull(requested);
    return requested === undefined || requested === null ? "" : String(requested);
}
// <relation> and <gearDisplay> serialize as child elements of the object node,
// so they get their own flat keyspace: `relation.<targetId>` ("" = parent) and
// `gearDisplay.controller`/`gearDisplay.pages`.
const RELATION_SIDES = ["left", "center", "right", "leftext", "rightext", "width",
    "top", "middle", "bottom", "topext", "bottomext", "height"];
function canonicalSidePair(sidePair) {
    const parts = String(sidePair || "").split(",").map(s => s.trim()).filter(s => s.length);
    parts.sort();
    return parts.join(",");
}
function validateSidePair(sidePair, specPath) {
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
function relationsFromXml(node) {
    const out = {};
    for (const child of childXmlNodes(node, "relation")) {
        const sidePair = canonicalSidePair(child.GetAttribute("sidePair") || "");
        if (sidePair)
            out[`relation.${child.GetAttribute("target") || ""}`] = sidePair;
    }
    return out;
}
function relationMemoryValues(obj) {
    const out = {};
    const rel = obj.relations;
    if (!rel)
        return out;
    // Prefer the serialized form so canonicalization matches the XML stage.
    try {
        if (typeof rel.Write === "function") {
            const xml = rel.Write();
            const collect = (n) => {
                const sidePair = canonicalSidePair(n.GetAttribute("sidePair") || "");
                if (sidePair)
                    out[`relation.${n.GetAttribute("target") || ""}`] = sidePair;
            };
            if (xml && String(xml.name) === "relation")
                collect(xml);
            else if (xml)
                for (const child of childXmlNodes(xml, "relation"))
                    collect(child);
            return out;
        }
    }
    catch (_) { /* fall through to item iteration */ }
    if (rel.items) {
        for (let i = 0; i < rel.items.Count; i++) {
            const item = rel.items.get_Item(i);
            const targetId = item.target && item.target.id ? String(item.target.id) : "";
            out[`relation.${targetId}`] = canonicalSidePair(item.desc || "");
        }
    }
    return out;
}
function persistedRelationValues(doc, obj) {
    const found = findPersistedObjectNode(doc, obj);
    const values = relationsFromXml(found.node);
    values.id = found.node.GetAttribute("id") || "";
    values.name = found.node.GetAttribute("name") || "";
    values.type = String(found.node.name);
    return { values, file: found.file };
}
function relationReaders() {
    return {
        memory: (o) => {
            const out = relationMemoryValues(o);
            out.id = o.id || "";
            out.name = o.name || "";
            out.type = String(o.objectType || "unknown").toLowerCase();
            return out;
        },
        persisted: persistedRelationValues
    };
}
function setRelation(params) {
    const doc = getActiveDocument();
    const obj = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    if (obj === doc.content)
        verificationError("invalid_argument", "不支持对文档根组件设置 relation", { stage: "input", target: targetSummary(obj, params.target) });
    if (!Array.isArray(params.relations))
        verificationError("invalid_argument", "relations 必须是数组", { stage: "input" });
    const specs = params.relations.map((spec, i) => {
        if (!spec || typeof spec !== "object")
            verificationError("invalid_argument", `relations[${i}] 必须是对象`, { stage: "input" });
        let sidePair = "";
        if (spec.sidePair !== undefined)
            sidePair = validateSidePair(String(spec.sidePair), `relations[${i}]`);
        else if (Array.isArray(spec.pairs)) {
            const parts = spec.pairs.map((p, j) => {
                if (!p || typeof p !== "object" || !p.source || !p.target)
                    verificationError("invalid_argument", `relations[${i}].pairs[${j}] 需要 source 与 target`, { stage: "input" });
                return `${String(p.source).toLowerCase()}-${String(p.target).toLowerCase()}${p.percent ? "%" : ""}`;
            });
            sidePair = validateSidePair(parts.join(","), `relations[${i}]`);
        }
        else
            verificationError("invalid_argument", `relations[${i}] 需要 sidePair 或 pairs`, { stage: "input" });
        let targetObj = null;
        if (spec.target !== undefined && spec.target !== null && spec.target !== "") {
            targetObj = resolveObject(doc, spec.target);
            if (targetObj === obj)
                verificationError("invalid_argument", `relations[${i}] 不能把对象自身作为 target`, { stage: "input" });
        }
        return { targetObj, sidePair };
    });
    const before = relationMemoryValues(obj);
    const rel = obj.relations;
    if (!rel)
        verificationError("unsupported_property", "目标对象不支持 relation", { stage: "input", target: targetSummary(obj, params.target) });
    const el = obj.docElement;
    let applied = false;
    if (el && typeof el.UpdateRelations === "function") {
        // Preferred path: replace the whole relation set through the serialized
        // <relations> document (same shape FRelations.Write() emits). Direct
        // FRelations.Reset()+AddItem() bypasses the document model and leaves
        // the doc stuck modified on 6.1.4.
        const inner = specs.map((s) => `<relation target="${s.targetObj && s.targetObj.id ? String(s.targetObj.id) : ""}" sidePair="${s.sidePair}"/>`).join("");
        try {
            el.UpdateRelations(new CS.FairyGUI.Utils.XML(`<relations>${inner}</relations>`));
            applied = true;
        }
        catch (_) {
            applied = false;
        }
    }
    if (!applied && el && typeof el.SetRelation === "function") {
        try {
            const wantedIds = {};
            for (const spec of specs)
                wantedIds[spec.targetObj && spec.targetObj.id ? String(spec.targetObj.id) : ""] = true;
            if (rel.items && typeof el.RemoveRelation === "function") {
                for (let i = rel.items.Count - 1; i >= 0; i--) {
                    const oldItem = rel.items.get_Item(i);
                    const oldId = oldItem.target && oldItem.target.id ? String(oldItem.target.id) : "";
                    if (!wantedIds[oldId])
                        el.RemoveRelation(oldItem.target);
                }
            }
            for (const spec of specs)
                el.SetRelation(spec.targetObj, spec.sidePair);
            applied = true;
        }
        catch (_) {
            applied = false;
        }
    }
    if (!applied) {
        if (typeof rel.Reset === "function")
            rel.Reset();
        else if (rel.items)
            while (rel.items.Count > 0)
                rel.RemoveItem(rel.items.get_Item(0));
        for (const spec of specs)
            rel.AddItem(spec.targetObj, spec.sidePair);
    }
    lastWritePath = applied ? WRITE_PATH_DOCUMENT : WRITE_PATH_MODEL;
    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = relationMemoryValues(obj);
    // Requested state (normalized) must match what the editor actually applied;
    // after-readback supplies the canonical sidePair encoding.
    const wanted = {};
    for (const spec of specs)
        wanted[`relation.${spec.targetObj && spec.targetObj.id ? String(spec.targetObj.id) : ""}`] = canonicalSidePair(spec.sidePair);
    const actual = {};
    for (const key of Object.keys(after))
        if (key.indexOf("relation.") === 0)
            actual[key] = after[key];
    const rejection = diffExpectedValues(wanted, actual);
    if (rejection.length)
        verificationError("editor_rejected", "编辑器未按请求写入 relation", { stage: "editor", target: targetSummary(obj, params.target), expected: wanted, actual, differences: rejection });
    const expected = Object.assign({ id: obj.id, name: obj.name || "", type: String(obj.objectType || "").toLowerCase() }, actual);
    return writeVerification(doc, obj, before, after, params, expected, relationReaders());
}
// GearDisplay rides on gear index 0 (FairyGUI gear order: Display=0, XY=1, ...).
const GEAR_INDEX_DISPLAY = 0;
function normalizeGearPages(pages) {
    if (pages === undefined || pages === null)
        return "";
    const list = Array.isArray(pages) ? pages.map(String) : String(pages).split(",");
    const cleaned = list.map(s => s.trim()).filter(s => s.length);
    cleaned.sort();
    return cleaned.join(",");
}
// FObject.GetGear returns FairyEditor.Framework.Gears.IGear — an empty marker
// interface — so the live gear state must be read through WriteGears()'s
// serialized XML instead of member access.
function gearValuesFromXml(xml, out) {
    const collect = (n) => {
        out["gearDisplay.controller"] = String(n.GetAttribute("controller") || "");
        out["gearDisplay.pages"] = normalizeGearPages(n.GetAttribute("pages") || "");
    };
    if (xml && String(xml.name) === "gearDisplay")
        collect(xml);
    else if (xml)
        for (const child of childXmlNodes(xml, "gearDisplay")) {
            collect(child);
            break;
        }
    return out;
}
function gearMemoryValues(obj) {
    const out = { "gearDisplay.controller": "", "gearDisplay.pages": "" };
    try {
        if (typeof obj.WriteGears === "function")
            gearValuesFromXml(obj.WriteGears(), out);
        else if (typeof obj.GetGear === "function") {
            // Mock-host / older-API fallback via member access.
            const gear = obj.GetGear(GEAR_INDEX_DISPLAY);
            if (gear) {
                const controller = gear.controller;
                if (controller)
                    out["gearDisplay.controller"] = String(controller.name || controller);
                if (gear.pages)
                    out["gearDisplay.pages"] = normalizeGearPages(Array.from(gear.pages) || []);
            }
        }
    }
    catch (_) { /* gear layer not readable; report empty */ }
    out.id = obj.id || "";
    out.name = obj.name || "";
    out.type = String(obj.objectType || "unknown").toLowerCase();
    return out;
}
function persistedGearValues(doc, obj) {
    const found = findPersistedObjectNode(doc, obj);
    const nodes = childXmlNodes(found.node, "gearDisplay");
    const node = nodes.length ? nodes[0] : null;
    const values = {
        "gearDisplay.controller": node ? String(node.GetAttribute("controller") || "") : "",
        "gearDisplay.pages": node ? normalizeGearPages(node.GetAttribute("pages") || "") : "",
        id: found.node.GetAttribute("id") || "",
        name: found.node.GetAttribute("name") || "",
        type: String(found.node.name)
    };
    return { values, file: found.file };
}
function gearReaders() {
    return { memory: gearMemoryValues, persisted: persistedGearValues };
}
function resolveController(doc, name) {
    const content = doc.content;
    if (!content || typeof content.GetController !== "function")
        return null;
    return content.GetController(name);
}
function setGearDisplay(params) {
    const doc = getActiveDocument();
    const obj = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    if (params.controller === undefined)
        verificationError("invalid_argument", "缺少 controller 字段（null/空字符串表示清除联动）", { stage: "input" });
    const controllerName = String(params.controller || "");
    let controller = null;
    if (controllerName) {
        controller = resolveController(doc, controllerName);
        if (!controller)
            verificationError("target_not_found", `控制器不存在：${controllerName}`, { stage: "input", controller: controllerName });
    }
    let pagesCsv = null;
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
            const resolved = [];
            for (const pageId of pagesCsv.split(",")) {
                if (controller.HasPageId && controller.HasPageId(pageId))
                    resolved.push(pageId);
                else if (controller.GetPages) {
                    const pageList = controller.GetPages();
                    for (let i = 0; i < pageList.Count; i++) {
                        const p = pageList.get_Item(i);
                        if (String(p.name) === pageId) {
                            resolved.push(String(p.id));
                            break;
                        }
                    }
                }
            }
            resolved.sort();
            pagesCsv = resolved.join(",");
        }
    }
    // Unbinding the controller leaves a controller-less gear with dangling page
    // references; clear the pages as well so the gear is fully removed.
    if (!controllerName && params.pages === undefined)
        pagesCsv = "";
    const before = gearMemoryValues(obj);
    const el = obj.docElement;
    let applied = false;
    if (el && typeof el.UpdateGears === "function") {
        // Preferred path: rewrite the whole <gears> set through the document
        // model. Every non-gearDisplay child is copied across unchanged so the
        // update never wipes gearXY/gearSize/etc. the caller did not touch.
        try {
            const XmlType = CS.FairyGUI.Utils.XML;
            const gears = new XmlType("<gears/>");
            if (typeof obj.WriteGears === "function") {
                const current = obj.WriteGears();
                if (current && String(current.name) !== "gearDisplay") {
                    for (let i = 0; i < current.elements.Count; i++) {
                        const child = current.elements.get_Item(i);
                        if (String(child.name) === "gearDisplay")
                            continue;
                        gears.AppendChild(new XmlType(String(child.ToXMLString())));
                    }
                }
            }
            if (controllerName) {
                const pagesAttr = pagesCsv === null ? (before["gearDisplay.pages"] || "") : pagesCsv;
                const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
                gears.AppendChild(new XmlType(`<gearDisplay controller="${escAttr(controllerName)}" pages="${escAttr(pagesAttr)}"/>`));
            }
            el.UpdateGears(gears);
            applied = true;
        }
        catch (_) {
            applied = false;
        }
    }
    if (!applied && el && typeof el.SetGearProperty === "function") {
        try {
            el.SetGearProperty(GEAR_INDEX_DISPLAY, "controller", controller);
            if (pagesCsv !== null)
                el.SetGearProperty(GEAR_INDEX_DISPLAY, "pages", pagesCsv);
            applied = true;
        }
        catch (_) {
            applied = false;
        }
    }
    if (!applied) {
        const gear = typeof obj.GetGear === "function" ? obj.GetGear(GEAR_INDEX_DISPLAY, true) : null;
        if (!gear)
            verificationError("unsupported_property", "目标对象不支持 gearDisplay 写入路径", { stage: "editor", target: targetSummary(obj, params.target) });
        try {
            gear.controller = controller;
        }
        catch (_) {
            try {
                gear.controller = controllerName || null;
            }
            catch (error) {
                verificationError("editor_rejected", `gearDisplay.controller 赋值失败：${String(error)}`, { stage: "editor", target: targetSummary(obj, params.target) });
            }
        }
        if (pagesCsv !== null) {
            try {
                gear.pages = pagesCsv ? pagesCsv.split(",") : [];
            }
            catch (_) {
                try {
                    gear.pages = pagesCsv;
                }
                catch (error) {
                    verificationError("editor_rejected", `gearDisplay.pages 赋值失败：${String(error)}`, { stage: "editor", target: targetSummary(obj, params.target) });
                }
            }
        }
    }
    lastWritePath = applied ? WRITE_PATH_DOCUMENT : WRITE_PATH_MODEL;
    doc.SetModified(true);
    doc.RefreshInspectors();
    if (typeof obj.CheckGearDisplay === "function") {
        try {
            obj.CheckGearDisplay();
        }
        catch (_) { }
    }
    const after = gearMemoryValues(obj);
    const wanted = { "gearDisplay.controller": controllerName, "gearDisplay.pages": pagesCsv === null ? after["gearDisplay.pages"] : pagesCsv };
    const actual = { "gearDisplay.controller": after["gearDisplay.controller"], "gearDisplay.pages": after["gearDisplay.pages"] };
    const rejection = diffExpectedValues(wanted, actual);
    if (rejection.length)
        verificationError("editor_rejected", "编辑器未按请求写入 gearDisplay", { stage: "editor", target: targetSummary(obj, params.target), expected: wanted, actual, differences: rejection });
    const expected = Object.assign({ id: obj.id, name: obj.name || "", type: String(obj.objectType || "").toLowerCase() }, actual);
    return writeVerification(doc, obj, before, after, params, expected, gearReaders());
}
// ---------- Controllers ----------
function controllerMemoryValues(doc, name) {
    const c = resolveController(doc, name);
    if (!c)
        return { name, present: false, pageCount: null, pageNames: null, selectedIndex: null };
    let names = [];
    try {
        // GetPageNames() returns "id:name" entries in the live editor; the real
        // page names (matching the serialized form) live on the page objects.
        const list = c.GetPages ? c.GetPages() : null;
        if (list)
            for (let i = 0; i < list.Count; i++)
                names.push(String(list.get_Item(i).name));
        else {
            const fallback = c.GetPageNames ? c.GetPageNames() : null;
            if (fallback)
                for (let i = 0; i < fallback.Count; i++)
                    names.push(String(fallback.get_Item(i)));
        }
    }
    catch (_) { }
    return {
        name, present: true,
        pageCount: numOrNull(c.pageCount),
        pageNames: names.join(","),
        selectedIndex: numOrNull(c.selectedIndex)
    };
}
function persistedControllerValues(doc, name) {
    const parsed = documentXml(doc, null);
    let node = null;
    for (let i = 0; i < parsed.xml.elements.Count; i++) {
        const candidate = parsed.xml.elements.get_Item(i);
        if (String(candidate.name) === "controller" && String(candidate.GetAttribute("name") || "") === name) {
            if (node)
                verificationError("persistence_failed", "XML 中存在同名 Controller", { stage: "xml", name });
            node = candidate;
        }
    }
    if (!node)
        return { values: { name, present: false, pageCount: null, pageNames: null, selectedIndex: null }, file: parsed.file };
    // pages serializes as alternating id,name pairs.
    const rawPages = String(node.GetAttribute("pages") || "").split(",").filter((s) => s.length);
    const names = [];
    for (let i = 1; i < rawPages.length; i += 2)
        names.push(rawPages[i]);
    const values = {
        name, present: true,
        pageCount: names.length,
        pageNames: names.join(","),
        selectedIndex: numOrNull(node.GetAttribute("selected"))
    };
    return { values, file: parsed.file };
}
function externalReloadVerifyController(doc, name, expected, state) {
    const rr = reloadDocument(doc, {});
    const values = compareVerification(expected, controllerMemoryValues(rr.doc, name), "reload", { id: name, name, objectType: "controller" });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, values };
}
// Same ladder as transitionWriteVerification: the controller lives on the
// component rather than in the display list, so every stage re-reads it by name.
function controllerWriteVerification(doc, name, params, expected) {
    const target = { id: null, name, path: null, type: "controller" };
    const stub = { id: name, name, objectType: "controller" };
    validateReloadOptions(params, target);
    const memory = controllerMemoryValues(doc, name);
    compareVerification(expected, memory, "editor", stub);
    let saved = false;
    if (params.save) {
        try {
            doc.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = doc.isModified === false;
        if (!saved)
            verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }
    let xmlReadback = false;
    let xmlFile = null;
    let xmlValues = null;
    if (saved && params.verify !== false) {
        const disk = persistedControllerValues(doc, name);
        xmlFile = disk.file;
        xmlValues = disk.values;
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }
    const state = {};
    let reloaded = null;
    if (xmlReadback && params.externalReload)
        reloaded = externalReloadVerifyController(doc, name, expected, state);
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: memory, xml: xmlValues, file: xmlFile, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    return {
        state, saved, persisted: strength !== NONE_STRENGTH, strength, verification,
        writePath: lastWritePath,
        note: `${strengthNote(verification, saved, "仅验证 Controller 名称、页面集与选中页；")}失败不自动回滚。`
    };
}
function setController(params) {
    // Controller 页面集与选中页走 FController 成员（AddPage/RemovePageAt/
    // SetSelectedIndex…），DocElement 没有对应入口。
    lastWritePath = WRITE_PATH_MODEL;
    const doc = getActiveDocument();
    const name = String(params.name || "");
    if (!name)
        verificationError("invalid_argument", "缺少控制器 name", { stage: "input" });
    const content = doc.content;
    const target = { id: null, name, path: null, type: "controller" };
    validateReloadOptions(params, target);
    let controller = resolveController(doc, name);
    const removing = params.remove === true;
    if (removing) {
        if (!controller)
            verificationError("target_not_found", `控制器不存在：${name}`, { stage: "input" });
        const before = controllerMemoryValues(doc, name);
        content.RemoveController(controller);
        doc.SetModified(true);
        doc.RefreshInspectors();
        const verification = controllerWriteVerification(doc, name, params, { name, present: false });
        return {
            ok: true, target, before, removed: before,
            documentModified: Boolean((verification.state && verification.state.doc || doc).isModified),
            saved: verification.saved, persisted: verification.persisted, strength: verification.strength,
            verification: verification.verification, note: verification.note,
            writePath: verification.writePath
        };
    }
    if (!controller) {
        if (!params.create)
            verificationError("target_not_found", `控制器不存在：${name}（创建需传 create:true）`, { stage: "input" });
        controller = new CS.FairyEditor.FController();
        controller.name = name;
        content.AddController(controller, false);
    }
    const before = controllerMemoryValues(doc, name);
    if (params.pages !== undefined) {
        if (!Array.isArray(params.pages))
            verificationError("invalid_argument", "pages 必须是页面名数组（整体替换页面集）", { stage: "input" });
        const pageNames = params.pages.map((p) => String(p));
        if (pageNames.length !== new Set(pageNames).size)
            verificationError("invalid_argument", "pages 存在重复页面名", { stage: "input" });
        // SetPages regenerates page ids; warn callers that gearDisplay page
        // references by id must be re-checked after a full page replacement.
        try {
            controller.SetPages(pageNames);
        }
        catch (_) {
            // Puerts may not coerce a JS array into IList<string>; fall back to
            // rebuilding the page set one entry at a time.
            while (controller.pageCount > 0)
                controller.RemovePageAt(0);
            for (const pageName of pageNames)
                controller.AddPage(pageName);
        }
    }
    if (params.addPages !== undefined) {
        if (!Array.isArray(params.addPages))
            verificationError("invalid_argument", "addPages 必须是页面名数组", { stage: "input" });
        for (const pageName of params.addPages)
            controller.AddPage(String(pageName));
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
    if (params.exported !== undefined)
        controller.exported = Boolean(params.exported);
    if (params.autoRadioGroupDepth !== undefined)
        controller.autoRadioGroupDepth = Boolean(params.autoRadioGroupDepth);
    if (params.homePage !== undefined)
        controller.homePage = String(params.homePage);
    doc.SetModified(true);
    doc.RefreshInspectors();
    const after = controllerMemoryValues(doc, name);
    const expected = { name, present: true, pageCount: after.pageCount, pageNames: after.pageNames };
    if (params.selectedIndex !== undefined || params.selectedPage !== undefined)
        expected.selectedIndex = after.selectedIndex;
    const verification = controllerWriteVerification(doc, name, params, expected);
    return {
        ok: true, target, before, after,
        documentModified: Boolean((verification.state && verification.state.doc || doc).isModified),
        saved: verification.saved, persisted: verification.persisted, strength: verification.strength,
        verification: verification.verification, note: verification.note,
        writePath: verification.writePath
    };
}
function listControllers() {
    const doc = getActiveDocument();
    const content = doc.content;
    const list = [];
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
function publicTransitionItemCount(transition) {
    let count = 0;
    for (let i = 0; i < transition.items.Count; i++)
        if (!isSyntheticTweenEndpoint(transition.items.get_Item(i)))
            count++;
    return count;
}
function transitionMemoryValues(doc, name) {
    const transitions = doc && doc.content ? doc.content.transitions : null;
    const transition = transitions && typeof transitions.GetItem === "function" ? transitions.GetItem(name) : null;
    if (!transition)
        return { name, present: false, itemCount: null };
    return { name, present: true, itemCount: publicTransitionItemCount(transition) };
}
// Transition nodes serialize as direct <component> children; tween end
// keyframes fold into a single <item> element, matching the public
// (non-synthetic) item count exposed to callers.
function persistedTransitionValues(doc, name) {
    const item = App.project.GetItemByURL(doc.content.resourceURL);
    if (!item || !item.file || !IOFile.Exists(item.file))
        verificationError("persistence_failed", "无法读取组件 XML", { stage: "xml" });
    const XmlType = CS.FairyGUI.Utils.XML;
    const xml = new XmlType(String(IOFile.ReadAllText(item.file)));
    let node = null;
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
function externalReloadVerifyTransition(doc, name, expected, state) {
    const rr = reloadDocument(doc, {});
    const values = compareVerification(expected, transitionMemoryValues(rr.doc, name), "reload", { id: name, name, objectType: "transition" });
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, values };
}
// Mirrors writeVerification for transition mutations: the target lives in
// doc.content.transitions rather than the display list, so each stage re-reads
// the transition set by name instead of re-locating a display object.
function transitionWriteVerification(doc, name, expectPresent, params) {
    const target = { id: null, name, path: null, type: "transition" };
    const stub = { id: name, name, objectType: "transition" };
    // Guard repeated here so a future caller cannot skip the precondition.
    validateReloadOptions(params, target);
    const memory = transitionMemoryValues(doc, name);
    const expected = { name, present: expectPresent };
    if (expectPresent && memory.present)
        expected.itemCount = memory.itemCount;
    compareVerification(expected, memory, "editor", stub);
    let saved = false;
    if (params.save) {
        try {
            doc.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = doc.isModified === false;
        if (!saved)
            verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target, expected });
    }
    let xmlReadback = false;
    let xmlFile = null;
    let xmlValues = null;
    if (saved && params.verify !== false) {
        const disk = persistedTransitionValues(doc, name);
        xmlFile = disk.file;
        xmlValues = disk.values;
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }
    const state = {};
    let reloaded = null;
    if (xmlReadback && params.externalReload)
        reloaded = externalReloadVerifyTransition(doc, name, expected, state);
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: memory, xml: xmlValues, file: xmlFile, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    return {
        state, saved, persisted: strength !== NONE_STRENGTH, strength, verification,
        writePath: lastWritePath,
        note: `${strengthNote(verification, saved, "仅验证 Transition 名称与公开条目数；")}失败不自动回滚。`
    };
}
// Package writes (create/import/movieclip) are verified against the package
// manifest: package.xml is what the editor actually persists for membership,
// and for asset-backed types external reload unloads and reloads the asset
// from disk. Components and deletions have no honest reload primitive, so
// their strength caps at disk.
const PACKAGE_ASSET_RELOAD_TYPES = ["image", "sound", "font", "movieclip"];
function validatePackageWriteOptions(params, itemType, allowReload) {
    validateReloadOptions(params, null);
    if (params.externalReload && !allowReload)
        verificationError("invalid_argument", `external reload 暂不支持该操作：仅 image/sound/font/movieclip 包资源可通过 asset 重新加载验证（当前：${itemType}）`, { stage: "input" });
}
function packageManifestPath(pkg, branch) {
    if (!branch)
        return IOPath.Combine(String(pkg.basePath || ""), "package.xml");
    // 分支资源登记在 assets_<branch>/<pkg>/package_branch.xml 的
    // <branchDescription><resources> 下，主干 package.xml 看不到它们。
    return IOPath.Combine(String((App.project && App.project.basePath) || ""), `assets_${branch}`, String(pkg.name), "package_branch.xml");
}
function persistedPackageItemValues(pkg, itemId, branch) {
    const file = packageManifestPath(pkg, branch);
    if (!IOFile.Exists(file))
        verificationError("persistence_failed", `无法读取 ${branch ? "package_branch.xml" : "package.xml"}`, { stage: "xml", file, branch: branch || null });
    const XmlType = CS.FairyGUI.Utils.XML;
    let xml = null;
    try {
        xml = new XmlType(String(IOFile.ReadAllText(file)));
    }
    catch (error) {
        verificationError("persistence_failed", `${branch ? "package_branch.xml" : "package.xml"} 解析失败`, { stage: "xml", file, branch: branch || null, reason: String(error) });
    }
    const resources = xml.GetNode("resources");
    let node = null;
    if (resources) {
        for (let i = 0; i < resources.elements.Count; i++) {
            const candidate = resources.elements.get_Item(i);
            if (String(candidate.GetAttribute("id") || "") === String(itemId)) {
                if (node)
                    verificationError("persistence_failed", `${branch ? "package_branch.xml" : "package.xml"} 中资源 ID 重复`, { stage: "xml", id: itemId, branch: branch || null });
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
function packageItemNameKey(name) {
    return String(IOPath.GetFileNameWithoutExtension(String(name || "")) || "");
}
function packageItemMemoryValues(pkg, ref) {
    let found = null;
    if (ref.url)
        found = App.project.GetItemByURL(ref.url);
    if (!found && ref.id && typeof pkg.GetItem === "function")
        found = pkg.GetItem(ref.id);
    const values = { present: Boolean(found) };
    if (found) {
        values.id = String(found.id);
        values.name = packageItemNameKey(found.name);
        values.type = String(found.type);
        values.exported = Boolean(found.exported);
        values.file = found.file ? String(found.file) : null;
        if (found.file)
            values.fileExists = IOFile.Exists(String(found.file));
    }
    return values;
}
function packageItemAssetReload(item, target) {
    if (typeof item.UnloadAsset !== "function" || typeof item.GetAsset !== "function")
        verificationError("persistence_failed", "资源不支持 asset 重新加载，无法执行 external reload", { stage: "reload", target });
    try {
        item.UnloadAsset();
    }
    catch (error) {
        verificationError("persistence_failed", "external reload 卸载资源 asset 失败", { stage: "reload", target, reason: String(error) });
    }
    let asset = null;
    try {
        asset = item.GetAsset();
    }
    catch (error) {
        verificationError("persistence_failed", "external reload 重新加载资源失败", { stage: "reload", target, reason: String(error) });
    }
    if (!asset)
        verificationError("persistence_failed", "external reload 后资源 asset 为空", { stage: "reload", target });
    return { performed: true, strategy: "assetReload" };
}
// ref: { id, url, name, type, path, present, file, checkFile } — captured by the
// caller after mutation (or before deletion, for absent checks). checkFile asks
// the verification to hard-fail when the item's backing file is missing.
function writePackageVerification(pkg, ref, params) {
    // 包资源写入走 FPackage.ImportResource/UpdateResource/DeleteItem 等包层 API，
    // 组件文档模型不参与。
    const expectPresent = ref.present !== false;
    const target = { id: ref.id || null, name: ref.name || null, path: ref.path || null, type: ref.type || "packageItem", url: ref.url || null, branch: ref.branch || "" };
    const stub = { id: ref.id, name: ref.name, objectType: ref.type || "packageItem" };
    const expected = { present: expectPresent };
    if (expectPresent) {
        expected.id = String(ref.id);
        if (ref.name !== undefined)
            expected.name = packageItemNameKey(ref.name);
        if (ref.checkFile)
            expected.fileExists = true;
    }
    const memory = packageItemMemoryValues(pkg, ref);
    compareVerification(expected, memory, "editor", stub);
    let saved = false;
    if (params.save) {
        try {
            if (typeof pkg.EnsureOpen === "function")
                pkg.EnsureOpen();
            pkg.Save();
            App.project.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存包或工程失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = true;
    }
    let xmlReadback = false;
    let xmlFile = null;
    let xmlValues = null;
    if (saved && params.verify !== false) {
        const disk = persistedPackageItemValues(pkg, String(ref.id), String(ref.branch || ""));
        xmlFile = disk.file;
        xmlValues = disk.values;
        if (ref.file !== undefined && ref.file !== null)
            xmlValues.file = ref.file;
        if (expectPresent && ref.checkFile)
            xmlValues.fileExists = IOFile.Exists(String(ref.file));
        compareVerification(expected, xmlValues, "xml", stub);
        xmlReadback = true;
    }
    let reloaded = null;
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
        writePath: lastWritePath,
        note: `${strengthNote(verification, saved, ref.branch ? "包资源验证覆盖 package_branch.xml 条目与资源文件；" : "包资源验证覆盖 package.xml 条目与资源文件；")}失败不自动回滚。`
    };
}
function packageWriteResult(result, pkg, ref, params) {
    const verified = writePackageVerification(pkg, ref, params);
    result.requiresSave = !verified.saved;
    result.branch = String(ref.branch || "");
    return Object.assign(result, verified);
}
function packageItemRef(item, type, folderPath, checkFile) {
    return {
        id: String(item.id),
        url: String(item.GetURL()),
        name: String(item.name),
        type,
        path: folderPath,
        present: true,
        branch: String(item.branch || ""),
        file: item.file ? String(item.file) : null,
        checkFile
    };
}
function replaceObjectResource(params) {
    const doc = getActiveDocument();
    let obj = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    const type = String(obj.objectType || "").toLowerCase();
    if (["image", "loader"].indexOf(type) < 0 || params.state)
        verificationError("unsupported_property", "可信资源替换目前仅支持 Image/Loader；Button 状态请使用专用 API", { stage: "input" });
    const url = String(params.resourceURL || params.url || "").trim();
    if (url.indexOf("ui://") !== 0)
        verificationError("invalid_argument", "resourceURL 必须是 ui:// URL", { stage: "input" });
    const resource = resolveItem({ url });
    if (resource.type !== FairyEditor.FPackageItemType.IMAGE || (params.expectedType && String(params.expectedType).toLowerCase() !== "image"))
        verificationError("invalid_argument", "本切片的资源类型必须是 image", { stage: "input", resourceURL: url });
    const canonicalUrl = String(resource.GetURL());
    const before = verifiedObjectValues(obj);
    const expected = { id: before.id, name: before.name, type, resourceURL: canonicalUrl };
    const preserveSize = params.preserveSize !== false;
    if (preserveSize) {
        expected.width = obj.width;
        expected.height = obj.height;
    }
    if (before.resourceURL !== canonicalUrl) {
        if (type === "loader") {
            // Loader 只有成员写入路径
            lastWritePath = WRITE_PATH_MODEL;
            obj.url = canonicalUrl;
        }
        else {
            // Image 走 Document.ReplaceSelection：编辑器自己的替换命令，
            // 会按资源类型处理默认尺寸/图集归属，优于直接改成员。
            lastWritePath = WRITE_PATH_DOCUMENT;
            doc.SetSelection(obj);
            doc.ReplaceSelection(canonicalUrl);
            // ReplaceSelection can invalidate the old object reference. Re-resolve by stable ID.
            obj = resolveObject(doc, { id: before.id });
        }
        if (preserveSize) {
            obj.width = expected.width;
            obj.height = expected.height;
        }
        doc.SetModified(true);
        doc.RefreshInspectors();
    }
    return writeVerification(doc, obj, before, verifiedObjectValues(obj), params, expected);
}
// --- Phase 8 / P8-2：资源引用图（只读） ------------------------------------
// 编辑器自带的 DependencyQuery 能给出 propKey / arrayIndex 这种"哪个对象的哪个
// 属性槽"的精度，正是 §1.1 缺的那一半。这里只放只读查询：全工程替换语义
// （ReplaceReferences）是写操作，另开 replace_references，且必须先出预览。
const DEPENDENCY_SEEK_LEVEL_NAMES = ["selection", "samePackageButNotExported", "samePackage", "all"];
const DEPENDENCY_SEEK_LEVELS = {
    selection: 0,
    samepackagebutnotexported: 1,
    samepackage: 2,
    all: 3
};
// ReferenceInfo.content 在真机（Editor 6.1.4）上是 FairyGUI.Utils.XML 的元素节点，
// 它才是「谁在引用」的答案：attributes 里带宿主对象的 id/name（如 n3_fix01/btnMain）。
// 而 ReferenceInfo 自身的 pkgId/itemId 指的是**被引用的那个资源**——
// 拿这两个字段回答「谁引用了它」会得到「Red 引用了它自己」这种自相矛盾的输出。
// valueType 的数值是声明里的确定值，名字只是给人看的；遇到未来版本新增取值时
// 按代码原样回报，绝不猜。
const REFERENCE_VALUE_TYPES = {
    0: "id",
    1: "url",
    2: "urlComplex",
    3: "charImage",
    4: "assetProperty"
};
const REFERENCE_QUERY_MAX_ITEMS = 200;
const REFERENCE_QUERY_MAX_ITEMS_CEILING = 2000;
function dependencySeekLevel(value) {
    if (value === undefined || value === null || value === "")
        return { name: DEPENDENCY_SEEK_LEVEL_NAMES[2], level: 2 };
    if (typeof value === "number") {
        const level = Math.round(value);
        if (level < 0 || level >= DEPENDENCY_SEEK_LEVEL_NAMES.length)
            verificationError("invalid_argument", `seekLevel 数值越界：${value}`, { stage: "input", seekLevel: value, allowed: DEPENDENCY_SEEK_LEVEL_NAMES });
        return { name: DEPENDENCY_SEEK_LEVEL_NAMES[level], level };
    }
    // 允许 samePackage / same_package / SAME-PACKAGE 三种写法，避免调用方
    // 因为分隔符不同而拿到一个看起来像"不支持"的结果。
    const level = DEPENDENCY_SEEK_LEVELS[String(value).replace(/[^A-Za-z]/g, "").toLowerCase()];
    if (level === undefined)
        verificationError("invalid_argument", `seekLevel 取值无效：${value}`, { stage: "input", seekLevel: value, allowed: DEPENDENCY_SEEK_LEVEL_NAMES });
    return { name: DEPENDENCY_SEEK_LEVEL_NAMES[level], level };
}
function queryItemLimit(value) {
    if (value === undefined || value === null)
        return REFERENCE_QUERY_MAX_ITEMS;
    const limit = Number(value);
    if (!isFinite(limit) || limit < 1 || limit > REFERENCE_QUERY_MAX_ITEMS_CEILING)
        verificationError("invalid_argument", `maxItems 必须是 1..${REFERENCE_QUERY_MAX_ITEMS_CEILING} 的数字`, { stage: "input", maxItems: value });
    return Math.floor(limit);
}
function isHostObject(value) {
    return value !== null && value !== undefined && typeof value === "object";
}
function xmlElementName(xml) {
    if (!isHostObject(xml) || xml.name === undefined || xml.name === null)
        return null;
    return safeValue(xml.name);
}
// XML.attributes 是 C# 字典：JSON.stringify 得到 {}，attributes.Keys 在 Puerts 下
// 也不是可用的键集合（真机实测 keys.get_Item 不存在）。唯一可靠的取法是
// GetEnumerator + MoveNext/Current。
function xmlAttributes(xml) {
    const result = {};
    if (!isHostObject(xml) || !isHostObject(xml.attributes))
        return result;
    try {
        const enumerator = xml.attributes.GetEnumerator();
        while (enumerator.MoveNext()) {
            const pair = enumerator.Current;
            const key = pair.key !== undefined ? pair.key : pair.Key;
            const value = pair.value !== undefined ? pair.value : pair.Value;
            result[String(key)] = String(value);
        }
    }
    catch (_) {
        // 取不到就返回空字典：宁可少给字段，也不给看起来像属性表的假数据。
        return {};
    }
    return result;
}
// DepItem.content 与 ReferenceInfo.content 同为 XML 元素节点（真机实测）。
// 标量原样返回，宿主对象只输出能确证的字段，识别不了就报 null ——
// 对宿主对象做 String() 会得到一段看起来可信、实际无意义的文本。
function describeQueryContent(content) {
    if (content === null || content === undefined)
        return null;
    const valueType = typeof content;
    if (valueType === "string" || valueType === "number" || valueType === "boolean")
        return content;
    if (!isHostObject(content))
        return null;
    const element = xmlElementName(content);
    const attributes = xmlAttributes(content);
    const summary = {};
    if (element !== null)
        summary.element = element;
    if (Object.keys(attributes).length)
        summary.attributes = attributes;
    if (content.objectType !== undefined && content.objectType !== null)
        summary.objectType = safeValue(content.objectType);
    if (content.id !== undefined && content.id !== null)
        summary.id = safeValue(content.id);
    if (content.name !== undefined && content.name !== null && element === null)
        summary.name = safeValue(content.name);
    return Object.keys(summary).length ? summary : null;
}
// 引用方所在的包可能根本没打开。取不到名字就报 null，不能为了一个展示字段
// 去 EnsureOpen 把一堆包装起来 —— 只读查询不该有这种副作用。
function ownerItemName(info) {
    try {
        const pkg = info.ownerPkg;
        const itemId = String(info.itemId || "");
        if (!pkg || !itemId)
            return null;
        const item = pkg.GetItem(itemId);
        return item ? safeValue(item.name) : null;
    }
    catch (_) {
        return null;
    }
}
// FairyGUI 的对象 id 形如 "n3_fix01"，后缀是所属资源的 id（真机实测：n3_fix01 属于
// BridgeFixture/fix01）。解析成功才回报，解析不出来报 null ——
// 未经校验的字符串猜测比空值更危险。
//
// 0.8.10 起这里只查「被引用资源所在的那个包」，那是默认值不是前提：跨包引用
// （Package2 的组件引用 Package1 的图）时宿主在另一个包里，按被引用包查必然查不到，
// 会把一个解析失败伪装成「宿主 item 为 null」。所以先在同包快路径上试，
// 再遍历全工程包按 id 兜底。仍然查不到就是查不到（真机实测存在对象 id 后缀
// 与所属 item id 不一致的组件，如 n0_p93m 属于 p93m3），报 null 不猜。
function ownerItemFromObjectId(packageId, objectId) {
    if (!objectId)
        return null;
    const cut = objectId.lastIndexOf("_");
    if (cut < 0 || cut === objectId.length - 1)
        return null;
    const itemId = objectId.slice(cut + 1);
    try {
        const samePackage = packageId ? App.project.GetItem(packageId, itemId) : null;
        if (samePackage)
            return samePackage;
        const packages = App.project.allPackages;
        for (let i = 0; i < packages.Count; i++) {
            const pkg = packages.get_Item(i);
            if (!pkg || (packageId && String(pkg.id) === String(packageId)))
                continue;
            const found = pkg.GetItem(itemId);
            if (found)
                return found;
        }
    }
    catch (_) {
        return null;
    }
    return null;
}
function describeReference(info) {
    const valueType = Number(info.valueType);
    const pkg = info.ownerPkg;
    const packageId = pkg ? safeValue(pkg.id) : null;
    const attributes = xmlAttributes(info.content);
    const objectId = attributes.id || null;
    const owner = packageId ? ownerItemFromObjectId(String(packageId), String(objectId || "")) : null;
    return {
        // 被引用的资源：ReferenceInfo 自身的身份字段指的就是它
        referencedItem: {
            packageId,
            packageName: pkg ? safeValue(pkg.name) : null,
            itemId: safeValue(info.itemId),
            itemName: ownerItemName(info)
        },
        // 引用发生的那个属性槽
        slot: {
            element: xmlElementName(info.content),
            propKey: safeValue(info.propKey) || null,
            arrayIndex: Number(info.arrayIndex) || 0,
            valueTypeCode: isFinite(valueType) ? valueType : null,
            valueType: REFERENCE_VALUE_TYPES[valueType] || null
        },
        // 持有该属性槽的宿主对象
        owner: {
            objectId,
            objectName: attributes.name || null,
            itemId: owner ? safeValue(owner.id) : null,
            itemName: owner ? safeValue(owner.name) : null
        },
        // 该 XML 元素的完整属性表，便于调用方自己定位与复核
        attributes
    };
}
function describeQueryItem(item) {
    if (!item)
        return null;
    try {
        return describeItem(item);
    }
    catch (_) {
        // 依赖图里可能混有尚未加载的资源。取不到就退回最小身份信息，
        // 不能让一条只读查询因为单个资源抛错而整条失败。
        let url = null;
        try {
            url = String(item.GetURL());
        }
        catch (_) {
            url = null;
        }
        return { id: safeValue(item.id), name: safeValue(item.name), url };
    }
}
// 项目级引用查询必须先把包都打开：编辑器只会扫到已打开的包，否则拿到的
// 是一个看起来完整、实际少算的结果——那比报错更难发现。代价（打开 N 个包）
// 显式回报在响应里，需要速度的调用方可用 skipPackageOpen 自行承担漏算风险。
function ensurePackagesOpen(params) {
    if (params.skipPackageOpen === true)
        return { skipped: true, opened: 0, packageCount: 0 };
    const packages = App.project.allPackages;
    const packageCount = packages ? Number(packages.Count) : 0;
    let opened = 0;
    for (let i = 0; i < packageCount; i++) {
        const pkg = packages.get_Item(i);
        if (!pkg || pkg.opened)
            continue;
        pkg.EnsureOpen();
        opened++;
    }
    return { skipped: false, opened, packageCount };
}
function queryReferences(params) {
    const item = resolveItem(params);
    const maxItems = queryItemLimit(params.maxItems);
    const packages = ensurePackagesOpen(params);
    const url = String(item.GetURL());
    const query = new FairyEditor.DependencyQuery();
    query.QueryReferences(App.project, url);
    const list = query.references;
    const totalCount = list ? Number(list.Count) : 0;
    const references = [];
    const count = Math.min(totalCount, maxItems);
    for (let i = 0; i < count; i++)
        references.push(describeReference(list.get_Item(i)));
    return {
        ok: true,
        readOnly: true,
        target: describeQueryItem(item),
        packages,
        totalCount,
        truncated: count < totalCount,
        references
    };
}
function queryDependencies(params) {
    const item = resolveItem(params);
    const seek = dependencySeekLevel(params.seekLevel);
    const maxItems = queryItemLimit(params.maxItems);
    const packages = ensurePackagesOpen(params);
    const url = String(item.GetURL());
    const query = new FairyEditor.DependencyQuery();
    // 用 (project, url) 重载而不是 (IList<FPackageItem>)：后者要求从 JS 构造
    // C# 泛型 List，而引用图查询本来就是一个资源一条命令。
    query.QueryDependencies(App.project, url, seek.level);
    const list = query.resultList;
    const totalCount = list ? Number(list.Count) : 0;
    const dependencies = [];
    const count = Math.min(totalCount, maxItems);
    for (let i = 0; i < count; i++) {
        const dep = list.get_Item(i);
        dependencies.push({
            item: describeQueryItem(dep.item),
            isSource: Boolean(dep.isSource),
            analysed: dep.analysed === undefined || dep.analysed === null ? null : Boolean(dep.analysed),
            targetPath: safeValue(dep.targetPath) || null,
            refCount: Number(dep.refCount) || 0,
            content: describeQueryContent(dep.content)
        });
    }
    return {
        ok: true,
        readOnly: true,
        target: describeQueryItem(item),
        seekLevel: seek.name,
        seekLevelCode: seek.level,
        packages,
        totalCount,
        truncated: count < totalCount,
        dependencies
    };
}
// --- Phase 8 / P8-2 写侧：全工程引用替换（0.8.11） -------------------------
//
// 原生签名只有 ReplaceReferences(newItem)，没有 old 参数：它改的是同一个
// DependencyQuery 实例上 QueryReferences 已经查出来的那批引用。跨请求无法保存
// 实例，所以执行时必须重新查询一次，而不是拿预览时的结果去套 —— 预览与执行之间
// 工程可能已经变了，复用旧列表等于按一份过期清单改全工程。
//
// 真机 6.1.4 实测（tests/reports/p8-2-write-live.json）确认的三条边界，直接决定
// 这里的实现与回报口径：
//  1. 这是**立即落盘**的写操作：执行后包 XML 已经是新值，文档既不会被标记
//     isModified，HasUnsavedDocuments 仍为 false。所以它不在 Agent 撤销栈里，
//     也没有「保存前失败」可言 —— 必须先出预览。
//  2. 文档没打开也能改（不必逐个打开），打开着的文档内存状态会同步更新，
//     之后普通保存不会把替换覆盖回去。
//  3. src/url 会更新，但 image 元素的 fileName **不会**跟着改，于是落盘那一刻
//     磁盘上是一处半状态；该节点下一次经文档模型保存时由编辑器自己补齐
//     （Document.ReplaceSelection 对同 URL 也会重写该节点，实测 fileName 归位）。
//     验证因此不能宣称属性级一致，只能按引用图口径回报，并显式报出可能滞后的槽位。
const REFERENCE_REPLACE_MODES = ["preview", "execute"];
// image 元素带 fileName 伴随属性，而原生批量替换不改它（实测）。
// 这些槽位是唯一已知的落盘半状态来源，按引用图即可判定，不必逐个解析宿主。
function staleFileNameSlots(references) {
    let count = 0;
    for (const reference of references) {
        const slot = reference ? reference.slot : null;
        if (!slot)
            continue;
        if (String(slot.element) === "image" && String(slot.valueType) === "id")
            count++;
    }
    return count;
}
function replaceMode(value) {
    if (value === undefined || value === null || value === "")
        return "preview";
    const mode = String(value).trim().toLowerCase();
    if (REFERENCE_REPLACE_MODES.indexOf(mode) < 0)
        verificationError("invalid_argument", `mode 取值无效：${value}`, { stage: "input", mode: value, allowed: REFERENCE_REPLACE_MODES });
    return mode;
}
function replaceReferences(params) {
    const mode = replaceMode(params.mode);
    const oldItem = resolveItem(params);
    const newUrl = String(params.newUrl || params.newResourceURL || "").trim();
    if (!newUrl)
        verificationError("invalid_argument", "newUrl 不能为空", { stage: "input" });
    if (newUrl.indexOf("ui://") !== 0)
        verificationError("invalid_argument", "newUrl 必须是 ui:// URL", { stage: "input", newUrl });
    const newItem = resolveItem({ url: newUrl });
    const oldUrl = String(oldItem.GetURL());
    if (oldUrl === String(newItem.GetURL()))
        verificationError("invalid_argument", "替换源与目标是同一个资源，无需替换", { stage: "input", url: oldUrl });
    const maxItems = queryItemLimit(params.maxItems);
    const packages = ensurePackagesOpen(params);
    const oldType = String(oldItem.type || "");
    const newType = String(newItem.type || "");
    // 执行与预览走同一条查询路径：execute 也要重新查，不能拿预览时的列表去改。
    const query = new FairyEditor.DependencyQuery();
    query.QueryReferences(App.project, oldUrl);
    const list = query.references;
    const stagedCount = list ? Number(list.Count) : 0;
    const references = [];
    const count = Math.min(stagedCount, maxItems);
    for (let i = 0; i < count; i++)
        references.push(describeReference(list.get_Item(i)));
    const preview = {
        mode,
        packages,
        from: describeQueryItem(oldItem),
        to: describeQueryItem(newItem),
        // 类型变了必须显式报出来：把图替成组件这类操作编辑器允许，但调用方多半没打算这么做
        typeChange: oldType !== newType ? { from: oldType, to: newType } : null,
        totalCount: stagedCount,
        truncated: count < stagedCount,
        staleFileNameSlots: staleFileNameSlots(references),
        references
    };
    if (mode === "preview")
        return {
            ok: true,
            preview: true,
            executed: false,
            ...preview,
            note: "预览模式未做任何修改；执行请传 mode=execute。原生替换立即落盘且不进 Agent 撤销栈。"
        };
    const staleSlots = preview.staleFileNameSlots;
    if (stagedCount > 0) {
        try {
            query.ReplaceReferences(newItem);
        }
        catch (error) {
            verificationError("write_failed", `全工程替换失败：${safeValue(error)}`, {
                stage: "replace",
                from: oldUrl,
                to: String(newItem.GetURL()),
                stagedCount
            });
        }
    }
    // 引用图级回读：源资源应当一条不剩，目标资源应当至少接住本次替换的数量。
    const verifyQuery = new FairyEditor.DependencyQuery();
    verifyQuery.QueryReferences(App.project, oldUrl);
    const remaining = verifyQuery.references ? Number(verifyQuery.references.Count) : 0;
    const targetQuery = new FairyEditor.DependencyQuery();
    targetQuery.QueryReferences(App.project, String(newItem.GetURL()));
    const targetCount = targetQuery.references ? Number(targetQuery.references.Count) : 0;
    const verified = remaining === 0;
    if (!verified)
        verificationError("persistence_failed", "全工程替换后仍能查到对旧资源的引用", {
            stage: "verify",
            from: oldUrl,
            remainingReferences: remaining,
            replacedCount: stagedCount
        });
    return {
        ok: true,
        preview: false,
        executed: true,
        ...preview,
        replacedCount: stagedCount,
        // 原生替换直接改包 XML：不是脏文档，不需要也不能靠 save 兜底。
        persisted: true,
        strength: "disk",
        undoable: false,
        writePath: WRITE_PATH_NATIVE,
        verification: {
            ok: verified,
            scope: "reference-graph",
            remainingReferences: remaining,
            targetReferences: targetCount
        },
        warnings: staleSlots > 0
            ? [`${staleSlots} 个 image 槽位的 fileName 不会随替换更新（原生行为，实测 6.1.4），`
                    + "落盘后该属性短暂滞后；这些节点下次经编辑器保存时自动补齐。"]
            : []
    };
}
function colorHex(value) {
    if (value === null || value === undefined)
        return null;
    const c = value;
    const channel = (v) => Math.max(0, Math.min(255, Math.round(Number(v) * 255)));
    if (c.r === undefined || c.g === undefined || c.b === undefined)
        return null;
    const hex = (v) => v.toString(16).padStart(2, "0");
    const alpha = c.a === undefined ? 255 : channel(c.a);
    return `#${hex(channel(c.r))}${hex(channel(c.g))}${hex(channel(c.b))}${alpha < 255 ? hex(alpha) : ""}`.toUpperCase();
}
function textStyle(obj) {
    const value = {};
    ["font", "fontSize", "align", "verticalAlign", "autoSize", "lineSpacing", "letterSpacing", "stroke", "shadow", "width", "height"].forEach(k => { if (obj[k] !== undefined)
        value[k] = obj[k]; });
    if (obj.leading !== undefined)
        value.lineGap = Number(obj.leading);
    if (obj.verticalAlign !== undefined)
        value.vAlign = String(obj.verticalAlign);
    if (obj.color !== undefined)
        value.color = colorHex(obj.color);
    if (obj.strokeColor !== undefined)
        value.strokeColor = colorHex(obj.strokeColor);
    if (obj.shadowColor !== undefined)
        value.shadowColor = colorHex(obj.shadowColor);
    // 0.8.20：补齐字重与描边/投影的可读面（真机 6.1.4 实测的成员名）。
    if (obj.bold !== undefined)
        value.bold = Boolean(obj.bold);
    if (obj.italic !== undefined)
        value.italic = Boolean(obj.italic);
    if (obj.underline !== undefined)
        value.underline = Boolean(obj.underline);
    if (obj.strokeSize !== undefined)
        value.strokeSize = Number(obj.strokeSize);
    if (obj.shadowX !== undefined)
        value.shadowX = Number(obj.shadowX);
    if (obj.shadowY !== undefined)
        value.shadowY = Number(obj.shadowY);
    return value;
}
function getTextStyle(params) {
    const doc = getActiveDocument();
    const obj = resolveObject(doc, params.target);
    const type = String(obj.objectType || "").toLowerCase();
    if (type.indexOf("text") < 0 && type.indexOf("rich") < 0)
        throw new Error("目标不是文本对象");
    return { ok: true, target: targetSummary(obj, params.target), style: textStyle(obj) };
}
// 0.8.20：文本对象原语。FGUI 的文本是 displayList 里的裸节点、
// 不是包资源，insert_object 插不进来。实现依据真机 6.1.4 探针
// （tests/reports/p9-0-p9-1-probe-live.json B1~B6）：
//   ① CreateChild(xml) 单独调用会得到游离对象——不进 displayList、不落盘；
//      必须再 AddChild 才会进文档并随 save 落盘；
//   ② CreateChild 会丢弃 XML 上的全部属性（id/name/xy/size/text 全丢），
//      属性必须在建完之后往对象上补写，这些补写能落盘；
//   ③ 新节点没有 DocElement，但序列化走 displayList，对象模型写入照样落盘；
//   ④ font 为空时写 fontSize 会抛 NullReferenceException → 必须先写 font；
//   ⑤ autoSize 默认 both，保存时编辑器会重算尺寸 → 要精确尺寸必须先写 autoSize=none。
function insertText(params) {
    // 0.8.20：文本对象原语。FGUI 的文本是 displayList 里的裸节点、
    // 不是包资源，insert_object 插不进来。实现依据真机 6.1.4 探针
    // （tests/reports/p9-0-p9-1-probe-live.json B1~B6）：
    //   ① CreateChild(xml) 单独调用会得到游离对象——不进 displayList、不落盘；
    //      必须再 AddChild 才会进文档并随 save 落盘；
    //   ② CreateChild 会丢弃 XML 上的全部属性（id/name/xy/size/text 全丢），
    //      属性必须在建完之后往对象上补写，这些补写能落盘；
    //   ③ 新节点没有 DocElement，但序列化走 displayList，对象模型写入照样落盘；
    //   ④ font 为空时写 fontSize 会抛 NullReferenceException → 必须先写 font；
    //   ⑤ autoSize 默认 both，保存时编辑器会重算尺寸 → 要精确尺寸必须先写 autoSize=none。
    const doc = getActiveDocument();
    validateReloadOptions(params, { path: "root" });
    if (params.target) {
        const requested = resolveObject(doc, params.target);
        if (requested !== doc.content)
            verificationError("invalid_argument", "insert_text 只支持在当前文档的根组件下创建文本", { stage: "input", target: targetSummary(requested, params.target) });
    }
    const parent = doc.content;
    if (!parent || typeof parent.CreateChild !== "function" || typeof parent.AddChild !== "function")
        verificationError("invalid_argument", "当前文档根节点不是可容纳子节点的组件", { stage: "input" });
    const style = params.style && typeof params.style === "object" ? params.style : {};
    const x = Number(params.x || 0);
    const y = Number(params.y || 0);
    const XmlType = CS.FairyGUI.Utils.XML;
    const xml = XmlType.Create("text");
    let obj = null;
    try {
        obj = parent.CreateChild(xml);
    }
    catch (error) {
        verificationError("editor_rejected", "创建文本节点失败", { stage: "editor", reason: String(error) });
    }
    if (!obj)
        verificationError("editor_rejected", "创建文本节点失败", { stage: "editor" });
    try {
        parent.AddChild(obj);
    }
    catch (error) {
        verificationError("editor_rejected", "把文本节点加入文档失败", { stage: "editor", reason: String(error) });
    }
    const applied = {};
    const setMember = (key, value) => {
        try {
            if (key === "color" || key === "strokeColor" || key === "shadowColor")
                obj[key] = unityColor(value, key);
            else if (key === "bold" || key === "italic" || key === "underline" || key === "stroke" || key === "shadow")
                obj[key] = Boolean(value);
            else if (key === "strokeSize" || key === "shadowX" || key === "shadowY" || key === "fontSize" || key === "width" || key === "height" || key === "letterSpacing" || key === "lineGap")
                obj[key] = Number(value);
            else
                obj[key] = value;
            applied[key] = "assigned";
        }
        catch (error) {
            applied[key] = "error: " + String(error);
            verificationError("editor_rejected", `写入文本属性失败：${key}`, { stage: "editor", key, reason: String(error) });
        }
    };
    // 顺序即约束（见文件头注释 ④⑤ 与 A6/A7）。
    const nameRequested = params.name === undefined ? null : String(params.name);
    if (nameRequested !== null)
        setMember("name", nameRequested);
    const fontRequested = style.font === undefined ? null : String(style.font);
    if (fontRequested !== null)
        setMember("font", fontRequested);
    else if (style.fontSize !== undefined) {
        // 新节点 font 为空，直接写 fontSize 会在编辑器侧抛 NPE；补上编辑器默认字体。
        setMember("font", "UIDefault");
        applied.font = "defaulted:UIDefault";
    }
    if (style.fontSize !== undefined)
        setMember("fontSize", style.fontSize);
    if (style.width !== undefined || style.height !== undefined) {
        setMember("autoSize", "none");
        if (style.width !== undefined)
            setMember("width", style.width);
        if (style.height !== undefined)
            setMember("height", style.height);
    }
    else if (style.autoSize !== undefined)
        setMember("autoSize", style.autoSize);
    if (style.align !== undefined)
        setMember("align", style.align);
    if (style.vAlign !== undefined)
        setMember("vAlign", style.vAlign);
    if (style.letterSpacing !== undefined)
        setMember("letterSpacing", style.letterSpacing);
    if (style.lineGap !== undefined)
        setMember("lineGap", style.lineGap);
    if (style.bold !== undefined)
        setMember("bold", style.bold);
    if (style.italic !== undefined)
        setMember("italic", style.italic);
    if (style.underline !== undefined)
        setMember("underline", style.underline);
    if (style.strokeSize !== undefined) {
        setMember("stroke", Number(style.strokeSize) > 0);
        setMember("strokeSize", style.strokeSize);
    }
    if (style.strokeColor !== undefined)
        setMember("strokeColor", style.strokeColor);
    if (style.shadowX !== undefined || style.shadowY !== undefined) {
        setMember("shadow", true);
        if (style.shadowX !== undefined)
            setMember("shadowX", style.shadowX);
        if (style.shadowY !== undefined)
            setMember("shadowY", style.shadowY);
    }
    else if (style.shadow !== undefined)
        setMember("shadow", style.shadow);
    if (style.shadowColor !== undefined)
        setMember("shadowColor", style.shadowColor);
    if (style.color !== undefined)
        setMember("color", style.color);
    if (params.text !== undefined)
        setMember("text", String(params.text));
    setMember("x", x);
    setMember("y", y);
    lastWritePath = WRITE_PATH_MODEL;
    doc.SetModified(true);
    try {
        doc.RefreshInspectors();
    }
    catch (_) { }
    // 结构创建不进 Agent 属性事务栈：已有属性快照对新节点没有意义。
    clearAgentHistory();
    const nameActual = String(obj.name || "");
    const expected = { id: obj.id, name: nameActual, type: "text", x, y };
    if (params.text !== undefined)
        expected.text = String(params.text);
    for (const key of ["font", "fontSize", "color", "align", "vAlign", "autoSize", "letterSpacing", "lineGap",
        "width", "height", "bold", "italic", "underline", "strokeSize", "strokeColor", "shadowX", "shadowY", "shadowColor"])
        if (style[key] !== undefined)
            expected[key] = style[key];
    const after = Object.assign({ x, y, width: obj.width, height: obj.height, text: obj.text }, textStyle(obj));
    const result = writeVerification(doc, obj, {}, after, params, expected);
    result.inserted = {
        id: obj.id,
        name: nameActual,
        nameRequested,
        // 编辑器在重名时可能自行改名，这里显式回报实际值而不是默默改掉请求。
        nameAdjusted: nameRequested !== null && nameActual !== nameRequested,
        type: "text",
        applied
    };
    return result;
}
function setTextStyle(params) {
    const doc = getActiveDocument();
    const obj = resolveObject(doc, params.target);
    validateReloadOptions(params, targetSummary(obj, params.target));
    const type = String(obj.objectType || "").toLowerCase();
    if (type.indexOf("text") < 0 && type.indexOf("rich") < 0)
        throw new Error("目标不是文本对象");
    const style = validateExpectations(params.style);
    for (const key of Object.keys(style)) {
        if (VERIFIED_TEXT_KEYS.indexOf(key) < 0)
            verificationError("unsupported_property", `不支持文本样式：${key}`, { stage: "input" });
        if (["fontSize", "lineGap", "letterSpacing", "width", "height", "x", "y", "strokeSize", "shadowX", "shadowY"].indexOf(key) >= 0) {
            if (typeof style[key] !== "number")
                verificationError("invalid_argument", `${key} 必须是数字`, { stage: "input" });
            numberValue(style[key], key, ["fontSize", "width", "height", "strokeSize"].indexOf(key) >= 0 ? 0 : -10000, 10000);
        }
        else if (["bold", "italic", "underline", "shadow"].indexOf(key) >= 0) {
            if (typeof style[key] !== "boolean")
                verificationError("invalid_argument", `${key} 必须是布尔值`, { stage: "input" });
        }
        else if (typeof style[key] !== "string")
            verificationError("invalid_argument", `${key} 必须是字符串`, { stage: "input" });
    }
    if (style.shadow === false && (style.shadowX !== undefined || style.shadowY !== undefined))
        verificationError("invalid_argument", "shadow=false 会把投影偏移清零，不能与 shadowX/shadowY 同时指定", { stage: "input" });
    const enums = { align: ["left", "center", "right"], vAlign: ["top", "middle", "bottom"], autoSize: ["none", "both", "height", "shrink"] };
    for (const key of Object.keys(enums))
        if (style[key] !== undefined && enums[key].indexOf(style[key]) < 0)
            verificationError("invalid_argument", `${key} 枚举值无效`, { stage: "input" });
    if (style.font && style.font.indexOf("ui://") === 0) {
        const font = resolveItem({ url: style.font });
        if (font.type !== FairyEditor.FPackageItemType.FONT)
            verificationError("invalid_argument", "font 必须引用字体资源", { stage: "input" });
        style.font = String(font.GetURL());
    }
    const before = textStyle(obj);
    const aliases = { vAlign: "verticalAlign", lineGap: "leading" };
    lastWritePath = WRITE_PATH_MODEL;
    // 真机 6.1.4 实测的顺序约束（tests/reports/p9-0-p9-1-probe-live.json A6/A7）：
    //   ① shadow 开关的 setter 会把偏移重置成 (1,1) → 必须先写开关再写偏移；
    //   ② 只写偏移而 shadow 为 false 时编辑器不序列化 shadowOffset → 给了偏移就自动开投影。
    const wantsOffset = style.shadowX !== undefined || style.shadowY !== undefined;
    if (style.shadow !== undefined)
        obj.shadow = Boolean(style.shadow);
    else if (wantsOffset)
        obj.shadow = true;
    // 描边与投影同构：编辑器只在开关打开时才序列化 strokeSize/strokeColor
    // （真机 6.1.4 实测：只写 strokeSize 而描边未启用，磁盘上不会出现该属性——
    //  见 tests/reports/p9-0-p9-1-probe-live.json A3 与 p9-0-insert-text-live.json）。
    // 所以给了描边参数就先把描边打开，再写宽度与颜色。
    if (style.strokeSize !== undefined || style.strokeColor !== undefined)
        obj.stroke = true;
    for (const key of Object.keys(style)) {
        if (key === "shadow")
            continue;
        const value = style[key];
        if (key === "shadowX" || key === "shadowY")
            obj[key] = Number(value);
        else if (key === "bold" || key === "italic" || key === "underline")
            obj[key] = Boolean(value);
        else
            obj[aliases[key] || key] = (key === "color" || key === "strokeColor" || key === "shadowColor")
                ? unityColor(value, key)
                : value;
    }
    doc.SetModified(true);
    doc.RefreshInspectors();
    const expected = Object.assign({ id: obj.id, type }, style);
    // shadow 是内存里的启用态，不落盘，不进 XML 断言。
    delete expected.shadow;
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
function isTreeSpec(expected) {
    return Boolean(expected) && typeof expected === "object" && !Array.isArray(expected) &&
        (expected.children !== undefined || expected.childrenMode !== undefined || expected.index !== undefined);
}
function validateTreeSpec(spec, specPath) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec))
        verificationError("invalid_argument", `expected 树节点必须是对象：${specPath}`, { stage: "input", node: specPath });
    const flat = {};
    for (const key of Object.keys(spec))
        if (TREE_STRUCTURAL_KEYS.indexOf(key) < 0)
            flat[key] = spec[key];
    const node = { specPath, assert: validateExpectationsMap(flat, specPath) };
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
        node.children = spec.children.map((child, i) => validateTreeSpec(child, `${specPath}.children[${i}]`));
        // A subset spec without any locator can never say which child it means.
        if (node.childrenMode === "subset")
            for (const child of node.children)
                if (child.assert.id === undefined && child.assert.name === undefined && child.index === undefined)
                    verificationError("invalid_argument", `subset 模式的子节点需要 id、name 或 index 定位：${child.specPath}`, { stage: "input", node: child.specPath });
    }
    return node;
}
function objectChildren(obj) {
    const children = [];
    const component = obj;
    if (typeof component.numChildren !== "number")
        return children;
    for (let i = 0; i < component.numChildren; i++)
        children.push(component.GetChildAt(i));
    return children;
}
// `stage` controls both the error code and what a mismatch means: an
// editor-stage miss is the live tree disagreeing; an xml/reload miss means the
// structure never persisted.
function stageErrorCode(stage) {
    return stage === "editor" ? "editor_rejected" : "persistence_failed";
}
function locateSpecChild(children, spec, used, stage) {
    const locate = (key, value) => {
        let found = -1;
        for (let i = 0; i < children.length; i++) {
            if (used[i] || String(children[i][key] || "") !== String(value))
                continue;
            if (found >= 0)
                verificationError("ambiguous_target", `子节点定位不唯一：${spec.specPath}`, { stage, node: spec.specPath, locator: { [key]: value } });
            found = i;
        }
        return found;
    };
    if (spec.assert.id !== undefined)
        return locate("id", spec.assert.id);
    if (spec.assert.name !== undefined)
        return locate("name", spec.assert.name);
    if (spec.index !== undefined)
        return !used[spec.index] && spec.index < children.length ? spec.index : -1;
    return -1;
}
function countSpecNodes(children) {
    let count = 0;
    for (const child of children || []) {
        count++;
        if (child.children)
            count += countSpecNodes(child.children);
    }
    return count;
}
function verifyTreeNode(obj, spec, stage, counters) {
    counters.checked++;
    const actual = verifiedObjectValues(obj);
    const differences = diffExpectedValues(spec.assert, actual);
    if (differences.length)
        verificationError(stageErrorCode(stage), `树比对失败（${stage}）：${spec.specPath}`, { stage, node: spec.specPath, target: targetSummary(obj, null), expected: spec.assert, actual, differences });
    if (!spec.children)
        return;
    const children = objectChildren(obj);
    if (spec.childrenMode === "subset") {
        const used = {};
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
function locateSpecXmlChild(nodes, spec, used) {
    const locate = (key, value) => {
        let found = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (used[i] || String(nodes[i].GetAttribute(key) || "") !== String(value))
                continue;
            if (found >= 0)
                verificationError("ambiguous_target", `XML 子节点定位不唯一：${spec.specPath}`, { stage: "xml", node: spec.specPath, locator: { [key]: value } });
            found = i;
        }
        return found;
    };
    if (spec.assert.id !== undefined)
        return locate("id", spec.assert.id);
    if (spec.assert.name !== undefined)
        return locate("name", spec.assert.name);
    if (spec.index !== undefined)
        return !used[spec.index] && spec.index < nodes.length ? spec.index : -1;
    return -1;
}
// The component XML only serializes this document's own scope: the root node
// plus flat displayList children. Specs nested inside a child component live in
// that component's file — comparing them against this XML would be dishonest,
// so they are counted as skipped and still covered by the editor and reload
// stages.
function verifyTreeXml(doc, obj, spec, counters) {
    const parsed = documentXml(doc, obj);
    const checkSpecNode = (nodeSpec, node) => {
        const values = xmlNodeValues(parsed.item, node);
        const differences = diffExpectedValues(nodeSpec.assert, values);
        if (differences.length)
            verificationError("persistence_failed", `树比对失败（xml）：${nodeSpec.specPath}`, { stage: "xml", node: nodeSpec.specPath, expected: nodeSpec.assert, actual: values, differences });
        counters.xmlChecked++;
    };
    let targetNode = null;
    if (obj === doc.content)
        targetNode = parsed.xml;
    else {
        for (const candidate of displayListElements(parsed.xml))
            if (String(candidate.GetAttribute("id")) === String(obj.id)) {
                targetNode = candidate;
                break;
            }
        if (!targetNode)
            verificationError("persistence_failed", "XML 中未找到目标对象", { stage: "xml", node: spec.specPath, target: targetSummary(obj, null) });
    }
    checkSpecNode(spec, targetNode);
    if (!spec.children)
        return parsed.file;
    if (obj !== doc.content) {
        counters.xmlSkipped += countSpecNodes(spec.children);
        return parsed.file;
    }
    const nodes = displayListElements(parsed.xml);
    if (spec.childrenMode === "subset") {
        const used = {};
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
function externalReloadVerifyTree(doc, locator, spec, state) {
    const rr = reloadDocument(doc, {});
    let reloaded = null;
    try {
        reloaded = locator ? resolveObject(rr.doc, locator) : rr.doc.content;
    }
    catch (error) {
        verificationError("persistence_failed", "external reload 后无法在重新载入的文档中定位目标", { stage: "reload", url: rr.url, closeStrategy: rr.closeStrategy, target: locator, reason: String(error) });
    }
    const counters = { checked: 0 };
    verifyTreeNode(reloaded, spec, "reload", counters);
    state.doc = rr.doc;
    return { performed: true, url: rr.url, closeStrategy: rr.closeStrategy, checked: counters.checked };
}
function verifyDocument(params) {
    const doc = getActiveDocument();
    const tree = describeObject(doc.content, 0, params.maxDepth === undefined ? 12 : Number(params.maxDepth));
    if (params.expected !== undefined) {
        const isTree = isTreeSpec(params.expected);
        if (!isTree && !params.target)
            verificationError("invalid_argument", "expected 必须提供 target", { stage: "input" });
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
            const state = {};
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
        const counters = { checked: 0, xmlChecked: 0, xmlSkipped: 0 };
        verifyTreeNode(obj, spec, "editor", counters);
        let xmlFile = null;
        if (params.readXml !== false)
            xmlFile = verifyTreeXml(doc, obj, spec, counters);
        const state = {};
        const reloaded = wantsReload ? externalReloadVerifyTree(doc, params.target || null, spec, state) : null;
        // A reload replaced the document handle; every later read must use the new one.
        const liveDoc = state.doc || doc;
        const saved = !liveDoc.isModified;
        const verification = {
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
// verify_transition 是只读检查，必须能对损坏的 Transition 出报告而不是自己先抛错：
// describeTransition 遇到缺失的 tween 端点会直接 throw，一条坏轨道就会让整个组件
// 查不出来。所以这里按公开 item 自行遍历，端点和值都容错读取。
function finiteTransitionNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function transitionFinding(code, severity, transitionName, itemIndex, item, message, extra) {
    const finding = {
        code,
        severity,
        transition: transitionName,
        itemIndex,
        type: item ? String(item.type) : null,
        targetId: item ? String(item.targetId || "") : null,
        frame: item ? Number(item.frame) : null,
        message
    };
    if (extra) {
        for (const key of Object.keys(extra))
            finding[key] = extra[key];
    }
    return finding;
}
function verifyTransitionValue(doc, transitionName, itemIndex, item, value, phase, target, checkBounds, findings, stats) {
    const type = String(item.type);
    const described = describeTransitionValue(type, value);
    const report = (code, severity, message, extra) => {
        const detail = { phase };
        if (extra) {
            for (const key of Object.keys(extra))
                detail[key] = extra[key];
        }
        findings.push(transitionFinding(code, severity, transitionName, itemIndex, item, message, detail));
    };
    switch (type) {
        case "Alpha":
            if (!finiteTransitionNumber(described) || described < 0 || described > 1)
                report("value_out_of_range", "error", `Alpha 关键帧值必须在 0 到 1 之间：${String(described)}`, { value: described });
            break;
        case "Color": {
            if (!described || typeof described !== "object") {
                report("value_missing", "error", "Color 关键帧缺少颜色值");
                break;
            }
            for (const channel of ["r", "g", "b", "a"]) {
                const channelValue = described[channel];
                if (!finiteTransitionNumber(channelValue) || channelValue < 0 || channelValue > 1)
                    report("value_out_of_range", "error", `Color.${channel} 必须在 0 到 1 之间：${String(channelValue)}`, { channel, value: channelValue });
            }
            break;
        }
        case "XY":
        case "Size":
        case "Pivot":
        case "Scale":
        case "Skew": {
            if (!described || typeof described !== "object") {
                report("value_missing", "error", `${type} 关键帧缺少坐标值`);
                break;
            }
            for (const axis of ["x", "y"]) {
                if (!finiteTransitionNumber(described[axis]))
                    report("value_out_of_range", "error", `${type}.${axis} 必须是有限数字：${String(described[axis])}`, { axis, value: described[axis] });
            }
            if (type === "Size") {
                for (const axis of ["x", "y"]) {
                    if (finiteTransitionNumber(described[axis]) && described[axis] < 0)
                        report("value_out_of_range", "error", `Size.${axis} 不能为负数：${String(described[axis])}`, { axis, value: described[axis] });
                }
            }
            if (type === "Pivot") {
                for (const axis of ["x", "y"]) {
                    if (finiteTransitionNumber(described[axis]) && (described[axis] < 0 || described[axis] > 1))
                        report("value_outside_expected_range", "warning", `Pivot.${axis} 通常应在 0 到 1 之间：${String(described[axis])}`, { axis, value: described[axis] });
                }
            }
            if (type === "XY" && checkBounds) {
                if (described.percent) {
                    stats.boundsSkipped++;
                }
                else if (target && target !== doc.content && finiteTransitionNumber(described.x) && finiteTransitionNumber(described.y)) {
                    stats.boundsChecked++;
                    const canvasWidth = Number(doc.content.width) || 0;
                    const canvasHeight = Number(doc.content.height) || 0;
                    if (canvasWidth > 0 && canvasHeight > 0 && (described.x < 0 || described.y < 0 || described.x > canvasWidth || described.y > canvasHeight))
                        report("position_outside_canvas", "warning", `XY ${phase} 位置 (${described.x}, ${described.y}) 超出画布 ${canvasWidth}x${canvasHeight}；滑入/滑出动画也会命中，请人工确认`, { canvas: { width: canvasWidth, height: canvasHeight } });
                }
                else {
                    stats.boundsSkipped++;
                }
            }
            break;
        }
        case "Rotation":
            if (!finiteTransitionNumber(described))
                report("value_out_of_range", "error", `Rotation 关键帧值必须是有限数字：${String(described)}`, { value: described });
            break;
        case "Animation":
            if (!described || typeof described !== "object" || !Number.isInteger(described.frame) || described.frame < 0)
                report("value_out_of_range", "error", `Animation.frame 必须是非负整数：${String(described && described.frame)}`, { value: described && described.frame });
            break;
        case "Sound": {
            if (!described || typeof described !== "object") {
                report("value_missing", "error", "Sound 关键帧缺少声音资源");
                break;
            }
            const soundUrl = String(described.soundUrl || "");
            stats.resourcesChecked++;
            if (!soundUrl) {
                report("value_missing", "error", "Sound.soundUrl 不能为空");
            }
            else {
                try {
                    const soundItem = resolveItem({ url: soundUrl });
                    if (soundItem.type !== FairyEditor.FPackageItemType.SOUND)
                        report("resource_type_mismatch", "error", `Sound.soundUrl 不是声音资源：${soundUrl}`, { resource: soundUrl });
                }
                catch (error) {
                    report("resource_missing", "error", `Sound 资源不存在：${soundUrl}`, { resource: soundUrl });
                }
            }
            if (!finiteTransitionNumber(described.volume) || described.volume < 0 || described.volume > 1)
                report("value_out_of_range", "error", `Sound.volume 必须在 0 到 1 之间：${String(described.volume)}`, { value: described.volume });
            break;
        }
        case "Transition": {
            if (!described || typeof described !== "object") {
                report("value_missing", "error", "Transition 关键帧缺少嵌套 Transition");
                break;
            }
            const nestedName = String(described.transitionName || "");
            stats.nestedChecked++;
            if (!nestedName)
                report("value_missing", "error", "Transition.transitionName 不能为空");
            else if (!doc.content.transitions.GetItem(nestedName))
                report("nested_transition_missing", "error", `嵌套 Transition 不存在：${nestedName}`, { nestedTransition: nestedName });
            if (!Number.isInteger(described.playTimes) || described.playTimes < -1)
                report("value_out_of_range", "error", `Transition.playTimes 必须是 -1 到 1000000 之间的整数：${String(described.playTimes)}`, { value: described.playTimes });
            if (!finiteTransitionNumber(described.stopTime) || described.stopTime < -1)
                report("value_out_of_range", "error", `Transition.stopTime 不能小于 -1：${String(described.stopTime)}`, { value: described.stopTime });
            break;
        }
        case "Shake":
            if (!finiteTransitionNumber(described && described.amplitude) || described.amplitude < 0)
                report("value_out_of_range", "error", `Shake.amplitude 不能为负数：${String(described && described.amplitude)}`, { value: described && described.amplitude });
            if (!finiteTransitionNumber(described && described.duration) || described.duration < 0)
                report("value_out_of_range", "error", `Shake.duration 不能为负数：${String(described && described.duration)}`, { value: described && described.duration });
            break;
        case "ColorFilter":
            for (const key of ["brightness", "contrast", "saturation", "hue"]) {
                if (!finiteTransitionNumber(described && described[key]))
                    report("value_out_of_range", "error", `ColorFilter.${key} 必须是有限数字：${String(described && described[key])}`, { channel: key, value: described && described[key] });
            }
            break;
        case "Visible":
        case "Text":
        case "Icon":
            break;
    }
}
function verifyOneTransition(doc, transition, checkBounds) {
    const transitionName = String(transition.name || "");
    const findings = [];
    const stats = { itemCount: 0, targetsChecked: 0, valuesChecked: 0, boundsChecked: 0, boundsSkipped: 0, resourcesChecked: 0, nestedChecked: 0 };
    const frameRate = Number(transition.frameRate);
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 255)
        findings.push(transitionFinding("frame_rate_invalid", "error", transitionName, -1, null, `frameRate 必须在 1 到 255 之间：${String(transition.frameRate)}`));
    let publicIndex = 0;
    for (let index = 0; index < transition.items.Count; index++) {
        const item = transition.items.get_Item(index);
        if (isSyntheticTweenEndpoint(item))
            continue;
        const itemIndex = publicIndex++;
        stats.itemCount++;
        const targetId = String(item.targetId || "");
        let target = doc.content;
        if (targetId) {
            stats.targetsChecked++;
            target = findObjectById(doc.content, targetId);
            if (!target)
                findings.push(transitionFinding("target_missing", "error", transitionName, itemIndex, item, `Transition 目标对象不存在：${targetId}`));
        }
        if (target) {
            try {
                if (typeof FairyEditor.FTransition.GetAllowType === "function" && !FairyEditor.FTransition.GetAllowType(target, String(item.type)))
                    findings.push(transitionFinding("target_type_unsupported", "error", transitionName, itemIndex, item, `目标 ${targetId || "root"} 不支持轨道类型：${String(item.type)}`));
            }
            catch (_) { /* 类型查询失败不应阻断其余检查。 */ }
        }
        const frame = Number(item.frame);
        if (!Number.isInteger(frame) || frame < 0)
            findings.push(transitionFinding("frame_invalid", "error", transitionName, itemIndex, item, `关键帧时间必须是非负整数：${String(item.frame)}`));
        stats.valuesChecked++;
        verifyTransitionValue(doc, transitionName, itemIndex, item, item.value, "start", target, checkBounds, findings, stats);
        if (item.tween) {
            const next = item.nextItem;
            if (!next) {
                findings.push(transitionFinding("tween_missing_endpoint", "error", transitionName, itemIndex, item, "Tween 缺少结束关键帧"));
            }
            else {
                if (String(next.targetId || "") !== targetId || String(next.type) !== String(item.type))
                    findings.push(transitionFinding("tween_endpoint_mismatch", "error", transitionName, itemIndex, item, "Tween 结束关键帧的 target/type 与起始项不一致"));
                const duration = Number(next.frame) - frame;
                if (!(duration > 0))
                    findings.push(transitionFinding("tween_invalid_duration", "error", transitionName, itemIndex, item, `Tween 时长必须大于 0，实际为 ${String(duration)} 帧`));
                stats.valuesChecked++;
                verifyTransitionValue(doc, transitionName, itemIndex, item, next.value, "end", target, checkBounds, findings, stats);
            }
        }
    }
    if (stats.itemCount === 0)
        findings.push(transitionFinding("empty_transition", "warning", transitionName, -1, null, "Transition 不包含任何公开关键帧"));
    const errors = findings.filter((finding) => finding.severity === "error");
    const warnings = findings.filter((finding) => finding.severity === "warning");
    return {
        name: transitionName,
        valid: errors.length === 0,
        clean: errors.length === 0 && warnings.length === 0,
        itemCount: stats.itemCount,
        checks: {
            targets: stats.targetsChecked,
            values: stats.valuesChecked,
            resources: stats.resourcesChecked,
            nestedTransitions: stats.nestedChecked,
            bounds: { checked: stats.boundsChecked, skipped: stats.boundsSkipped }
        },
        errorCount: errors.length,
        warningCount: warnings.length,
        errors,
        warnings
    };
}
function verifyTransition(params) {
    const doc = getActiveDocument();
    if (!doc.content || !doc.content.transitions)
        throw new Error("当前文档不是组件文档，无法校验 Transition");
    const checkBounds = params && params.checkBounds !== undefined ? Boolean(params.checkBounds) : true;
    const requested = params && params.name !== undefined && params.name !== null ? String(params.name).trim() : "";
    const collection = doc.content.transitions;
    const selected = [];
    if (requested) {
        const name = normalizeTransitionName(requested);
        const transition = collection.GetItem(name);
        if (!transition)
            verificationError("target_not_found", `当前组件中不存在 Transition：${name}`, { stage: "editor", transition: name });
        selected.push(transition);
    }
    else {
        for (let index = 0; index < collection.items.Count; index++)
            selected.push(collection.items.get_Item(index));
    }
    const transitions = selected.map((transition) => verifyOneTransition(doc, transition, checkBounds));
    let errorCount = 0;
    let warningCount = 0;
    let itemCount = 0;
    for (const result of transitions) {
        errorCount += result.errorCount;
        warningCount += result.warningCount;
        itemCount += result.itemCount;
    }
    return {
        ok: true,
        readOnly: true,
        document: describeDocument(doc),
        checkBounds,
        transitions,
        summary: {
            transitionCount: transitions.length,
            itemCount,
            errorCount,
            warningCount,
            valid: errorCount === 0,
            clean: errorCount === 0 && warningCount === 0
        },
        note: "只读校验：不修改文档、不保存。error 表示目标/值/嵌套引用确定有问题；warning 表示可能合法（例如滑入滑出动画的越界坐标），需要人工确认。"
    };
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
function mutateTransitions(params, operation, mutate, verifySpec) {
    // Transition 条目经 transition.CreateItem/DeleteItem 与 FTransitionItem 成员写入。
    lastWritePath = WRITE_PATH_MODEL;
    const doc = getActiveDocument();
    const preSpec = typeof verifySpec === "function" ? null : verifySpec;
    const transitionTarget = { id: null, name: preSpec ? preSpec.name : null, path: null, type: "transition" };
    // Reject impossible reload combinations before any mutation, so a bad
    // request never leaves the user's document half-written.
    validateReloadOptions(params, transitionTarget);
    const before = transitionSnapshot(doc);
    const documentModifiedBefore = doc.isModified;
    let result;
    try {
        result = mutate(doc);
        doc.RefreshTransition();
        doc.RefreshInspectors();
        doc.SetModified(true);
        pushAnimationHistory(doc, before, documentModifiedBefore);
    }
    catch (error) {
        try {
            restoreTransitions(doc, before);
            doc.SetModified(documentModifiedBefore);
        }
        catch (_) { /* preserve the original editor error */ }
        throw error;
    }
    // duplicate_transition only learns the copy's name from the mutation result.
    const spec = typeof verifySpec === "function" ? verifySpec(result) : verifySpec;
    // Verification runs outside the mutation try: a failed save must not roll
    // back an editor mutation that already landed (and may already be saved).
    const verified = transitionWriteVerification(doc, spec.name, spec.present, params);
    const liveDoc = verified.state.doc || doc;
    return {
        ok: true, operation, result, target: { ...transitionTarget, name: spec.name },
        document: describeDocument(liveDoc), transitions: listTransitions(liveDoc),
        documentModified: Boolean(liveDoc.isModified),
        saved: verified.saved, persisted: verified.persisted, strength: verified.strength,
        verification: verified.verification, note: verified.note,
        writePath: verified.writePath
    };
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
    }, { name, present: true });
}
function addTransitionItem(params) {
    return mutateTransitions(params, "item_added", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        definition.items.push(params.item);
        applyTransitionDefinition(doc, transition, definition);
        return describeTransition(transition);
    }, { name: normalizeTransitionName(params.name), present: true });
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
    }, { name: normalizeTransitionName(params.name), present: true });
}
function removeTransitionItem(params) {
    return mutateTransitions(params, "item_removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const definition = describeTransition(transition);
        const found = publicTransitionItem(definition, params.itemIndex);
        definition.items.splice(found.itemIndex, 1);
        applyTransitionDefinition(doc, transition, definition);
        return found.item;
    }, { name: normalizeTransitionName(params.name), present: true });
}
function removeTransition(params) {
    return mutateTransitions(params, "removed", (doc) => {
        const transition = resolveTransition(doc, params.name);
        const removed = describeTransition(transition);
        doc.content.transitions.RemoveItem(transition);
        return removed;
    }, { name: normalizeTransitionName(params.name), present: false });
}
function publicTransitionItems(transition) {
    const items = [];
    for (let index = 0; index < transition.items.Count; index++) {
        const item = transition.items.get_Item(index);
        if (!isSyntheticTweenEndpoint(item))
            items.push(item);
    }
    return items;
}
function transitionTrackItems(transition, targetId, type) {
    const items = [];
    for (let index = 0; index < transition.items.Count; index++) {
        const item = transition.items.get_Item(index);
        if (String(item.targetId || "") === targetId && String(item.type) === type)
            items.push(item);
    }
    return items;
}
// CreateKeyFrame/SetKeyFrameProperty operate on the editor's active timeline.
// Restore the user's playhead and timeline mode on every exit path, including
// validation failures that trim the mutation.
function withTransitionTimeline(doc, transitionName, mutation) {
    const wasTimeline = Boolean(doc.timelineMode);
    const previousName = doc.editingTransition ? String(doc.editingTransition.name) : null;
    const previousHead = doc.head;
    // 名称相同不代表还是同一个对象：upsert/remove 重建 Transition 后，编辑器可能仍
    // 持有旧的 editingTransition 引用，此时 CreateKeyFrame 会写到已被替换的对象里。
    const activeTransition = doc.content.transitions.GetItem(transitionName);
    if (!doc.timelineMode || !doc.editingTransition || doc.editingTransition !== activeTransition)
        doc.EnterTimelineMode(transitionName);
    try {
        return mutation();
    }
    finally {
        try {
            doc.head = previousHead;
        }
        catch (_) { /* best effort */ }
        try {
            if (wasTimeline) {
                const current = doc.editingTransition ? String(doc.editingTransition.name) : null;
                if (previousName && current !== previousName)
                    doc.EnterTimelineMode(previousName);
            }
            else if (doc.timelineMode)
                doc.ExitTimelineMode();
        }
        catch (_) { /* best effort */ }
    }
}
function applyKeyFrameValue(doc, item, raw) {
    applyTransitionValue(doc, String(item.type), item.value, raw);
    lastWritePath = WRITE_PATH_MODEL;
}
function addKeyFrames(params) {
    const name = normalizeTransitionName(params.name);
    const rawKeyframes = params.keyframes;
    if (!Array.isArray(rawKeyframes) || rawKeyframes.length === 0)
        throw new Error("keyframes 必须是非空数组");
    return mutateTransitions(params, "keyframes_added", (doc) => {
        const transition = resolveTransition(doc, name);
        const planned = rawKeyframes.map((raw, index) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw))
                throw new Error(`keyframes[${index}] 必须是对象`);
            assertKnownKeys(raw, ["targetId", "type", "frame", "label", "value"], `keyframes[${index}]`);
            const type = normalizeTransitionType(raw.type);
            const targetId = validateTransitionTarget(doc, raw.targetId, type);
            const frame = nonNegativeInt(raw.frame, `keyframes[${index}].frame`);
            if (raw.label !== undefined && raw.label !== null && typeof raw.label !== "string")
                throw new Error(`keyframes[${index}].label 必须是字符串`);
            return { raw, type, targetId, frame, label: raw.label === undefined || raw.label === null ? null : String(raw.label) };
        });
        // Reject collisions before the first CreateKeyFrame: the editor will
        // happily add a second item on the same track/frame, and duplicates make
        // the tween topology ambiguous.
        const seen = {};
        for (const plan of planned) {
            for (const item of transitionTrackItems(transition, plan.targetId, plan.type))
                if (Number(item.frame) === plan.frame)
                    throw new Error(`关键帧已存在：${plan.type}@${plan.frame} (${plan.targetId || "root"})`);
            const track = `${plan.targetId}|${plan.type}`;
            const frames = seen[track] || (seen[track] = []);
            if (frames.indexOf(plan.frame) >= 0)
                throw new Error(`同一批次关键帧重复：${plan.type}@${plan.frame} (${plan.targetId || "root"})`);
            frames.push(plan.frame);
        }
        return withTransitionTimeline(doc, name, () => {
            const created = [];
            for (const plan of planned) {
                const target = plan.targetId ? findObjectById(doc.content, plan.targetId) : doc.content;
                if (!target)
                    throw new Error(`Transition targetId 不存在：${plan.targetId}`);
                // CreateKeyFrame samples the object's current state at the playhead
                // and adds the item to the transition itself; AddKeyFrame afterwards
                // adds a duplicate and must not be called.
                doc.head = plan.frame;
                const item = doc.CreateKeyFrame(target, plan.type);
                if (!item)
                    throw new Error(`无法创建关键帧：${plan.type}@${plan.frame}`);
                if (plan.raw.value !== undefined)
                    applyKeyFrameValue(doc, item, plan.raw.value);
                if (plan.label !== null)
                    doc.SetKeyFrameProperty(item, "label", plan.label);
                created.push(describeTransitionItem(item));
            }
            return created;
        });
    }, { name, present: true });
}
function locateKeyFrame(transition, params) {
    const publicItems = publicTransitionItems(transition);
    if (params.itemIndex !== undefined && params.itemIndex !== null) {
        const itemIndex = nonNegativeInt(params.itemIndex, "itemIndex");
        if (itemIndex >= publicItems.length)
            throw new Error(`itemIndex 超出范围：${itemIndex}，当前公开关键帧 ${publicItems.length} 个`);
        return { item: publicItems[itemIndex], itemIndex };
    }
    const type = normalizeTransitionType(params.type);
    const targetId = params.targetId === undefined || params.targetId === null ? "" : String(params.targetId);
    const frame = nonNegativeInt(params.frame, "frame");
    // 按 targetId/type/frame 精确定位时也搜索 Tween 合成端点：把关键帧插入已有
    // Tween 后，新帧会变成端点并从 get_transition 的公开列表中消失，但它仍可
    // 通过显式身份寻址（例如再开启 Tween 把轨道续到下一个关键帧）。
    for (let index = 0; index < transition.items.Count; index++) {
        const item = transition.items.get_Item(index);
        if (String(item.targetId || "") === targetId && String(item.type) === type && Number(item.frame) === frame) {
            const publicIndex = publicItems.indexOf(item);
            return { item, itemIndex: publicIndex >= 0 ? publicIndex : null };
        }
    }
    throw new Error(`未找到关键帧：${type}@${frame} (${targetId || "root"})；请提供 itemIndex 或正确的 targetId/type/frame（含 Tween 端点）`);
}
function setKeyframe(params) {
    const name = normalizeTransitionName(params.name);
    const changes = params.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes))
        throw new Error("changes 必须是对象");
    assertKnownKeys(changes, ["frame", "label", "tween", "ease", "repeat", "yoyo", "value", "endValue"], "changes");
    if (Object.keys(changes).length === 0)
        throw new Error("changes 至少需要一个字段");
    if (changes.tween === false && changes.endValue !== undefined)
        throw new Error("tween=false 时不能同时设置 endValue");
    return mutateTransitions(params, "keyframe_updated", (doc) => {
        const transition = resolveTransition(doc, name);
        const located = locateKeyFrame(transition, params);
        const item = located.item;
        // 6.1.4 只能给已处于 Tween 关系中的关键帧开启 Tween（Tween 起点，或插入
        // 已有 Tween 后形成的合成端点）；普通关键帧之间没有端点对象，SetKeyFrameProperty
        // 会静默不生效。这类轨道请用 upsert_transition 定义起止点。
        if (changes.tween === true && !item.tween && !(item.prevItem && item.prevItem.tween))
            throw new Error("该关键帧不在 Tween 关系中，无法直接开启 Tween；请使用 upsert_transition 定义新的起止点");
        // SetKeyFrameProperty 作用于编辑器当前时间轴，未进入时间轴模式时调用
        // 要么抛错、要么改到别处；先进入再写，结束后恢复用户原来的播放头。
        return withTransitionTimeline(doc, name, () => {
            if (changes.frame !== undefined) {
                const newFrame = nonNegativeInt(changes.frame, "changes.frame");
                if (newFrame !== Number(item.frame)) {
                    for (const other of transitionTrackItems(transition, String(item.targetId || ""), String(item.type)))
                        if (other !== item && Number(other.frame) === newFrame)
                            throw new Error(`目标帧已存在关键帧：${item.type}@${newFrame}`);
                    doc.SetKeyFrameProperty(item, "frame", newFrame);
                    lastWritePath = WRITE_PATH_MODEL;
                }
            }
            if (changes.tween !== undefined) {
                doc.SetKeyFrameProperty(item, "tween", Boolean(changes.tween));
                lastWritePath = WRITE_PATH_MODEL;
                if (Boolean(changes.tween) && (!item.tween || !item.nextItem))
                    throw new Error("该关键帧没有可用的 Tween 端点，无法建立 Tween；请先确保下一个关键帧可作为端点，或使用 upsert_transition");
            }
            if (changes.value !== undefined)
                applyKeyFrameValue(doc, item, changes.value);
            if (changes.endValue !== undefined) {
                if (!item.nextItem)
                    throw new Error("关键帧没有 Tween 端点，无法设置 endValue");
                applyKeyFrameValue(doc, item.nextItem, changes.endValue);
            }
            if (changes.label !== undefined) {
                doc.SetKeyFrameProperty(item, "label", String(changes.label));
                lastWritePath = WRITE_PATH_MODEL;
            }
            if (changes.ease !== undefined) {
                const ease = normalizeEase(changes.ease);
                const parts = ease.split(".");
                doc.SetKeyFrameProperty(item, "easeType", parts[0]);
                if (parts.length > 1)
                    doc.SetKeyFrameProperty(item, "easeInOutType", parts[1]);
                lastWritePath = WRITE_PATH_MODEL;
            }
            if (changes.repeat !== undefined) {
                const repeat = Number(changes.repeat);
                if (!Number.isInteger(repeat) || repeat < -1 || repeat > 1000000)
                    throw new Error("changes.repeat 必须是 -1 到 1000000 之间的整数");
                doc.SetKeyFrameProperty(item, "repeat", repeat);
                lastWritePath = WRITE_PATH_MODEL;
            }
            if (changes.yoyo !== undefined) {
                doc.SetKeyFrameProperty(item, "yoyo", Boolean(changes.yoyo));
                lastWritePath = WRITE_PATH_MODEL;
            }
            // 开启 Tween 会让合成端点变成公开的 Tween 起点；因此索引在写入后重算。
            const publicIndex = publicTransitionItems(transition).indexOf(item);
            return {
                itemIndex: publicIndex >= 0 ? publicIndex : null,
                syntheticEndpoint: isSyntheticTweenEndpoint(item),
                item: describeTransitionItem(item)
            };
        });
    }, { name, present: true });
}
function duplicateTransition(params) {
    const sourceName = normalizeTransitionName(params.name);
    const rawNewName = params.newName === undefined || params.newName === null ? "" : String(params.newName).trim();
    const requestedName = rawNewName ? normalizeTransitionName(rawNewName) : null;
    return mutateTransitions(params, "duplicated", (doc) => {
        const transitions = doc.content.transitions;
        const source = resolveTransition(doc, sourceName);
        if (requestedName && transitions.GetItem(requestedName))
            throw new Error(`Transition 已存在：${requestedName}`);
        // 复制同样在编辑器时间轴上下文中执行；结束后恢复用户原来的时间轴。
        const duplicate = withTransitionTimeline(doc, sourceName, () => {
            const copy = doc.DuplicateTransition(sourceName);
            if (!copy)
                throw new Error(`复制 Transition 失败：${sourceName}`);
            // 6.1.4 ignores the documented newInstanceName argument (the copy keeps a
            // null name), so rename through the document model after duplicating.
            if (requestedName)
                doc.SetTransitionProperty(copy, "name", requestedName);
            return copy;
        });
        const duplicateName = String(duplicate.name || "");
        if (!duplicateName)
            throw new Error("复制后的 Transition 名称为空");
        const stored = transitions.GetItem(duplicateName);
        if (!stored)
            throw new Error(`复制后的 Transition 未进入集合：${duplicateName}`);
        lastWritePath = WRITE_PATH_MODEL;
        const sourceDefinition = describeTransition(source);
        const duplicateDefinition = describeTransition(stored);
        return {
            source: sourceDefinition,
            duplicate: duplicateDefinition,
            structureNormalized: JSON.stringify(sourceDefinition.items) !== JSON.stringify(duplicateDefinition.items),
            requestedName
        };
    }, (result) => ({ name: String(result.duplicate.name), present: true }));
}
async function importSound(params) {
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
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
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
        return packageWriteResult({ operation: "replaced", requestedName, actualName: existing.name, sourcePath, folderPath, item: describeItem(existing), packageModified: true, requiresSave: true, diskWrite: true }, pkg, packageItemRef(existing, "sound", target.path, true), params);
    }
    const item = await puerts.$promise(pkg.ImportResource(sourcePath, target.path, `${actualName}${String(IOPath.GetExtension(sourcePath) || "")}`));
    if (!item || item.type !== FairyEditor.FPackageItemType.SOUND)
        throw new Error(`导入声音失败：${sourcePath}`);
    item.exported = params.exported !== false;
    item.SetChanged();
    markPackageChanged(pkg);
    return packageWriteResult({ operation: "imported", requestedName, actualName: item.name, sourcePath, folderPath, item: describeItem(item), packageModified: true, requiresSave: true, diskWrite: true }, pkg, packageItemRef(item, "sound", target.path, true), params);
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
    validatePackageWriteOptions(params, "movieclip", true);
    const pkg = resolvePackage(params);
    const requestedName = validateResourceName(params.movieClipName, "movieClipName");
    const folderPath = normalizePackagePath(params.folderPath);
    const target = resolveWriteFolder(pkg, params, folderPath, params.createFolders !== false);
    const folder = target.folder;
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
        item = pkg.CreateMovieClipItem(name, target.path, false);
    if (!item)
        throw new Error(`创建 MovieClip 失败：${name}`);
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
        }, pkg, packageItemRef(item, "movieclip", target.path, true), params);
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
    validatePackageWriteOptions(params, "movieclip", true);
    const item = resolveItem(params.movieClip || params);
    assertItemBranchScope(item, params, "update_movieclip");
    const updateKeys = ["framePaths", "fps", "speed", "repeatDelay", "swing", "frameDelays", "exported", "compressPng"];
    if (!updateKeys.some((key) => params[key] !== undefined))
        throw new Error("update_movieclip 至少需要提供一个更新字段");
    const result = await configureMovieClip(item, { ...params, recordHistory: true });
    return packageWriteResult({ operation: "updated", movieClip: result, resourceChanges: result.resourceChanges || [], packageModified: true, requiresSave: true, diskWrite: true, undoable: true }, item.owner, packageItemRef(item, "movieclip", String(item.path || ""), true), params);
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
    // 删除没有诚实的重载基元（资源句柄已随删除失效），externalReload 不支持。
    validatePackageWriteOptions(params, "movieclip", false);
    const item = resolveItem(params.movieClip || params);
    assertItemBranchScope(item, params, "remove_movieclip");
    if (item.type !== FairyEditor.FPackageItemType.MOVIECLIP)
        throw new Error("目标资源不是 MovieClip");
    if (params.force !== true)
        throw new Error("删除 MovieClip 是不可逆包资源操作；请显式传 force=true 确认");
    const references = findMovieClipReferences(item);
    if (references.length > 0)
        throw new Error(`MovieClip 正在被引用，不能删除：${references.join(", ")}`);
    const pkg = item.owner;
    const removed = describeLoadedMovieClip(item, await ensureMovieClipAsset(item));
    const ref = { id: String(item.id), url: String(item.GetURL()), name: String(item.name), type: "movieclip", path: String(item.path || ""), branch: String(item.branch || ""), present: false, file: item.file ? String(item.file) : null };
    clearAgentHistory();
    pkg.DeleteItem(item);
    markPackageChanged(pkg);
    return packageWriteResult({ operation: "removed", movieClip: removed, references, packageModified: true, requiresSave: true, diskWrite: true, undoable: false }, pkg, ref, params);
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
const numericWritableProperties = {
    x: true, y: true, width: true, height: true,
    scaleX: true, scaleY: true, skewX: true, skewY: true,
    pivotX: true, pivotY: true, rotation: true, alpha: true
};
const booleanWritableProperties = {
    anchor: true, visible: true, touchable: true, opaque: true, grayed: true,
    enabled: true, locked: true, hideByEditor: true, useSourceSize: true
};
const stringWritableProperties = {
    name: true, text: true, icon: true, font: true,
    tooltips: true, blendMode: true, customData: true, notes: true
};
// Normalizes once, before the mutation, so the value sent to the Editor and the
// value used as the verification expectation can never diverge.
function normalizeWritableValue(property, value) {
    if (numericWritableProperties[property]) {
        const number = Number(value);
        if (!Number.isFinite(number))
            verificationError("invalid_argument", `${property} 必须是有限数字`, { stage: "input", property, value });
        return number;
    }
    if (booleanWritableProperties[property]) {
        if (typeof value === "boolean")
            return value;
        if (value === 0 || value === 1)
            return Boolean(value);
        if (value === "true" || value === "false")
            return value === "true";
        verificationError("invalid_argument", `${property} 只接受布尔值`, { stage: "input", property, value });
    }
    if (stringWritableProperties[property]) {
        if (value === null || value === undefined)
            verificationError("invalid_argument", `${property} 不能为 null`, { stage: "input", property });
        return String(value);
    }
    return value;
}
function validatePropertyTarget(doc, obj, property) {
    const isRoot = obj === doc.content;
    if (isRoot && property === "touchable") {
        throw new Error("FairyGUI 组件根节点不序列化 touchable，无法持久化该属性；" +
            "如需让透明根区域不拦截点击，请设置根组件 opaque=false，并分别设置需要穿透的子对象 touchable=false");
    }
    if (property === "opaque" && !isRoot)
        throw new Error("opaque 是组件定义属性，只能对当前文档根组件设置");
}
// ---------- P8-0: 写入路径归位到编辑器文档模型层 ----------
//
// FairyGUI Editor 的文档模型层是 FairyEditor.View.DocElement（经 FObject.docElement 取到）。
// 直接改 F* 对象模型时编辑器不知道文档被改过：6.1.4 实测 FRelations.Reset()+AddItem 就是
// 这么把文档卡在 modified 且 save 静默失败（见 FGUI-BRIDGE-IMPROVEMENT-PLAN Phase 4 记录）。
//
// Bridge 过去对所有写 action 统一手工 doc.SetModified(true) 兜底。那是补丁不是正解——
// 它只骗过"要不要保存"这个开关，文档内部状态与序列化结果仍然可能不一致，而这种不一致
// 往往到 external reload 才暴露，表现为"内存已改、磁盘没改"。
//
// DocElement.SetProperty 与 FObject.SetProperty 签名完全一致
// (propName: string, value: any) => void（editor.d.ts L20114 / L17537），因此可按签名直接替换。
const WRITE_PATH_DOCUMENT = "document-model";
const WRITE_PATH_MODEL = "object-model";
// 原生批处理入口（DependencyQuery.ReplaceReferences）：不经 Document、不产生脏文档，
// 直接改包 XML。单独标出来，免得把它的落盘行为误读成"文档模型写"。
const WRITE_PATH_NATIVE = "native-batch";
// 带外写入：直接改 package.xml 后 Dispose + 重开包。现有资源上的 atlas 属性
// 在 6.1.4 上不可由 folderAtlas setter 修改（见 P8-5 探针），这是唯一的纠正路线。
const WRITE_PATH_OUT_OF_BAND = "out-of-band-xml";
// 最近一次写入实际走的路径。由各写入路径显式设置，验证层读取并回报，
// 让"绕过文档模型"变成可观测事实而不是事后才知道的静默失败。
//
// 必须是"每条写路径都显式声明"，不能用上一次的值兜底：各写路径的写入方式
// 并不相同（文本样式与布局成员是直接成员赋值，relation/gear 走 DocElement，
// controller/transition 走对象模型成员），一旦某条路径忘了设置，继承上一个
// action 的值就会**撒谎**——真机复验时 set_text_style 报出 document-model
// 就是这么来的。因此每个请求入口重置为 null，未声明即报 null（unknown）。
let lastWritePath = null;
function beginWrite() {
    lastWritePath = null;
}
function docElementFor(obj) {
    try {
        const el = obj ? obj.docElement : null;
        return el && typeof el.SetProperty === "function" ? el : null;
    }
    catch (_) {
        return null;
    }
}
// 走文档模型写入单个属性；不可用或抛错时回退到对象模型。
// 返回实际使用的路径，供调用方回报。
function writeObjectProperty(obj, property, value) {
    const el = docElementFor(obj);
    if (el) {
        try {
            el.SetProperty(property, value);
            lastWritePath = WRITE_PATH_DOCUMENT;
            return WRITE_PATH_DOCUMENT;
        }
        catch (_) { /* 回退到对象模型 */ }
    }
    obj.SetProperty(property, value);
    lastWritePath = WRITE_PATH_MODEL;
    return WRITE_PATH_MODEL;
}
function getWritableProperty(obj, property) {
    if (property === "opaque")
        return obj.opaque;
    return obj.GetProperty(property);
}
function setWritableProperty(obj, property, value) {
    if (property === "opaque") {
        // opaque 是组件定义属性、只存在于 FComponent 成员上，文档模型没有对应入口，
        // 保持成员写入；它的持久化由 writeVerification 的磁盘回读保证。
        if (typeof value !== "boolean")
            throw new Error("opaque 只接受布尔值");
        obj.opaque = value;
        lastWritePath = WRITE_PATH_MODEL;
        return WRITE_PATH_MODEL;
    }
    return writeObjectProperty(obj, property, value);
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
        atlasAssignmentRule: {
            rule: "packer-constraints",
            aloneAtlas: ALONE_ATLAS,
            folderAtlasSource: "package.xml",
            appliedAt: ["import_image", "import_image(replace)", "publish"],
            constraintSource: packages.length > 0 && packages[0].useGlobalAtlasSettings === false
                ? "package:PackSettings"
                : "global:AtlasSetting",
            note: "0.8.14 起图集归属由打包器真实约束判定，不再使用硬编码尺寸常量；约束不足时判为 unknown 且不写盘。判据见 analyze_atlas_fit。"
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
// ------------------------------------------------------------------
// 包级发布设置写入（set_publish_settings）
//
// 6.1.4 实测约束，三条都决定了写法：
//   ① FPackage.publishSettings 是**只读 getter**（`public get publishSettings()`），
//      换不了对象，只能改它暴露的字段；
//   ② atlasList / excludedList 是 public List 字段，就地 Clear + Add 重建；
//   ③ 包级设置**没有 DocElement 入口**，天然走对象模型，所以响应必须显式声明
//      writePath: object-model，不参与组件文档的撤销栈——这是 0.8.8 踩过的
//      「FRelations.Reset()+AddItem 绕过文档模型 → 文档卡在 modified 且 save 静默失败」
//      同一类风险的正确姿势：明说走哪条路，而不是假装在文档模型里。
// ------------------------------------------------------------------
const PUBLISH_SCALAR_WRITABLE = {
    path: "string",
    genCode: "boolean",
    codePath: "string",
    branchPath: "string",
    useGlobalAtlasSettings: "boolean"
};
// PackSettings 里这些是数值字段（padding 是 int，其余是尺寸）。
const PACK_NUMBER_WRITABLE = ["padding", "minWidth", "minHeight", "maxWidth", "maxHeight"];
const PACK_BOOL_WRITABLE = ["pot", "mof", "rotation", "square", "fast", "edgePadding", "duplicatePadding", "multiPage"];
const ATLAS_BOOL_WRITABLE = ["compression", "extractAlpha"];
function atlasSettingsToPlain(atlas) {
    return {
        name: String((atlas && atlas.name) || ""),
        compression: !!(atlas && atlas.compression),
        extractAlpha: !!(atlas && atlas.extractAlpha),
        packSettings: readPackSettings(atlas ? atlas.packSettings : null)
    };
}
function readAtlasSettingsList(list) {
    const result = [];
    if (!isHostObject(list))
        return result;
    for (let i = 0; i < list.Count; i++) {
        const atlas = list.get_Item(i);
        if (atlas)
            result.push(atlasSettingsToPlain(atlas));
    }
    return result;
}
// 包级设置的内存快照。字段与 describePublishSettings 对齐，验证梯子两阶段共用同一形状。
function readPublishSettingsMemory(pkg) {
    const ps = pkg.publishSettings;
    if (!ps)
        return null;
    return {
        path: String(ps.path || ""),
        fileName: String(ps.fileName || ""),
        packageCount: Number(ps.packageCount) || 0,
        genCode: !!ps.genCode,
        codePath: String(ps.codePath || ""),
        branchPath: String(ps.branchPath || ""),
        useGlobalAtlasSettings: !!ps.useGlobalAtlasSettings,
        atlasList: readAtlasSettingsList(ps.atlasList),
        excludedList: stringListToArray(ps.excludedList)
    };
}
// package.xml 的 <publish> 节点是包级设置的持久化位置。属性名**不做假设**：
// 原样透出全部键值，未识别的键同样是证据。照名字猜一套「看起来合理」的
// 属性名去断言，会在真机上安静地验证错对象（0.8.10 的 ReferenceInfo 就是这么骗人的）。
function persistedPublishSettings(pkg) {
    const file = IOPath.Combine(String(pkg.basePath || ""), "package.xml");
    if (!IOFile.Exists(file))
        verificationError("persistence_failed", "无法读取 package.xml", { stage: "xml", file });
    const XmlType = CS.FairyGUI.Utils.XML;
    let xml = null;
    try {
        xml = new XmlType(String(IOFile.ReadAllText(file)));
    }
    catch (error) {
        verificationError("persistence_failed", "package.xml 解析失败", { stage: "xml", file, reason: String(error) });
    }
    const node = xml.GetNode("publish");
    if (!node)
        return { present: false, file, attributes: {}, childElements: [] };
    const childElements = [];
    if (isHostObject(node.elements)) {
        for (let i = 0; i < node.elements.Count; i++) {
            const child = node.elements.get_Item(i);
            childElements.push({ element: String(child.name), attributes: xmlAttributes(child) });
        }
    }
    return { present: true, file, attributes: xmlAttributes(node), childElements };
}
function rejectUnknownFields(spec, allowed, label) {
    if (!isHostObject(spec))
        return;
    for (const key of Object.keys(spec)) {
        if (allowed.indexOf(key) < 0)
            verificationError("invalid_argument", `未知的${label}字段：${key}`, { field: key, allowed });
    }
}
function applyPackSettings(pack, spec) {
    for (const key of PACK_NUMBER_WRITABLE) {
        if (spec[key] === undefined)
            continue;
        const value = Number(spec[key]);
        if (!isFinite(value) || value < 0)
            verificationError("invalid_argument", `packSettings.${key} 需要非负有限数值`, { field: key, value: spec[key] });
        pack[key] = value;
    }
    for (const key of PACK_BOOL_WRITABLE) {
        if (spec[key] === undefined)
            continue;
        if (typeof spec[key] !== "boolean")
            verificationError("invalid_argument", `packSettings.${key} 需要布尔值`, { field: key, value: spec[key] });
        pack[key] = spec[key];
    }
}
// 全量校验先行：任何一条不合法都在**改动包之前**拒绝，避免半写入后无法回滚。
function validatePublishSettingsSpec(spec) {
    if (!isHostObject(spec))
        verificationError("invalid_argument", "settings 必须是对象", {});
    rejectUnknownFields(spec, Object.keys(PUBLISH_SCALAR_WRITABLE).concat(["atlasList", "excludedList"]), "settings");
    const plan = { scalars: {}, atlasList: null, excludedList: null };
    for (const key of Object.keys(PUBLISH_SCALAR_WRITABLE)) {
        if (spec[key] === undefined)
            continue;
        const kind = PUBLISH_SCALAR_WRITABLE[key];
        if (kind === "string") {
            if (typeof spec[key] !== "string")
                verificationError("invalid_argument", `settings.${key} 需要字符串`, { field: key, value: spec[key] });
        }
        else if (typeof spec[key] !== "boolean") {
            verificationError("invalid_argument", `settings.${key} 需要布尔值`, { field: key, value: spec[key] });
        }
        plan.scalars[key] = spec[key];
    }
    if (spec.excludedList !== undefined) {
        if (!Array.isArray(spec.excludedList))
            verificationError("invalid_argument", "settings.excludedList 需要字符串数组", { field: "excludedList" });
        plan.excludedList = spec.excludedList.map((value) => String(value));
    }
    if (spec.atlasList !== undefined) {
        if (!Array.isArray(spec.atlasList))
            verificationError("invalid_argument", "settings.atlasList 需要数组", { field: "atlasList" });
        // 真机实测（Editor 6.1.4）：atlasList 为空时不能保存——FPackage.SavePublishSettings
        // 会抛 "Index was out of range"，此后该包**每次 Save 都崩**。这不是一次失败的
        // 保存，是把工程留在坏状态里，所以空列表必须在写入前就拒绝：清空图集设置只能
        // 在编辑器设置界面里做。
        if (spec.atlasList.length === 0)
            verificationError("invalid_argument", "atlasList 不能是空列表：FairyGUI 6.1.4 保存空图集列表会抛 Index was out of range 并使该包此后保存持续崩溃。要清空图集设置请在编辑器设置界面里操作。", { field: "atlasList" });
        // 全量替换语义：数组就是要落盘的最终列表，不做增量合并，避免留下
        // 调用方以为已经删掉、实际还留在 List 里的条目。
        plan.atlasList = spec.atlasList.map((entry, index) => {
            const label = `settings.atlasList[${index}]`;
            if (!isHostObject(entry))
                verificationError("invalid_argument", `${label} 需要对象`, { index });
            rejectUnknownFields(entry, ["name", "compression", "extractAlpha", "packSettings"], label);
            const name = entry.name === undefined ? "" : String(entry.name);
            if (!name)
                verificationError("invalid_argument", `${label}.name 不能为空：图集名要和资源上的 folderAtlas 对应`, { index });
            // 只保留调用方**显式给过**的键。new AtlasSettings() 的 compression /
            // extractAlpha 取什么默认值真机未确认，替调用方填个默认值再拿去断言，
            // 就是在断言一批没人知道真值的值——真机上必炸，模拟宿主上反而假通过。
            const atlas = { name };
            for (const key of ATLAS_BOOL_WRITABLE) {
                if (entry[key] === undefined)
                    continue;
                if (typeof entry[key] !== "boolean")
                    verificationError("invalid_argument", `${label}.${key} 需要布尔值`, { index, field: key });
                atlas[key] = entry[key];
            }
            const packSpec = entry.packSettings === undefined ? {} : entry.packSettings;
            if (!isHostObject(packSpec))
                verificationError("invalid_argument", `${label}.packSettings 需要对象`, { index });
            // sizeOption 是 readPackSettings 的输出字段（归一化后的 pot 别名），
            // 不是 PackSettings 的可写字段，写回它会静默丢失。
            rejectUnknownFields(packSpec, PACK_NUMBER_WRITABLE.concat(PACK_BOOL_WRITABLE), `${label}.packSettings`);
            atlas.packSettings = packSpec;
            atlas.requestedPackFields = Object.keys(packSpec);
            return atlas;
        });
        const names = plan.atlasList.map((entry) => entry.name);
        const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
        if (duplicates.length)
            verificationError("invalid_argument", `atlasList 存在重复图集名：${duplicates.join(", ")}`, { duplicates });
    }
    return plan;
}
// compareVerification 走 diffExpectedValues，而它是 `===` 比较：对象和数组按引用
// 比，atlasList / excludedList 放进去必然不等，只能被判失败。所以列表类字段必须
// 逐项比。
//
// packSettings 还有一个更隐蔽的陷阱：expected 只能包含**调用方显式给过的键**。
// new PackSettings() 的其余字段取什么默认值真机未确认，照 readPackSettings 的形状
// 把整份填满去断言，等于断言了一批没人知道真值的数字——它要么假通过，要么在真机上
// 用真实默认值炸掉，两种都是噪声。
// 真机实测（Editor 6.1.4）：package.xml 的包级发布设置编码**只覆盖一部分字段**。
// 观察到的真实形状：
//   <publish name="" maxAtlasSize="2048" rotation="true" multiPage="false" maxAtlasIndex="0">
//     <atlas name="Main" compression="true" index="0"/>
//   </publish>
// 能下结论与不能下结论的分开列，不能下结论的一律标 unverified 而不是猜：
//   * maxWidth 有编码（maxAtlasSize），但它同时充当 maxHeight 的上限——写
//     maxWidth=2048 / maxHeight=4096，Dispose+Open 后 maxHeight 回落成 2048。
//   * padding 没有任何编码：写 20，Dispose+Open 后回到编辑器默认值 2。
//   * rotation 有编码（<publish rotation>）。
// 这些字段要跨重启保留，只能在编辑器设置界面里改；Bridge 写了留不住。
// 与其瞒到 externalReload 才 fail-closed 出来，不如写之前就说清楚。
const PACK_PERSISTENCE = {
    maxWidth: { status: "persisted", code: "publish@maxAtlasSize", note: "与 maxHeight 共用同一个值" },
    maxHeight: { status: "losesValue", code: "publish@maxAtlasSize", note: "没有独立编码；写与 maxWidth 不同的值，重开后回落到 maxWidth" },
    padding: { status: "losesValue", code: "", note: "真机实测：写 20，Dispose+Open 后回到默认值 2" },
    multiPage: { status: "persisted", code: "publish@multiPage", note: "" },
    minWidth: { status: "unverified", code: "", note: "<publish> 无对应属性，真机未单独验证非默认值" },
    minHeight: { status: "unverified", code: "", note: "<publish> 无对应属性，真机未单独验证非默认值" },
    rotation: { status: "persisted", code: "publish@rotation", note: "真机实测会写成 <publish rotation=\"true\">" },
    square: { status: "unverified", code: "", note: "<publish> 无对应属性，真机未单独验证非默认值" },
    pot: { status: "unverified", code: "", note: "真机读到 pot=true，但 <publish> 无对应属性" },
    mof: { status: "unverified", code: "", note: "<publish> 无对应属性" },
    fast: { status: "unverified", code: "", note: "<publish> 无对应属性" },
    edgePadding: { status: "unverified", code: "", note: "<publish> 无对应属性" },
    duplicatePadding: { status: "unverified", code: "", note: "<publish> 无对应属性" }
};
// 把本次请求涉及的字段的落盘前景摆到响应里。调用方在传 save/externalReload
// 之前就能看到「这几个字段留不住」，而不是等验证梯子把它变成一次失败。
function publishPersistenceProfile(plan) {
    const requested = [];
    if (plan && plan.atlasList) {
        for (const spec of plan.atlasList) {
            for (const key of spec.requestedPackFields || []) {
                const entry = PACK_PERSISTENCE[key];
                requested.push({
                    atlas: spec.name,
                    field: key,
                    status: entry ? entry.status : "unverified",
                    code: entry ? entry.code : "",
                    note: entry ? entry.note : ""
                });
            }
        }
    }
    return { editorVersion: "6.1.4", diskNode: "package.xml <publish>", requested, fieldProfiles: PACK_PERSISTENCE };
}
function comparePublishSettings(expected, actual, stage, target) {
    const differences = [];
    if (!actual) {
        verificationError(stage === "editor" ? "editor_rejected" : "persistence_failed", `验证失败：${stage}`, { stage, target, expected, actual: null, differences: [{ property: "present", expected: true, actual: false }], mutationMayHaveOccurred: true });
    }
    for (const key of Object.keys(expected.scalars)) {
        const e = expected.scalars[key];
        const a = actual[key];
        if (typeof e === "boolean" ? a !== e : String(a === undefined || a === null ? "" : a) !== String(e))
            differences.push({ property: key, expected: e, actual: a === undefined ? null : a });
    }
    if (expected.excludedList !== null) {
        const e = expected.excludedList;
        const a = actual.excludedList || [];
        if (e.length !== a.length)
            differences.push({ property: "excludedList.length", expected: e.length, actual: a.length });
        else
            for (let i = 0; i < e.length; i++)
                if (e[i] !== a[i])
                    differences.push({ property: `excludedList[${i}]`, expected: e[i], actual: a[i] });
    }
    if (expected.atlasList !== null) {
        const e = expected.atlasList;
        const a = actual.atlasList || [];
        if (e.length !== a.length)
            differences.push({ property: "atlasList.length", expected: e.length, actual: a.length });
        else
            for (let i = 0; i < e.length; i++) {
                const ea = e[i];
                const aa = a[i];
                if (ea.name !== aa.name)
                    differences.push({ property: `atlasList[${i}].name`, expected: ea.name, actual: aa.name });
                for (const key of ATLAS_BOOL_WRITABLE) {
                    if (!(key in ea))
                        continue;
                    if (Boolean(ea[key]) !== Boolean(aa[key]))
                        differences.push({ property: `atlasList[${i}].${key}`, expected: ea[key], actual: aa[key] });
                }
                const pack = ea.packSettings || {};
                for (const key of Object.keys(pack)) {
                    const av = aa.packSettings ? aa.packSettings[key] : undefined;
                    const mismatch = typeof pack[key] === "number"
                        ? Math.abs(pack[key] - (Number(av) || 0)) > 0.00001
                        : Boolean(pack[key]) !== Boolean(av);
                    if (mismatch)
                        differences.push({ property: `atlasList[${i}].packSettings.${key}`, expected: pack[key], actual: av === undefined ? null : av });
                }
            }
    }
    if (differences.length)
        verificationError(stage === "editor" ? "editor_rejected" : "persistence_failed", `验证失败：${stage}`, { stage, target, expected, actual, differences, mutationMayHaveOccurred: true });
}
// 包级 external reload：包级设置没有 DocElement 入口，只能 Dispose + Open 重开包。
// 这是**同进程**重开，跨重启持久化不在本 Action 的证明范围内——
// folderAtlas 已经实测过「内存写盘但重启不读回」，所以这里同样不把同进程回读
// 当成跨重启证据，caveat 明确写出来。
function reloadPackageForSettings(pkg) {
    const packageId = String(pkg.id);
    const basePath = String(pkg.basePath || "");
    pkg.Dispose();
    const reopened = App.project.GetPackage(packageId);
    if (!reopened)
        verificationError("persistence_failed", "包重开失败：工程内找不到该包", { stage: "reload", packageId });
    reopened.EnsureOpen();
    return { reopened, packageId, basePath, strategy: "package-dispose-open" };
}
function setPublishSettings(params) {
    const pkg = resolvePackage(params);
    const publishSettings = pkg.publishSettings;
    if (!publishSettings)
        verificationError("invalid_argument", "该包没有发布设置，无法写入", { packageName: pkg.name });
    if (params && params.externalReload && params.save === false)
        verificationError("invalid_argument", "externalReload 需要先保存（不要同时传 save:false）", {});
    const plan = validatePublishSettingsSpec(params ? params.settings : null);
    const target = { packageId: String(pkg.id), packageName: String(pkg.name), basePath: String(pkg.basePath || "") };
    const before = readPublishSettingsMemory(pkg);
    // 写标量
    for (const key of Object.keys(plan.scalars)) {
        if (PUBLISH_SCALAR_WRITABLE[key] === "boolean")
            publishSettings[key] = Boolean(plan.scalars[key]);
        else
            publishSettings[key] = String(plan.scalars[key]);
    }
    // excludedList：就地重建
    if (plan.excludedList !== null) {
        publishSettings.excludedList.Clear();
        for (const value of plan.excludedList)
            publishSettings.excludedList.Add(value);
    }
    // atlasList：就地重建，PackSettings 是嵌套对象，整条替换
    if (plan.atlasList !== null) {
        publishSettings.atlasList.Clear();
        for (const spec of plan.atlasList) {
            const atlas = new FairyEditor.AtlasSettings();
            atlas.name = spec.name;
            for (const key of ATLAS_BOOL_WRITABLE) {
                if (spec[key] !== undefined)
                    atlas[key] = spec[key];
            }
            // 真机实测（Editor 6.1.4）：AtlasSettings.packSettings 虽然在声明里是
            // `public packSettings` 字段，运行时却是**只读属性**——赋值抛
            // "Cannot assign to read only property 'packSettings'"。只能取现有实例
            // 就地改字段，换不了整个对象。声明的 public 与运行时的可写性不是一回事。
            const pack = atlas.packSettings;
            if (!pack)
                verificationError("editor_rejected", "新建 AtlasSettings 没有可写的 packSettings 实例，无法设置包级打包约束", { field: "packSettings", atlas: spec.name });
            applyPackSettings(pack, spec.packSettings);
            publishSettings.atlasList.Add(atlas);
        }
    }
    markPackageChanged(pkg);
    // 只验证本次实际请求过的字段：未请求的字段不在 expected 里，否则「我没碰
    // codePath 却因为 codePath 变了而失败」。
    const expected = plan;
    comparePublishSettings(expected, readPublishSettingsMemory(pkg), "editor", target);
    let saved = false;
    if (params.save) {
        try {
            if (typeof pkg.EnsureOpen === "function")
                pkg.EnsureOpen();
            pkg.Save();
            App.project.Save();
        }
        catch (error) {
            verificationError("persistence_failed", "保存包或工程失败", { stage: "save", target, reason: String(error), expected });
        }
        saved = true;
    }
    let xmlReadback = false;
    let xmlValues = null;
    if (saved && params.verify !== false) {
        // 磁盘层只回报原始结构，不做等值断言：<publish> 的属性编码尚未在真机上钉死，
        // 先把事实拿出来（见 persistedPublishSettings 注释），下一轮再收紧成断言。
        xmlValues = persistedPublishSettings(pkg);
        xmlReadback = true;
    }
    let reloaded = null;
    if (xmlReadback && params.externalReload) {
        const reload = reloadPackageForSettings(pkg);
        const reloadedMemory = readPublishSettingsMemory(reload.reopened);
        comparePublishSettings(expected, reloadedMemory, "reload", target);
        reloaded = { performed: true, strategy: reload.strategy, values: reloadedMemory };
    }
    const verification = { editorReadback: true, xmlReadback, externalReload: Boolean(reloaded), expected, editor: readPublishSettingsMemory(pkg), xml: xmlValues, reload: reloaded };
    const strength = verificationStrength(verification, saved);
    const profile = publishPersistenceProfile(plan);
    const lossy = profile.requested.filter((entry) => entry.status === "losesValue");
    return {
        ok: true, target, saved,
        persisted: strength !== NONE_STRENGTH,
        strength,
        writePath: WRITE_PATH_MODEL,
        verification,
        persistenceProfile: profile,
        before,
        after: readPublishSettingsMemory(pkg),
        requiresSave: !saved,
        note: `${strengthNote(verification, saved, "包级发布设置验证覆盖编辑器内存回读与 package.xml 的 <publish> 节点；")}包级设置无 DocElement 入口，走对象模型、不进组件撤销栈；externalReload 是同进程重开包，不等于跨重启持久化。`
            + (lossy.length ? `本次请求中有 ${lossy.length} 个 packSettings 字段在 package.xml 里没有编码，保存后重开不会保留（见 persistenceProfile.requested）：${lossy.map((entry) => `${entry.field}(${entry.atlas})`).join(", ")}。` : "")
    };
}
function readPackSettings(pack) {
    if (!pack)
        return null;
    return {
        sizeOption: pack.pot ? "pot" : "",
        maxWidth: Number(pack.maxWidth) || 0,
        maxHeight: Number(pack.maxHeight) || 0,
        minWidth: Number(pack.minWidth) || 0,
        minHeight: Number(pack.minHeight) || 0,
        padding: Number(pack.padding) || 0,
        square: !!pack.square,
        rotation: !!pack.rotation,
        pot: !!pack.pot,
        mof: !!pack.mof,
        multiPage: !!pack.multiPage
    };
}
// 包级 atlasList 里的每一条 AtlasSettings 是一条独立图集约束；条目按名字与资源的
// folderAtlas 对应，对不上的资源不猜，报 unknown。
function readPackageAtlasConstraints(pkg) {
    const publishSettings = pkg.publishSettings;
    if (!publishSettings || !publishSettings.atlasList)
        return [];
    const result = [];
    for (let i = 0; i < publishSettings.atlasList.Count; i++) {
        const atlas = publishSettings.atlasList.get_Item(i);
        const pack = readPackSettings(atlas ? atlas.packSettings : null);
        if (!pack)
            continue;
        result.push({
            source: "package",
            atlas: String((atlas && atlas.name) || ""),
            sizeOption: pack.sizeOption,
            maxWidth: pack.maxWidth,
            maxHeight: pack.maxHeight,
            minWidth: pack.minWidth,
            minHeight: pack.minHeight,
            padding: pack.padding,
            square: pack.square,
            rotation: pack.rotation,
            pot: pack.pot,
            mof: pack.mof,
            multiPage: pack.multiPage
        });
    }
    return result;
}
// 全局 AtlasSetting 没有 padding/minWidth 概念，maxSize 同时是宽高上限；
// sizeOption 只有 pot 时才等价于 PackSettings.pot。
function readGlobalAtlasConstraints(settings) {
    const atlasSetting = settings.atlasSetting;
    if (!atlasSetting)
        return [];
    const maxSize = Number(atlasSetting.maxSize) || 0;
    return [{
            source: "global",
            atlas: "",
            sizeOption: String(atlasSetting.sizeOption || ""),
            maxWidth: maxSize,
            maxHeight: maxSize,
            minWidth: 0,
            minHeight: 0,
            padding: 0,
            square: !!atlasSetting.forceSquare,
            rotation: !!atlasSetting.allowRotation,
            pot: String(atlasSetting.sizeOption || "") === "pot",
            mof: false,
            multiPage: !!atlasSetting.paging
        }];
}
function resolveAtlasConstraints(pkg, settings) {
    const publishSettings = pkg.publishSettings;
    if (!publishSettings || publishSettings.useGlobalAtlasSettings !== false)
        return readGlobalAtlasConstraints(settings);
    return readPackageAtlasConstraints(pkg);
}
// 约束是否够用：上限必须是正数，否则 packer 没告诉我们页有多大，
// 此时报 unknown 而不是报 fits——「猜它装得下」和「确认它装得下」不能混同。
function constraintsUsable(c) {
    return c.maxWidth > 0 && c.maxHeight > 0;
}
// 单图 fit 判定。padding 在每个方向占 2 份；minWidth/minHeight 表示打包器会把
// 过小的图放大到下限，所以足迹取 max(实际+padding, 下限)；rotation 允许 90°
// 打包，**任一朝向成立即算装得下**；square（方形图集）下每张图占一个正方形区域，
// 正方形边长在旋转下不变，所以旋转对 square 没有帮助。
function judgeAtlasFit(width, height, c) {
    const padding = Math.max(0, c.padding);
    const orientations = [[width, height]];
    if (c.rotation)
        orientations.push([height, width]);
    const footprints = [];
    let fitted = null;
    // 装不下时，回报「差得最近」的那次尝试，让调用方看得到超出多少，而不是只给一个布尔。
    let closest = null;
    let closestBinding = "";
    for (let i = 0; i < orientations.length; i++) {
        const fw = Math.max(orientations[i][0] + 2 * padding, c.minWidth);
        const fh = Math.max(orientations[i][1] + 2 * padding, c.minHeight);
        footprints.push([fw, fh]);
        if (!footprintExceeds(fw, fh, c)) {
            if (!fitted)
                fitted = [fw, fh];
            continue;
        }
        const binding = c.square ? "squareSide" : (fw > c.maxWidth ? "maxWidth" : "maxHeight");
        if (!closest || fw + fh < closest[0] + closest[1]) {
            closest = [fw, fh];
            closestBinding = binding;
        }
    }
    return {
        fits: fitted !== null,
        binding: fitted !== null ? "" : closestBinding,
        requiredWidth: fitted ? fitted[0] : (closest ? closest[0] : 0),
        requiredHeight: fitted ? fitted[1] : (closest ? closest[1] : 0),
        footprints: footprints
    };
}
function footprintExceeds(fw, fh, c) {
    if (c.square)
        return Math.max(fw, fh) > c.maxWidth || Math.max(fw, fh) > c.maxHeight;
    return fw > c.maxWidth || fh > c.maxHeight;
}
// 真机实测（Editor 6.1.4）：FPackageItem.folderAtlas **不经过 package.xml 往返**——
// 导入时写进 <image atlas="alone"/>，磁盘也保留，但重启后内存里的 folderAtlas 回到
// 空串（编辑器自己的幂等守卫 applyLargeImageAtlasRule 因此每次都重新施加）。
// 所以「这张图当前是不是被标成 alone」必须以磁盘为准，只报内存值会说谎。
// 读失败不抛错：只读分析不该因为 package.xml 不可读就整体失败，退化成空映射并回报。
function packageXmlPath(pkg) {
    return IOPath.Combine(String(pkg.basePath || ""), "package.xml");
}
function parsePackageXmlAtlasData(xmlText) {
    const XmlType = CS.FairyGUI.Utils.XML;
    const xml = new XmlType(String(xmlText));
    const resources = xml.GetNode("resources");
    const byId = {};
    const counts = {};
    const imageIds = [];
    if (resources) {
        for (let i = 0; i < resources.elements.Count; i++) {
            const node = resources.elements.get_Item(i);
            const id = String(node.GetAttribute("id") || "");
            const atlas = String(node.GetAttribute("atlas") || "");
            if (String(node.name) === "image" && id)
                imageIds.push(id);
            if (id && atlas) {
                byId[id] = atlas;
                counts[id] = (counts[id] || 0) + 1;
            }
        }
    }
    return {
        byId,
        imageIds,
        duplicateIds: Object.keys(counts).filter(id => counts[id] > 1)
    };
}
function persistedAtlasByItemId(pkg) {
    try {
        const file = packageXmlPath(pkg);
        if (!IOFile.Exists(file))
            return {};
        return parsePackageXmlAtlasData(String(IOFile.ReadAllText(file))).byId;
    }
    catch (error) {
        return {};
    }
}
// 写路径必须区分「读不到」和「没有标记」。上面那个只读版本会把异常吞成空映射，
// 用它判断候选会让一次 IO 失败看起来像「包里没有 alone 标记」。
function readPackageXmlTextStrict(pkg) {
    const file = packageXmlPath(pkg);
    if (!IOFile.Exists(file))
        throw new Error(`package.xml 不存在：${file}`);
    const text = String(IOFile.ReadAllText(file));
    if (!text)
        throw new Error(`package.xml 为空：${file}`);
    return text;
}
function persistedAtlasByItemIdStrict(pkg) {
    return parsePackageXmlAtlasData(readPackageXmlTextStrict(pkg)).byId;
}
// 图集归属判定的唯一入口：这张图要不要单独成图集（alone）。
//
// 0.8.14 起用打包器真实约束判定，取代 0.8.13 之前的硬编码尺寸常量。三条不可退让的前提：
// 1. 归属一律以**磁盘 package.xml** 为准。真机实测 FPackageItem.folderAtlas 写盘保留、
//    重启后内存不读回，拿内存值判幂等会让同一条规则每次 publish 都重新施加。
// 2. ignoreAloneMarker=true 时**主动忽略 alone 标记**去解析约束。alone 是本规则
//    自己管理的标记、不是用户配置的图集名，用它去匹配 atlasList 只会得到
//    「图集未配置」→ unknown，于是被标过的图永远判不出来，也就永远无法纠正。
// 3. 约束缺失/上限未指定时返回 verdict=unknown，**不下结论也不写盘**。
//    「猜它装得下」和「确认它装得下」不能混同，这跟 analyze_atlas_fit 的口径一致。
//
// verdict 取值：
//   assign-alone     装不下，需要单独成图集（本函数之外的 applyAtlasAssignmentRule 会写盘）
//   already-alone    装不下且磁盘上已经是 alone，幂等，不重复写
//   alone-not-needed 装得下但磁盘上已标 alone——本步只上报不改，纠正留给显式动作
//   leave-as-is      装得下且没有标记，或该资源不参与图集
//   unknown          判不出来（无尺寸/无约束/上限未指定/图集未配置），拒绝下结论
function decideAtlasAssignment(pkg, settings, item, persistedAtlas, ignoreAloneMarker) {
    const aloneOnDisk = String((persistedAtlas && persistedAtlas[String(item.id)]) || "");
    const itemWidth = Number(item && item.width) || 0;
    const itemHeight = Number(item && item.height) || 0;
    const decision = {
        verdict: "unknown",
        applied: false,
        // shouldBeAlone = 「按真实约束，这张图就该单独成图集」。
        // 它与 verdict 分开：verdict=already-alone 时本次没写盘，但结论仍是「该 alone」。
        // 把两者合成一个字段，已正确标记的图会被误报成与判定不一致。
        shouldBeAlone: false,
        reason: "",
        fit: "unknown",
        binding: "",
        constraintsSource: "unknown",
        atlas: "",
        width: itemWidth,
        height: itemHeight,
        folderAtlasInMemory: String((item && item.folderAtlas) || ""),
        folderAtlasOnDisk: aloneOnDisk,
        // 退役常量的预测，只作对照：它解释「磁盘上这个标记当初是怎么来的」，
        // 不参与 verdict 的任何一步。
        retiredRuleWouldAssignAlone: retiredLargeImageRuleWouldAssign(itemWidth, itemHeight)
    };
    if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE) {
        decision.verdict = "leave-as-is";
        decision.reason = "not-an-image";
        return decision;
    }
    if (item.supportAtlas === false) {
        decision.verdict = "leave-as-is";
        decision.reason = "not-atlasable";
        return decision;
    }
    if (!decision.width || !decision.height) {
        decision.reason = "no-dimensions";
        return decision;
    }
    if (!settings) {
        decision.reason = "no-publish-settings";
        return decision;
    }
    const constraints = resolveAtlasConstraints(pkg, settings);
    const matchKey = (ignoreAloneMarker && aloneOnDisk === ALONE_ATLAS) ? "" : aloneOnDisk;
    const matched = matchAtlasConstraints(constraints, item, matchKey);
    if (!matched) {
        decision.reason = (constraints && constraints.length > 0) ? "atlas-not-configured" : "no-constraints";
        return decision;
    }
    decision.constraintsSource = matched.source;
    decision.atlas = matched.atlas;
    if (!constraintsUsable(matched)) {
        decision.reason = "limits-unspecified";
        return decision;
    }
    const verdict = judgeAtlasFit(decision.width, decision.height, matched);
    decision.fit = verdict.fits ? "fits" : "exceeds";
    decision.binding = verdict.binding;
    decision.requiredWidth = verdict.requiredWidth;
    decision.requiredHeight = verdict.requiredHeight;
    decision.limitWidth = matched.maxWidth;
    decision.limitHeight = matched.maxHeight;
    decision.padding = matched.padding;
    decision.square = matched.square;
    decision.rotation = matched.rotation;
    if (!verdict.fits) {
        decision.verdict = aloneOnDisk === ALONE_ATLAS ? "already-alone" : "assign-alone";
        decision.reason = aloneOnDisk === ALONE_ATLAS ? "exceeds-and-already-alone" : "exceeds-pack-limits";
        decision.shouldBeAlone = true;
    }
    else {
        decision.verdict = aloneOnDisk === ALONE_ATLAS ? "alone-not-needed" : "leave-as-is";
        decision.reason = aloneOnDisk === ALONE_ATLAS ? "alone-but-fits" : "fits";
    }
    return decision;
}
// 唯一会写 folderAtlas 的地方：只有 assign-alone 才写。
// 幂等守卫用磁盘值（见 decideAtlasAssignment 前提 1），所以重启后不会重复施加。
function applyAtlasAssignmentRule(pkg, settings, item, persistedAtlas) {
    const decision = decideAtlasAssignment(pkg, settings, item, persistedAtlas, true);
    if (decision.verdict !== "assign-alone")
        return decision;
    item.folderAtlas = ALONE_ATLAS;
    item.SetChanged();
    decision.applied = true;
    return decision;
}
// 导入路径的单张封装：全局设置与磁盘口径在这里各取一次。
function applyAtlasAssignmentForItem(pkg, item) {
    const settings = App.project.GetSettings("Publish");
    return applyAtlasAssignmentRule(pkg, settings, item, persistedAtlasByItemId(pkg));
}
function describeAtlasAssignment(item, decision) {
    return {
        id: item.id,
        name: item.name,
        width: decision.width,
        height: decision.height,
        verdict: decision.verdict,
        applied: !!decision.applied,
        reason: decision.reason,
        fit: decision.fit,
        binding: decision.binding,
        constraintsSource: decision.constraintsSource,
        requiredWidth: decision.requiredWidth || 0,
        requiredHeight: decision.requiredHeight || 0,
        limitWidth: decision.limitWidth || 0,
        limitHeight: decision.limitHeight || 0,
        padding: decision.padding === undefined ? null : decision.padding,
        square: decision.square === undefined ? null : decision.square,
        rotation: decision.rotation === undefined ? null : decision.rotation,
        folderAtlasOnDisk: decision.folderAtlasOnDisk,
        folderAtlasInMemory: decision.folderAtlasInMemory,
        url: item.GetURL()
    };
}
// analyze_atlas_fit：按打包器真实约束判断每张图能否入图集。纯只读。
// 0.8.14 起，import_image / publish 用的也是同一套约束判定（见
// decideAtlasAssignment），本 Action 与写入路径共用判据，避免「分析说装得下、
// 导入却标 alone」这种两套口径互相打脸。
function analyzeAtlasFit(params) {
    const settings = App.project.GetSettings("Publish");
    if (!settings)
        throw new Error("FairyGUI 工程缺少 Publish 设置");
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
    const packages = [];
    let totalImages = 0;
    let totalFits = 0;
    let totalExceeds = 0;
    let totalUnknown = 0;
    let totalDisagreements = 0;
    let totalAloneButFits = 0;
    let totalWouldAssignAlone = 0;
    let totalRuleUnknown = 0;
    for (let i = 0; i < sourcePackages.length; i++) {
        const pkg = sourcePackages[i];
        const constraints = resolveAtlasConstraints(pkg, settings);
        const persistedAtlas = persistedAtlasByItemId(pkg);
        const images = [];
        let skipped = 0;
        let fits = 0;
        let exceeds = 0;
        let unknown = 0;
        let disagreements = 0;
        let aloneButFits = 0;
        let wouldAssignAlone = 0;
        let ruleUnknown = 0;
        for (let j = 0; j < pkg.items.Count; j++) {
            const item = pkg.items.get_Item(j);
            if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE)
                continue;
            if (item.supportAtlas === false) {
                skipped++;
                continue;
            }
            totalImages++;
            const width = Number(item.width) || 0;
            const height = Number(item.height) || 0;
            // 归属解析用磁盘值：内存 folderAtlas 重启后恒为空（真机实测），
            // 用它会把「已标记 alone」误判成「没指定图集」。
            const memoryAtlas = String(item.folderAtlas || "");
            const folderAtlas = String(persistedAtlas[String(item.id)] || "");
            const matched = matchAtlasConstraints(constraints, item, folderAtlas);
            // 与写入路径（import_image / publish）完全同一套判据，ignoreAloneMarker=true。
            // 这是本 Action 能回答「磁盘上这个 alone 标记该不该留」的唯一口径：
            // 包级约束模式下 atlasList 里根本没有 alone 这一项，按现状解析会得到
            // atlas-not-configured → unknown，被标过的图就永远判不出来。
            const effective = decideAtlasAssignment(pkg, settings, item, persistedAtlas, true);
            const entry = {
                id: item.id,
                name: item.name,
                width: width,
                height: height,
                // 内存值与磁盘值分列，因为它们在 6.1.4 上不一致（见 persistedAtlasByItemId）。
                // 只有一个字段时，读者无从判断该信哪个。
                folderAtlasInMemory: memoryAtlas,
                folderAtlasOnDisk: String(persistedAtlas[String(item.id)] || ""),
                constraintsSource: matched ? matched.source : "unknown",
                atlas: matched ? matched.atlas : ""
            };
            entry.assignedAloneOnDisk = entry.folderAtlasOnDisk === ALONE_ATLAS;
            // 当前规则结论（与 import_image / publish 写盘用的是同一个函数）。
            // 先落定再走下面的 as-is 分支：包级约束模式下 alone 图的 fit 会落到
            // unknown，但「该不该留这个 alone 标记」仍然判得出来，两件事不能互相绑架。
            entry.verdict = effective.verdict;
            entry.effectiveFit = effective.fit;
            entry.effectiveBinding = effective.binding;
            entry.effectiveConstraintsSource = effective.constraintsSource;
            entry.wouldAssignAlone = !!effective.shouldBeAlone;
            entry.aloneNotNeeded = effective.verdict === "alone-not-needed";
            // 分歧 ⟺ 磁盘上的 alone 标记与真实约束判定不一致（两种方向都算）。
            // 判不出来时（verdict=unknown）不计入：那不是「一致」，是没结论。
            entry.disagrees = effective.verdict === "unknown"
                ? false
                : (entry.assignedAloneOnDisk !== entry.wouldAssignAlone);
            if (entry.disagrees)
                disagreements++;
            if (entry.wouldAssignAlone)
                wouldAssignAlone++;
            if (effective.verdict === "unknown")
                ruleUnknown++;
            // 最可执行的一个数：磁盘上已经标成 alone，但按真实约束其实装得下。
            // aloneButFits 改由 effective 判定（包级约束模式下也成立），
            // 退役常量只留 retiredRuleWouldAssignAlone 做对照。
            if (entry.aloneNotNeeded)
                aloneButFits++;
            entry.retiredRuleWouldAssignAlone = effective.retiredRuleWouldAssignAlone;
            if (!width || !height) {
                entry.fit = "unknown";
                entry.reason = "no-dimensions";
                unknown++;
                images.push(entry);
                continue;
            }
            if (!matched) {
                entry.fit = "unknown";
                entry.reason = folderAtlas ? "atlas-not-configured" : "no-constraints";
                unknown++;
                images.push(entry);
                continue;
            }
            if (!constraintsUsable(matched)) {
                entry.fit = "unknown";
                entry.reason = "limits-unspecified";
                unknown++;
                images.push(entry);
                continue;
            }
            const verdict = judgeAtlasFit(width, height, matched);
            entry.fit = verdict.fits ? "fits" : "exceeds";
            entry.requiredWidth = verdict.requiredWidth;
            entry.requiredHeight = verdict.requiredHeight;
            entry.limitWidth = matched.maxWidth;
            entry.limitHeight = matched.maxHeight;
            entry.padding = matched.padding;
            entry.square = matched.square;
            entry.rotation = matched.rotation;
            if (verdict.fits)
                fits++;
            else {
                exceeds++;
                entry.binding = verdict.binding;
            }
            images.push(entry);
        }
        totalFits += fits;
        totalExceeds += exceeds;
        totalUnknown += unknown;
        totalDisagreements += disagreements;
        totalAloneButFits += aloneButFits;
        totalWouldAssignAlone += wouldAssignAlone;
        totalRuleUnknown += ruleUnknown;
        packages.push({
            package: describePackage(pkg),
            useGlobalAtlasSettings: !!(pkg.publishSettings && pkg.publishSettings.useGlobalAtlasSettings !== false),
            constraints: constraints.map(describeAtlasConstraints),
            images: images,
            summary: {
                images: images.length,
                skippedNotAtlasable: skipped,
                fits: fits,
                exceeds: exceeds,
                unknown: unknown,
                disagreements: disagreements,
                assignedAloneButFits: aloneButFits,
                wouldAssignAlone: wouldAssignAlone,
                ruleUnknown: ruleUnknown
            }
        });
    }
    return {
        packages,
        summary: {
            images: totalImages,
            fits: totalFits,
            exceeds: totalExceeds,
            unknown: totalUnknown,
            disagreements: totalDisagreements,
            assignedAloneButFits: totalAloneButFits,
            wouldAssignAlone: totalWouldAssignAlone,
            ruleUnknown: totalRuleUnknown
        },
        folderAtlasRoundTrip: {
            memoryMatchesDisk: false,
            note: "真机实测（Editor 6.1.4）：<image atlas=\"alone\"> 写入 package.xml 且保存时保留，但 FPackageItem.folderAtlas 重启后不读回。因此每张图分列 folderAtlasInMemory 与 folderAtlasOnDisk，图集归属解析、assignedAloneOnDisk 与写入路径的幂等守卫一律以磁盘为准。",
            usedByWritePath: true
        },
        legacyRule: {
            longSideMin: RETIRED_LARGE_IMAGE_LONG_SIDE_MIN,
            shortSideMin: RETIRED_LARGE_IMAGE_SHORT_SIDE_MIN,
            side2kMin: RETIRED_LARGE_IMAGE_2K_SIDE_MIN,
            atlas: ALONE_ATLAS,
            retiredIn: "0.8.14",
            stillAppliedOnPublish: false,
            alsoAppliedOnImport: false,
            appliedAt: [],
            note: "这三个常量 0.8.14 起不再参与任何判定，只保留为诊断对照：per-image 的 retiredRuleWouldAssignAlone 解释「磁盘上这个 alone 标记当初是怎么来的」。替代它的是 decideAtlasAssignment 的打包器真实约束判定，import_image 与 publish 共用同一套判据。历史标记不会被本 Action 清除——本 Action 自身只读。"
        }
    };
}
// clear_atlas_markers：清除磁盘 package.xml 中错误的 atlas="alone" 标记。
//
// 为什么必须带外改文件：6.1.4 的活体探针已经证伪「folderAtlas="" 清除」这条路——
// 已存在资源一旦带了 atlas 属性，对 folderAtlas 赋任何值都不会改变落盘结果。
// 唯一可行且不破坏资源 id / 引用关系的路线，是直接改 package.xml。
//
// 这条路径刻意做窄：
//   * 只处理真实约束判定为 alone-not-needed 的图片，不写任意图集归属；
//   * 默认只预览；execute 才写，写前先保存包、再备份 package.xml；
//   * 包内有打开的文档时拒绝执行，除非显式 closeOpenDocuments=true，且任何未保存文档都直接拒绝；
//   * 写后回读磁盘，再 Dispose + 重开包，防止编辑器内存里的旧 XML 节点在下次保存时把属性写回来。
function stringListParam(value, label) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        verificationError("invalid_argument", `${label} 必须是字符串数组`, { stage: "input", field: label });
    const result = [];
    for (let i = 0; i < value.length; i++) {
        const text = String(value[i] === undefined || value[i] === null ? "" : value[i]).trim();
        if (text)
            result.push(text);
    }
    return result;
}
function openDocumentsForPackage(pkg) {
    const docView = App.docView;
    if (!docView || typeof docView.FindDocument !== "function")
        return { supported: false, documents: [] };
    const documents = [];
    for (let i = 0; i < pkg.items.Count; i++) {
        const item = pkg.items.get_Item(i);
        if (!item || item.type !== FairyEditor.FPackageItemType.COMPONENT)
            continue;
        const url = String(item.GetURL());
        let doc = null;
        try {
            doc = docView.FindDocument(url);
        }
        catch (_) {
            doc = null;
        }
        if (doc)
            documents.push({ url, itemId: String(item.id), itemName: String(item.name), modified: !!doc.isModified });
    }
    return { supported: true, documents };
}
function backupPackageXml(pkg, xmlText, withBom) {
    const folder = IOPath.Combine(String(App.project.basePath || ""), ".agent", "backups");
    IODirectory.CreateDirectory(folder);
    const stamp = nowIso().replace(/[:.]/g, "-");
    const safeName = String(pkg.name || "package").replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = IOPath.Combine(folder, `${safeName}-package-${stamp}.xml`);
    writePackageXmlText(path, xmlText, withBom);
    return path;
}
// package.xml 有没有 UTF-8 BOM 由编辑器/历史决定，不是常量。ReadAllText 会吃掉
// BOM，所以写入前先看原始字节，再决定是否用 \uFEFF 前缀还原。
function readFileHasUtf8Bom(file) {
    const readAllBytes = IOFile.ReadAllBytes;
    if (typeof readAllBytes !== "function")
        return null;
    const raw = readAllBytes(file);
    if (!raw)
        return null;
    const length = Number(raw.Length !== undefined ? raw.Length : raw.length);
    if (!isFinite(length) || length < 3)
        return false;
    const byteAt = (index) => Number(raw.get_Item ? raw.get_Item(index) : raw[index]);
    return byteAt(0) === 0xEF && byteAt(1) === 0xBB && byteAt(2) === 0xBF;
}
function writePackageXmlText(file, text, withBom) {
    // ReadAllText 会吃掉 BOM，而 package.xml 原本有没有 BOM 决定了写回时该不该补。
    // 用字符串前缀而不是编码对象来还原：File.WriteAllText(path, text) 在 Unity 的
    // .NET 上默认就是不写 BOM 的 UTF-8，两条路径都能得到恰好一份 BOM。
    let payload = text;
    if (withBom === true && payload.charCodeAt(0) !== 0xFEFF)
        payload = "\uFEFF" + payload;
    if (withBom === false && payload.charCodeAt(0) === 0xFEFF)
        payload = payload.slice(1);
    try {
        const Encoding = CS.System && CS.System.Text ? CS.System.Text.UTF8Encoding : null;
        if (Encoding) {
            IOFile.WriteAllText(file, payload, new Encoding(false));
            return;
        }
    }
    catch (_) { /* 退回到不指定编码 */ }
    IOFile.WriteAllText(file, payload);
}
// 只删除目标 <image> 节点上的 atlas 属性，其余字节原样保留。
// 不走 XML 反序列化再序列化：那会重排属性、缩进和注释，把一次两点修复变成整文件 diff。
function removeAtlasAttributesFromXml(xmlText, targets) {
    const removedIds = [];
    const seen = {};
    const branchConflicts = [];
    const mismatched = [];
    const tagCounts = {};
    const text = xmlText.replace(/<image\b[^>]*>/g, (tag) => {
        const idMatch = /\bid\s*=\s*"([^"]*)"/.exec(tag);
        if (!idMatch)
            return tag;
        const id = idMatch[1];
        if (targets[id] === undefined)
            return tag;
        tagCounts[id] = (tagCounts[id] || 0) + 1;
        const branch = /\bbranch\s*=\s*"([^"]*)"/.exec(tag);
        if (branch && branch[1]) {
            branchConflicts.push(id);
            return tag;
        }
        const atlas = /\batlas\s*=\s*"([^"]*)"/.exec(tag);
        if (!atlas || atlas[1] !== targets[id]) {
            mismatched.push({ id, expected: targets[id], actual: atlas ? atlas[1] : null });
            return tag;
        }
        seen[id] = true;
        const cleaned = tag.replace(/\s+atlas\s*=\s*"[^"]*"/, "");
        if (cleaned === tag) {
            mismatched.push({ id, expected: targets[id], actual: atlas[1] });
            return tag;
        }
        removedIds.push(id);
        return cleaned;
    });
    return {
        text,
        removedIds,
        missingIds: Object.keys(targets).filter(id => !seen[id]),
        branchConflicts,
        mismatched,
        duplicateTags: Object.keys(tagCounts).filter(id => tagCounts[id] > 1)
    };
}
function describeAtlasClearCandidate(item, decision) {
    return {
        id: String(item.id),
        name: String(item.name),
        width: decision.width,
        height: decision.height,
        folderAtlasOnDisk: decision.folderAtlasOnDisk,
        constraintsSource: decision.constraintsSource,
        atlas: decision.atlas,
        fit: decision.fit,
        binding: decision.binding,
        requiredWidth: decision.requiredWidth || 0,
        requiredHeight: decision.requiredHeight || 0,
        limitWidth: decision.limitWidth || 0,
        limitHeight: decision.limitHeight || 0,
        url: item.GetURL()
    };
}
function clearAtlasMarkers(params) {
    const pkg = resolvePackage(params);
    const settings = App.project.GetSettings("Publish");
    if (!settings)
        verificationError("invalid_argument", "FairyGUI 工程缺少 Publish 设置，无法判定图集约束", { stage: "input", packageName: String(pkg.name) });
    const execute = params && params.execute === true;
    const closeOpenDocuments = params && params.closeOpenDocuments === true;
    const requestedIds = stringListParam(params ? params.itemIds : null, "itemIds");
    const requestedNames = stringListParam(params ? params.itemNames : null, "itemNames");
    const filterActive = requestedIds.length > 0 || requestedNames.length > 0;
    let parsed = null;
    try {
        parsed = parsePackageXmlAtlasData(readPackageXmlTextStrict(pkg));
    }
    catch (error) {
        verificationError("persistence_failed", "无法读取 package.xml，拒绝在状态不明时纠正标记", { stage: "disk", packageName: String(pkg.name), reason: String(error) });
    }
    if (parsed.duplicateIds.length)
        verificationError("persistence_failed", "package.xml 中存在重复资源 id，定向删除无法保证只改目标节点", { stage: "disk", packageName: String(pkg.name), duplicateIds: parsed.duplicateIds });
    const persisted = parsed.byId;
    const candidates = [];
    const held = [];
    const resolvedIds = {};
    const resolvedNames = {};
    const nameMatches = {};
    let scannedImages = 0;
    let markedAloneOnDisk = 0;
    for (let i = 0; i < pkg.items.Count; i++) {
        const item = pkg.items.get_Item(i);
        if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE)
            continue;
        scannedImages++;
        const id = String(item.id);
        const itemName = String(item.name);
        const diskAtlas = String(persisted[id] || "");
        if (diskAtlas === ALONE_ATLAS)
            markedAloneOnDisk++;
        let idMatch = false;
        for (let j = 0; j < requestedIds.length; j++) {
            if (requestedIds[j] === id) {
                idMatch = true;
                resolvedIds[requestedIds[j]] = true;
            }
        }
        let nameMatch = false;
        const itemNameKey = packageItemNameKey(itemName);
        for (let j = 0; j < requestedNames.length; j++) {
            const requested = requestedNames[j];
            const requestedKey = packageItemNameKey(requested);
            if (requested === itemName || (requestedKey !== "" && requestedKey === itemNameKey)) {
                nameMatch = true;
                resolvedNames[requested] = true;
                if (!nameMatches[requested])
                    nameMatches[requested] = [];
                if (nameMatches[requested].indexOf(id) < 0)
                    nameMatches[requested].push(id);
            }
        }
        if (filterActive && !idMatch && !nameMatch)
            continue;
        if (item.supportAtlas === false) {
            held.push({ id, name: itemName, reason: "not-atlasable", folderAtlasOnDisk: diskAtlas });
            continue;
        }
        if (String(item.branch || "")) {
            held.push({ id, name: itemName, reason: "branch-scope-unsupported", folderAtlasOnDisk: diskAtlas });
            continue;
        }
        if (diskAtlas !== ALONE_ATLAS) {
            held.push({ id, name: itemName, reason: diskAtlas ? "different-atlas" : "not-marked-alone", folderAtlasOnDisk: diskAtlas });
            continue;
        }
        const decision = decideAtlasAssignment(pkg, settings, item, persisted, true);
        if (decision.verdict !== "alone-not-needed") {
            held.push({
                id, name: itemName, reason: decision.verdict, folderAtlasOnDisk: diskAtlas,
                fit: decision.fit, binding: decision.binding, constraintsSource: decision.constraintsSource
            });
            continue;
        }
        candidates.push(describeAtlasClearCandidate(item, decision));
    }
    const missingIds = requestedIds.filter(id => !resolvedIds[id]);
    const missingNames = requestedNames.filter(name => !resolvedNames[name]);
    if (missingIds.length || missingNames.length)
        verificationError("target_not_found", "指定的资源不在该包中（或不是图片资源）", { stage: "input", packageName: String(pkg.name), missingIds, missingNames });
    const ambiguousNames = requestedNames.filter(name => (nameMatches[name] || []).length > 1);
    if (ambiguousNames.length) {
        const details = { stage: "input", packageName: String(pkg.name), ambiguousNames };
        details.matches = {};
        for (let i = 0; i < ambiguousNames.length; i++)
            details.matches[ambiguousNames[i]] = nameMatches[ambiguousNames[i]];
        verificationError("invalid_argument", "按名称过滤时匹配到多个图片资源，改写目标不唯一", details);
    }
    const result = {
        mode: execute ? "execute" : "preview",
        package: describePackage(pkg),
        packageXml: packageXmlPath(pkg),
        candidates,
        held,
        summary: {
            scannedImages,
            markedAloneOnDisk,
            candidates: candidates.length,
            held: held.length,
            wouldClear: candidates.length,
            remainingAloneAfterPreview: markedAloneOnDisk - candidates.length
        },
        executeWillSavePackage: true,
        note: "只清除磁盘上 atlas=\"alone\"、且按真实 PackSettings 判定装得下的图片标记。带外修改绕过编辑器对象模型：不可撤销、不进 Agent 撤销栈；执行前会保存当前包并备份 package.xml。"
    };
    if (!execute) {
        result.writePath = null;
        result.undoable = false;
        result.strength = NONE_STRENGTH;
        return result;
    }
    if (candidates.length === 0) {
        result.changed = [];
        result.writePath = null;
        result.undoable = false;
        result.strength = NONE_STRENGTH;
        result.verification = { diskReadBack: false, targetsCleared: 0, remainingAloneInPackage: markedAloneOnDisk };
        return result;
    }
    const open = openDocumentsForPackage(pkg);
    if (!open.supported)
        verificationError("invalid_argument", "编辑器未暴露 docView.FindDocument，无法确认包内没有打开文档；拒绝执行带外修改", { stage: "precheck", packageName: String(pkg.name) });
    const modified = open.documents.filter((doc) => doc.modified);
    if (modified.length)
        verificationError("invalid_argument", "包内有未保存的文档，带外修改会丢失这些改动；请先保存或放弃后再执行", { stage: "precheck", packageName: String(pkg.name), openDocuments: open.documents, modifiedDocuments: modified });
    if (open.documents.length && !closeOpenDocuments)
        verificationError("invalid_argument", "包内有打开的文档。带外修改后需要重开包，请先关闭这些文档，或显式传 closeOpenDocuments=true 让本 Action 关闭（不会丢弃未保存改动）", { stage: "precheck", packageName: String(pkg.name), openDocuments: open.documents });
    // 先保存包：既避免 Dispose 丢掉包级内存改动，也保证后面的备份就是执行前状态。
    try {
        pkg.Save();
    }
    catch (error) {
        verificationError("persistence_failed", "执行前保存包失败，未修改 package.xml", { stage: "save", packageName: String(pkg.name), reason: String(error) });
    }
    let closedDocuments = [];
    if (open.documents.length) {
        try {
            App.docView.CloseDocuments(pkg);
        }
        catch (error) {
            verificationError("persistence_failed", "关闭包内文档失败，未修改 package.xml", { stage: "precheck", packageName: String(pkg.name), openDocuments: open.documents, reason: String(error) });
        }
        const afterClose = openDocumentsForPackage(pkg);
        if (!afterClose.supported || afterClose.documents.length)
            verificationError("persistence_failed", "关闭包内文档后仍有文档处于打开状态，未修改 package.xml", { stage: "precheck", packageName: String(pkg.name), remaining: afterClose.documents });
        closedDocuments = open.documents;
    }
    // 保存会重写 package.xml，必须重新读一遍再构造 targets。
    let currentText = "";
    let currentAtlas = {};
    try {
        currentText = readPackageXmlTextStrict(pkg);
        currentAtlas = parsePackageXmlAtlasData(currentText).byId;
    }
    catch (error) {
        verificationError("persistence_failed", "保存后重新读取 package.xml 失败，未修改标记", { stage: "disk", packageName: String(pkg.name), reason: String(error) });
    }
    const targets = {};
    for (let i = 0; i < candidates.length; i++) {
        const id = String(candidates[i].id);
        if (currentAtlas[id] !== ALONE_ATLAS)
            verificationError("invalid_argument", `保存后磁盘上的标记已变化（${candidates[i].name}），请重新分析后再执行`, { stage: "precheck", id, expected: ALONE_ATLAS, actual: currentAtlas[id] === undefined ? null : currentAtlas[id] });
        targets[id] = ALONE_ATLAS;
    }
    let bomBefore = null;
    try {
        bomBefore = readFileHasUtf8Bom(packageXmlPath(pkg));
    }
    catch (error) {
        verificationError("persistence_failed", "读取 package.xml 编码状态失败，未修改标记", { stage: "precheck", packageName: String(pkg.name), reason: String(error) });
    }
    let backupPath = "";
    try {
        backupPath = backupPackageXml(pkg, currentText, bomBefore);
    }
    catch (error) {
        verificationError("persistence_failed", "备份 package.xml 失败，未修改标记", { stage: "backup", packageName: String(pkg.name), reason: String(error) });
    }
    const removal = removeAtlasAttributesFromXml(currentText, targets);
    if (removal.duplicateTags.length || removal.missingIds.length || removal.branchConflicts.length || removal.mismatched.length || removal.removedIds.length !== candidates.length) {
        verificationError("persistence_failed", "XML 定向删除预检失败，package.xml 未被修改", {
            stage: "precheck", packageName: String(pkg.name), backupPath,
            missingIds: removal.missingIds, duplicateTags: removal.duplicateTags,
            branchConflicts: removal.branchConflicts, mismatched: removal.mismatched, removed: removal.removedIds
        });
    }
    try {
        writePackageXmlText(packageXmlPath(pkg), removal.text, bomBefore);
    }
    catch (error) {
        verificationError("persistence_failed", "写入 package.xml 失败，磁盘可能处于未完成状态", { stage: "write", packageName: String(pkg.name), backupPath, mutationMayHaveOccurred: true, reason: String(error) });
    }
    let afterText = "";
    let afterAtlas = {};
    let bomAfter = null;
    try {
        afterText = String(IOFile.ReadAllText(packageXmlPath(pkg)));
        afterAtlas = parsePackageXmlAtlasData(afterText).byId;
        bomAfter = readFileHasUtf8Bom(packageXmlPath(pkg));
    }
    catch (error) {
        verificationError("persistence_failed", "写入后回读 package.xml 失败", { stage: "disk", packageName: String(pkg.name), backupPath, mutationMayHaveOccurred: true, reason: String(error) });
    }
    if (afterText !== removal.text)
        verificationError("persistence_failed", "写入后回读内容与预期不一致", { stage: "disk", packageName: String(pkg.name), backupPath, mutationMayHaveOccurred: true });
    if (bomBefore !== null && bomAfter !== null && bomBefore !== bomAfter)
        verificationError("persistence_failed", "写入后 BOM 状态与原文件不一致", { stage: "disk", packageName: String(pkg.name), backupPath, mutationMayHaveOccurred: true, bomBefore, bomAfter });
    const remainingTargets = candidates
        .filter((candidate) => String(afterAtlas[String(candidate.id)] || "") === ALONE_ATLAS)
        .map((candidate) => String(candidate.id));
    if (remainingTargets.length)
        verificationError("persistence_failed", "写入后回读仍有目标标记", { stage: "disk", packageName: String(pkg.name), backupPath, mutationMayHaveOccurred: true, remainingTargets });
    // 包对象里仍保留旧 XML 节点，下次保存可能把删掉的属性写回来；必须同进程重开。
    const packageId = String(pkg.id);
    const packageName = String(pkg.name);
    let reloadedPkg = null;
    try {
        pkg.Dispose();
        reloadedPkg = App.project.GetPackage(packageId);
        if (!reloadedPkg)
            throw new Error("工程内找不到该包");
        reloadedPkg.EnsureOpen();
    }
    catch (error) {
        verificationError("persistence_failed", "package.xml 已修改，但包重开失败；请重启编辑器后复查", { stage: "reload", packageName, packageId, backupPath, mutationMayHaveOccurred: true, reason: String(error) });
    }
    let finalAlone = [];
    try {
        const finalAtlas = parsePackageXmlAtlasData(readPackageXmlTextStrict(reloadedPkg)).byId;
        const ids = Object.keys(finalAtlas);
        for (let i = 0; i < ids.length; i++) {
            if (finalAtlas[ids[i]] === ALONE_ATLAS)
                finalAlone.push(ids[i]);
        }
    }
    catch (error) {
        verificationError("persistence_failed", "重开后回读 package.xml 失败", { stage: "reload", packageName, backupPath, mutationMayHaveOccurred: true, reason: String(error) });
    }
    lastWritePath = WRITE_PATH_OUT_OF_BAND;
    result.changed = candidates;
    result.backupPath = backupPath;
    result.closedDocuments = closedDocuments;
    result.reloaded = true;
    result.reloadStrategy = "package-dispose-open";
    result.savedPackageBeforeEdit = true;
    result.writePath = WRITE_PATH_OUT_OF_BAND;
    result.undoable = false;
    result.strength = DISK_STRENGTH;
    result.verification = {
        diskReadBack: true,
        targetsCleared: candidates.length,
        remainingAloneInPackage: finalAlone,
        contentOutsideTargetsUnchanged: true,
        bomPreserved: bomBefore === null || bomAfter === null ? null : bomBefore === bomAfter,
        reloadedPackageId: packageId,
        checkedAt: nowIso()
    };
    result.persistence = {
        crossRestartVerified: false,
        note: "本 Action 证明磁盘回读与同进程包重开；跨编辑器重启由独立真机报告验证。"
    };
    result.summary.remainingAloneAfterExecute = finalAlone.length;
    return result;
}
function matchAtlasConstraints(constraints, item, folderAtlas) {
    if (!constraints || constraints.length === 0)
        return null;
    // 全局设置只有一条约束，与资源挂在哪张图集无关。
    if (constraints.length === 1 && constraints[0].source === "global")
        return constraints[0];
    if (folderAtlas) {
        for (let i = 0; i < constraints.length; i++) {
            if (constraints[i].atlas === folderAtlas)
                return constraints[i];
        }
        // 资源已经指到一张没配置的图集（如 alone 这类编辑器内建图集名），
        // 不猜它用哪套约束。
        return null;
    }
    let index = -1;
    try {
        index = Number(item.GetAtlasIndex());
    }
    catch (e) {
        index = -1;
    }
    if (index >= 0 && index < constraints.length)
        return constraints[index];
    return constraints.length === 1 ? constraints[0] : null;
}
function describeAtlasConstraints(c) {
    return {
        source: c.source,
        atlas: c.atlas,
        sizeOption: c.sizeOption,
        maxWidth: c.maxWidth,
        maxHeight: c.maxHeight,
        minWidth: c.minWidth,
        minHeight: c.minHeight,
        padding: c.padding,
        square: c.square,
        rotation: c.rotation,
        pot: c.pot,
        mof: c.mof,
        multiPage: c.multiPage
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
// publish 前的全包归属施加。与导入路径共用 decideAtlasAssignment，
// 幂等守卫同样以磁盘 package.xml 为准，所以跨重启后不会重复 SetChanged。
// aloneNotNeeded 与 unknown **只上报不改**：前者需要显式纠正动作（清除标记的
// 落盘语义尚未真机验证），后者是判不出来——两者都不该被静默当成「已处理」。
function enforceAtlasAssignmentRule(pkg, settings) {
    const persistedAtlas = persistedAtlasByItemId(pkg);
    const assigned = [];
    const aloneNotNeeded = [];
    const unknown = [];
    let skipped = 0;
    forEachPackageItem(pkg.items, (item) => {
        if (!item || item.type !== FairyEditor.FPackageItemType.IMAGE)
            return;
        const decision = applyAtlasAssignmentRule(pkg, settings, item, persistedAtlas);
        if (decision.verdict === "assign-alone")
            assigned.push(describeAtlasAssignment(item, decision));
        else if (decision.verdict === "alone-not-needed")
            aloneNotNeeded.push(describeAtlasAssignment(item, decision));
        else if (decision.verdict === "unknown")
            unknown.push(describeAtlasAssignment(item, decision));
        else if (decision.reason === "not-atlasable")
            skipped++;
    });
    if (assigned.length > 0)
        pkg.SetChanged();
    return {
        assigned: assigned,
        aloneNotNeeded: aloneNotNeeded,
        unknown: unknown,
        skippedNotAtlasable: skipped
    };
}
async function publishPackages(params) {
    if (publishInProgress)
        throw new Error("已有 FairyGUI 发布任务正在执行");
    const packages = resolvePublishPackages(params);
    const branch = params.branch === undefined ? String(App.project.activeBranch || "") : String(params.branch || "");
    const saveBeforePublish = params.saveBeforePublish !== false;
    const publishDescOnly = params.publishDescOnly === true;
    validatePublishBranch(branch);
    const publishSettings = App.project.GetSettings("Publish");
    const atlasAssignment = {
        rule: "packer-constraints",
        aloneAtlas: ALONE_ATLAS,
        folderAtlasSource: "package.xml",
        assigned: [],
        aloneNotNeeded: [],
        unknown: [],
        skippedNotAtlasable: 0
    };
    for (let i = 0; i < packages.length; i++) {
        const result = enforceAtlasAssignmentRule(packages[i], publishSettings);
        for (let j = 0; j < result.assigned.length; j++)
            atlasAssignment.assigned.push({ package: packages[i].name, ...result.assigned[j] });
        for (let j = 0; j < result.aloneNotNeeded.length; j++)
            atlasAssignment.aloneNotNeeded.push({ package: packages[i].name, ...result.aloneNotNeeded[j] });
        for (let j = 0; j < result.unknown.length; j++)
            atlasAssignment.unknown.push({ package: packages[i].name, ...result.unknown[j] });
        atlasAssignment.skippedNotAtlasable += result.skippedNotAtlasable;
    }
    if (atlasAssignment.assigned.length > 0)
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
            atlasAssignment: {
                ...atlasAssignment,
                // 计数显式给出：aloneNotNeeded / unknown 是「看了但没动手」，
                // 让消费方去数组长度里数等于把判定责任推给读报告的人。
                assignedCount: atlasAssignment.assigned.length,
                aloneNotNeededCount: atlasAssignment.aloneNotNeeded.length,
                unknownCount: atlasAssignment.unknown.length,
                note: "按打包器真实约束判定（decideAtlasAssignment），不再用硬编码尺寸常量。aloneNotNeeded 表示磁盘上已有 alone 标记但按真实约束装得下，本次只上报不纠正；unknown 表示约束不足以判定（无尺寸/无约束/上限未指定/图集未配置），不写盘。"
            },
            fileChanges: diffSnapshots(before, after)
        };
    }
    finally {
        publishInProgress = false;
        writeStatus();
    }
}
// --- Phase 8 / P8-7：只读资源审计（0.8.19） --------------------------------
//
// 编辑器自带的 FindUnusedResource / FindDuplicateResource / FullSearch 都是
// Pro 功能：Start() 先走 CheckProLicense，非 Pro 环境会弹授权框并让请求永久
// 挂起（真机 6.1.4 实测，见 tests/reports/p8-7-audit-live.json）。因此这里
// 不复用它们，改为组合非 Pro 可用的 DependencyQuery 与
// BuilderUtil.GetMD5HashFromFile 实现同等语义。
const AUDIT_DEFAULT_MAX_ITEMS = 500;
const AUDIT_MAX_ITEMS_CEILING = 5000;
const AUDIT_DEFAULT_MAX_GROUPS = 100;
const AUDIT_MAX_GROUPS_CEILING = 1000;
const AUDIT_DEFAULT_MAX_ITEMS_PER_GROUP = 50;
const AUDIT_MAX_ITEMS_PER_GROUP_CEILING = 500;
const AUDIT_ERROR_SAMPLES = 20;
function auditLimit(value, name, defaultValue, ceiling) {
    if (value === undefined || value === null)
        return defaultValue;
    const limit = Number(value);
    if (!isFinite(limit) || limit < 1 || limit > ceiling)
        verificationError("invalid_argument", `${name} 必须是 1..${ceiling} 的数字`, { stage: "input", [name]: value });
    return Math.floor(limit);
}
function auditStringList(value) {
    if (value === undefined || value === null)
        return [];
    const raw = Array.isArray(value) ? value : String(value).split(",");
    const result = [];
    for (let i = 0; i < raw.length; i++) {
        const text = String(raw[i] === undefined || raw[i] === null ? "" : raw[i]).trim();
        if (text)
            result.push(text);
    }
    return result;
}
function resolveAuditPackages(params) {
    const requested = [];
    if (params.packageId)
        requested.push(String(params.packageId));
    if (params.packageName)
        requested.push(String(params.packageName));
    for (const name of auditStringList(params.packages)) {
        if (requested.indexOf(name) < 0)
            requested.push(name);
    }
    if (!requested.length) {
        const packages = [];
        const all = App.project.allPackages;
        for (let i = 0; i < all.Count; i++)
            packages.push(all.get_Item(i));
        return { packages, scope: "project" };
    }
    const packages = [];
    const seen = {};
    for (const nameOrId of requested) {
        const pkg = App.project.GetPackageByName(nameOrId) || App.project.GetPackage(nameOrId);
        if (!pkg)
            verificationError("target_not_found", `未找到包：${nameOrId}`, { stage: "input", package: nameOrId });
        if (seen[pkg.id])
            continue;
        seen[pkg.id] = true;
        packages.push(pkg);
    }
    return { packages, scope: "selected" };
}
function collectAuditItems(packages, params) {
    const types = auditStringList(params.types).map(value => value.toLowerCase());
    const includeBranches = params.includeBranches !== false;
    const items = [];
    const seen = {};
    const branches = includeBranches ? knownBranches(false).names : [];
    let candidateCount = 0;
    const add = (item) => {
        if (!item || item.isBranchRoot || item.type === "folder")
            return;
        // 6.1.4 的 pkg.items 也会列出分支根与分支资源；显式排除分支时不能只靠
        // 「主干列表」这个假设，否则 --no-branches 在真机上什么也没过滤。
        if (!includeBranches && String(item.branch || ""))
            return;
        if (types.length && types.indexOf(String(item.type).toLowerCase()) < 0)
            return;
        let url = "";
        try {
            url = String(item.GetURL());
        }
        catch (_) {
            url = "";
        }
        const key = url || `${item.owner ? item.owner.id : ""}|${String(item.branch || "")}|${item.id}`;
        if (seen[key])
            return;
        seen[key] = true;
        candidateCount++;
        items.push(item);
    };
    for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        pkg.EnsureOpen();
        // pkg.items 只枚举主干；分支资源是独立条目，必须从分支根 GetItemListing 取，
        // 否则 includeBranches 会变成「永远什么也没多扫」的空开关。
        for (let j = 0; j < pkg.items.Count; j++)
            add(pkg.items.get_Item(j));
        for (let j = 0; j < branches.length; j++) {
            const branch = branches[j];
            const root = branchRootItem(pkg, branch);
            if (!root)
                continue;
            const listing = listToArray(pkg.GetItemListing(root, null, false, true, null));
            for (let k = 0; k < listing.length; k++) {
                if (String(listing[k].branch || "") === branch)
                    add(listing[k]);
            }
        }
    }
    return { items, candidateCount, types, includeBranches, branches };
}
function describeAuditItem(item, includeAssetSize) {
    const pkg = item.owner;
    const result = {
        packageId: pkg ? safeValue(pkg.id) : null,
        packageName: pkg ? safeValue(pkg.name) : null,
        item: describeItemSafe(item)
    };
    if (item.file) {
        try {
            result.fileBytes = Number((new IOFileInfo(String(item.file))).Length);
        }
        catch (_) {
            result.fileBytes = null;
        }
        if (includeAssetSize && item.type === "image") {
            try {
                const size = FairyEditor.AssetSizeUtil.GetSize(String(item.file));
                result.assetSize = {
                    width: Number(size.width) || 0,
                    height: Number(size.height) || 0,
                    type: size.type === undefined || size.type === null ? null : String(size.type),
                    bitDepth: Number(size.bitDepth) || 0,
                    colorType: Number(size.colorType) || 0
                };
            }
            catch (_) {
                result.assetSize = null;
            }
        }
    }
    else {
        result.fileBytes = null;
    }
    return result;
}
function auditErrorSample(item, error) {
    return {
        packageName: item && item.owner ? safeValue(item.owner.name) : null,
        itemName: item ? safeValue(item.name) : null,
        itemType: item ? safeValue(item.type) : null,
        url: (() => { try {
            return item ? String(item.GetURL()) : null;
        }
        catch (_) {
            return null;
        } })(),
        message: String(error && error.message ? error.message : error)
    };
}
function findUnused(params) {
    const startedMs = Date.now();
    const scope = resolveAuditPackages(params);
    const openInfo = ensurePackagesOpen(params);
    const collected = collectAuditItems(scope.packages, params);
    const maxItems = auditLimit(params.maxItems, "maxItems", AUDIT_DEFAULT_MAX_ITEMS, AUDIT_MAX_ITEMS_CEILING);
    const skipExported = params.skipExported === true;
    let scannedCount = 0;
    let unusedCount = 0;
    let exportedUnusedCount = 0;
    let exportedSkipped = 0;
    let errorCount = 0;
    const errors = [];
    const items = [];
    for (let i = 0; i < collected.items.length; i++) {
        const item = collected.items[i];
        if (skipExported && item.exported) {
            exportedSkipped++;
            continue;
        }
        let referenceCount = 0;
        try {
            const query = new FairyEditor.DependencyQuery();
            query.QueryReferences(App.project, String(item.GetURL()));
            referenceCount = query.references ? Number(query.references.Count) : 0;
        }
        catch (error) {
            errorCount++;
            if (errors.length < AUDIT_ERROR_SAMPLES)
                errors.push(auditErrorSample(item, error));
            continue;
        }
        scannedCount++;
        if (referenceCount !== 0)
            continue;
        unusedCount++;
        if (item.exported)
            exportedUnusedCount++;
        if (items.length < maxItems)
            items.push(describeAuditItem(item, true));
    }
    return {
        ok: true,
        readOnly: true,
        scope: scope.scope,
        activeBranch: activeBranchName(),
        packages: {
            count: scope.packages.length,
            names: scope.packages.map(pkg => pkg.name),
            opened: openInfo.opened,
            projectPackageCount: openInfo.packageCount
        },
        includeBranches: collected.includeBranches,
        branches: collected.branches,
        candidateCount: collected.candidateCount,
        scannedCount,
        unusedCount,
        exportedUnusedCount,
        exportedSkipped,
        errorCount,
        errors,
        maxItems,
        truncated: unusedCount > items.length,
        durationMs: Date.now() - startedMs,
        items,
        note: "只读分析。未使用 = 当前工程内零引用；导出资源可能被运行时按 URL 使用，删除前请确认。"
    };
}
function findDuplicates(params) {
    const startedMs = Date.now();
    const scope = resolveAuditPackages(params);
    const openInfo = ensurePackagesOpen(params);
    const collected = collectAuditItems(scope.packages, params);
    const maxGroups = auditLimit(params.maxGroups, "maxGroups", AUDIT_DEFAULT_MAX_GROUPS, AUDIT_MAX_GROUPS_CEILING);
    const maxItemsPerGroup = auditLimit(params.maxItemsPerGroup, "maxItemsPerGroup", AUDIT_DEFAULT_MAX_ITEMS_PER_GROUP, AUDIT_MAX_ITEMS_PER_GROUP_CEILING);
    let hashedCount = 0;
    let unreadableCount = 0;
    let errorCount = 0;
    const errors = [];
    const groupsByKey = {};
    for (let i = 0; i < collected.items.length; i++) {
        const item = collected.items[i];
        if (!item.file)
            continue;
        let hash;
        let fileBytes = null;
        try {
            hash = String(FairyEditor.BuilderUtil.GetMD5HashFromFile(String(item.file)));
            try {
                fileBytes = Number((new IOFileInfo(String(item.file))).Length);
            }
            catch (_) {
                fileBytes = null;
            }
        }
        catch (error) {
            unreadableCount++;
            errorCount++;
            if (errors.length < AUDIT_ERROR_SAMPLES)
                errors.push(auditErrorSample(item, error));
            continue;
        }
        hashedCount++;
        const key = `${hash}|${fileBytes === null ? "?" : fileBytes}`;
        let group = groupsByKey[key];
        if (!group) {
            group = { hash, fileBytes, items: [] };
            groupsByKey[key] = group;
        }
        group.items.push(describeAuditItem(item, true));
    }
    const groups = [];
    let duplicateItemCount = 0;
    let wastedBytes = 0;
    for (const key of Object.keys(groupsByKey)) {
        const group = groupsByKey[key];
        if (group.items.length < 2)
            continue;
        duplicateItemCount += group.items.length;
        const wasted = group.fileBytes === null ? 0 : group.fileBytes * (group.items.length - 1);
        wastedBytes += wasted;
        groups.push({
            hash: group.hash,
            fileBytes: group.fileBytes,
            itemCount: group.items.length,
            wastedBytes: wasted,
            truncated: group.items.length > maxItemsPerGroup,
            items: group.items.slice(0, maxItemsPerGroup)
        });
    }
    groups.sort((left, right) => right.wastedBytes - left.wastedBytes || right.itemCount - left.itemCount);
    return {
        ok: true,
        readOnly: true,
        scope: scope.scope,
        activeBranch: activeBranchName(),
        packages: {
            count: scope.packages.length,
            names: scope.packages.map(pkg => pkg.name),
            opened: openInfo.opened,
            projectPackageCount: openInfo.packageCount
        },
        includeBranches: collected.includeBranches,
        branches: collected.branches,
        candidateCount: collected.candidateCount,
        hashedCount,
        unreadableCount,
        errorCount,
        errors,
        duplicateGroupCount: groups.length,
        duplicateItemCount,
        wastedBytes,
        maxGroups,
        maxItemsPerGroup,
        truncated: groups.length > maxGroups,
        durationMs: Date.now() - startedMs,
        groups: groups.slice(0, maxGroups),
        note: "只读分析。按文件内容 MD5 分组，同名不同内容不算重复；组件 XML 也在比较范围内。"
    };
}
const DOCUMENT_WRITE_ACTIONS = {
    set_property: true,
    insert_object: true,
    remove_object: true,
    replace_object_resource: true,
    set_text_style: true,
    set_list_layout: true,
    set_group_layout: true,
    set_relation: true,
    set_gear_display: true,
    set_controller: true,
    save_document: true,
    duplicate_transition: true,
    upsert_transition: true,
    remove_transition: true,
    add_transition_item: true,
    update_transition_item: true,
    remove_transition_item: true,
    add_keyframes: true,
    set_keyframe: true,
    undo: true,
    redo: true
};
// 原生批处理与带外 XML 修改没有分支感知，分支活跃时执行会改到主干。
const TRUNK_ONLY_ACTIONS = {
    replace_references: true,
    clear_atlas_markers: true
};
// 只读操作可以显式读取任意分支，不要求先切换活跃分支；写入仍要求作用域一致，
// 否则 activeBranch 与文档保存不会跟随改道，会把改动落到错误的分支。
const BRANCH_READ_ACTIONS = {
    list_items: true,
    open_document: true,
    get_tree: true
};
function handleCommand(request) {
    // 每条写路径必须自己声明写入层；不声明就是 null（unknown），
    // 不能沿用上一个 action 的值——那会让 writePath 变成谎报。
    beginWrite();
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
        set_publish_settings: true,
        clear_atlas_markers: true,
        add_keyframes: true,
        set_keyframe: true,
        duplicate_transition: true,
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
        // 全工程引用替换立即落盘且不进撤销栈，发布期间执行无法回退
        replace_references: true,
        undo: true,
        redo: true
    };
    if (publishInProgress && actionsBlockedDuringPublish[action])
        throw new Error(`FairyGUI 发布进行中，暂不能执行：${action}`);
    // branch 是通用作用域参数：写入与 publish（它自己的 branch 指发布目标）
    // 要求与活跃分支一致；只读视图允许跨分支读取。
    if (action !== "publish" && action !== "create_branch" && action !== "switch_branch" && !BRANCH_READ_ACTIONS[action])
        assertBranchScope(params, action);
    // 文档保存不会跟随 activeBranch 改道（真机 6.1.4 实测：分支活跃时保存仍写
    // 主干）。所有文档写操作按文档自身分支与请求作用域比对，不一致就拒绝。
    if (DOCUMENT_WRITE_ACTIONS[action])
        assertDocumentBranchScope(params, action);
    if (TRUNK_ONLY_ACTIONS[action] && activeBranchName())
        verificationError("branch_mismatch", `${action} 只作用于主干，当前活跃分支为 ${activeBranchName()}`, {
            stage: "branch", action, activeBranch: activeBranchName(), hint: "先 switch_branch 切回主干（name 为空字符串）"
        });
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
        case "list_branches":
            return listBranches(params);
        case "create_branch":
            return createBranch(params);
        case "switch_branch":
            return switchBranch(params);
        case "list_packages": {
            const packages = [];
            const list = App.project.allPackages;
            for (let i = 0; i < list.Count; i++)
                packages.push(describePackage(list.get_Item(i)));
            return packages;
        }
        case "list_items": {
            const pkg = resolvePackage(params);
            const typeFilter = params.type ? String(params.type) : "";
            // 显式 branch 优先；省略时看活跃分支视图，branch="" 才表示主干。
            const viewBranch = branchRequested(params) ? branchScopeName(params) : activeBranchName();
            if (viewBranch) {
                const branch = viewBranch;
                const root = branchRootItem(pkg, branch);
                if (!root)
                    verificationError("target_not_found", `包 ${pkg.name} 在分支 ${branch} 中没有分支根`, {
                        stage: "branch", branch, package: pkg.name
                    });
                const branchItems = listToArray(pkg.GetItemListing(root, null, false, true, null))
                    .filter(item => String(item.branch || "") === branch && !item.isBranchRoot)
                    .filter(item => !typeFilter || String(item.type) === typeFilter);
                const branchKeys = {};
                for (let i = 0; i < branchItems.length; i++)
                    branchKeys[`${logicalBranchPath(branchItems[i], branch)}|${String(branchItems[i].name)}`] = true;
                const items = [];
                let trunkCount = 0;
                for (let i = 0; i < pkg.items.Count; i++) {
                    const item = pkg.items.get_Item(i);
                    const itemBranch = String(item.branch || "");
                    if (item.isBranchRoot || itemBranch)
                        continue;
                    trunkCount++;
                    if (branchKeys[`${logicalBranchPath(item, branch)}|${String(item.name)}`])
                        continue;
                    if (!typeFilter || String(item.type) === typeFilter)
                        items.push(describeItem(item));
                }
                for (let i = 0; i < branchItems.length; i++)
                    items.push(describeItem(branchItems[i]));
                return {
                    package: describePackage(pkg),
                    activeBranch: activeBranchName(),
                    branch,
                    branchRoot: describeItemSafe(root),
                    trunkItemCount: trunkCount,
                    branchItemCount: branchItems.length,
                    effectiveCount: items.length,
                    items
                };
            }
            const items = [];
            for (let i = 0; i < pkg.items.Count; i++) {
                const item = pkg.items.get_Item(i);
                // 6.1.4 的 pkg.items 会包含分支根与分支资源，主干视图必须把它们滤掉。
                if (item.isBranchRoot || String(item.branch || ""))
                    continue;
                if (!typeFilter || item.type === typeFilter)
                    items.push(describeItem(item));
            }
            return {
                package: describePackage(pkg),
                activeBranch: activeBranchName(),
                branch: null,
                itemCount: items.length,
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
            if (branchRequested(params)) {
                const branch = branchScopeName(params);
                const docBranch = String((doc.packageItem && doc.packageItem.branch) || "");
                if (docBranch !== branch)
                    verificationError("branch_mismatch", `活动文档不属于分支 ${branch}`, {
                        stage: "branch", action: "get_tree", documentBranch: docBranch, requestedBranch: branch,
                        hint: "用 open_document 的 branch 参数打开分支文档，或切回该分支后重试"
                    });
            }
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
        case "verify_transition":
            return verifyTransition(params);
        case "upsert_transition":
            return upsertTransition(params);
        case "remove_transition":
            return removeTransition(params);
        case "add_keyframes":
            return addKeyFrames(params);
        case "set_keyframe":
            return setKeyframe(params);
        case "duplicate_transition":
            return duplicateTransition(params);
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
        case "query_references":
            return queryReferences(params);
        case "query_dependencies":
            return queryDependencies(params);
        case "find_unused":
            return findUnused(params);
        case "find_duplicate":
            return findDuplicates(params);
        case "replace_references":
            return replaceReferences(params);
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
            const expected = { id: obj.id, name: obj.name, type: String(obj.objectType || "").toLowerCase() };
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
            const expected = {
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
        case "insert_text":
            return insertText(params);
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
            let stillPresent = null;
            if (removedId)
                stillPresent = findObjectById(doc.content, removedId);
            else {
                try {
                    stillPresent = resolveObject(doc, params.target);
                }
                catch (error) {
                    stillPresent = null;
                }
            }
            if (stillPresent)
                verificationError("editor_rejected", "删除后目标仍可解析", { stage: "editor", target });
            let saved = false;
            if (params.save) {
                try {
                    doc.Save();
                }
                catch (error) {
                    verificationError("persistence_failed", "保存失败", { stage: "save", target, reason: String(error) });
                }
                saved = doc.isModified === false;
                if (!saved)
                    verificationError("persistence_failed", "保存后文档仍处于修改状态", { stage: "save", target });
            }
            let xmlReadback = false;
            let xmlFile = null;
            if (saved && params.verify !== false) {
                const persisted = persistedNodeExists(doc, removedId);
                xmlFile = persisted.file;
                if (persisted.exists)
                    verificationError("persistence_failed", "保存后磁盘 XML 仍包含目标节点", { stage: "xml", target });
                xmlReadback = true;
            }
            const state = {};
            let reloaded = null;
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
        case "set_publish_settings":
            return setPublishSettings(params);
        case "analyze_atlas_fit":
            return analyzeAtlasFit(params);
        case "clear_atlas_markers":
            return clearAtlasMarkers(params);
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
    const text = message.toLowerCase();
    let code = "editor_rejected";
    // 「未找到指定 FairyGUI 资源/包」来自 resolveItem/resolvePackage，属于调用方
    // 定位失败，必须归到 target_not_found；漏掉会让 agent 拿到 editor_rejected，
    // 分不清是编辑器拒绝执行还是目标根本不存在。
    if (text.indexOf("未找到对象") >= 0 || text.indexOf("未找到资源引用") >= 0 || text.indexOf("未找到指定") >= 0)
        code = "target_not_found";
    else if (text.indexOf("不唯一") >= 0)
        code = "ambiguous_target";
    else if (text.indexOf("不支持") >= 0 || text.indexOf("白名单") >= 0 || text.indexOf("不是文本对象") >= 0)
        code = "unsupported_property";
    else if (text.indexOf("必须") >= 0 || text.indexOf("格式") >= 0)
        code = "invalid_argument";
    const response = {
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
        if (isStaleFile(claimedPath)) {
            completeRequestError(claimedPath, requestId, action, new Error(`请求已过期（超过 ${REQUEST_MAX_AGE_MS / 1000} 秒未被认领，可能来自已中断的客户端）`));
            return;
        }
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
    // 心跳按真实时间写入，编辑器帧率下降时不再被客户端误判为离线。
    if (Date.now() - lastStatusWrittenMs >= STATUS_MIN_INTERVAL_MS)
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
