"""FairyGUI Agent Bridge 的 MCP stdio 服务。"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import __version__
from .animation_models import KeyframeChanges, KeyframeSpec, TransitionDefinition, TransitionItem
from .bridge_client import BridgeClient
from .editor_launcher import EditorLauncher
from .project_locator import ProjectLocator

mcp = FastMCP(
    "FairyGUI Agent Bridge",
    instructions=(
        "先读取工程、包和对象树，再执行修改。文档属性和对象修改默认不保存；"
        "创建组件或按钮会新增包资源，导入/替换图片、声音和 MovieClip 会写入磁盘，调用前必须确认包、目录、名称和冲突策略。"
        "Transition 编辑与已有 MovieClip 更新支持 Agent undo/redo；新建/删除资源不能完整撤销，且资源写入不能由 fgui_discard_document 回滚。"
        "动画预览只改变 Editor 当前状态，不保存资源默认属性。"
        "只有用户明确要求时才调用保存工具。发布前先调用 fgui_get_publish_settings，"
        "并确认用户要求的包范围后再调用 fgui_publish。"
    ),
)
# MCP Python SDK 1.x 的 FastMCP 构造器没有公开 version 参数，需向底层 Server 写入工具版本。
mcp._mcp_server.version = __version__

_locator = ProjectLocator()
_launcher = EditorLauncher()
_client = BridgeClient(_locator, _launcher)


def configure_runtime(
    *,
    project: str | None = None,
    editor: str | None = None,
    timeout: float = 10.0,
) -> None:
    global _locator, _launcher, _client
    _locator = ProjectLocator(project)
    _launcher = EditorLauncher(editor)
    _client = BridgeClient(_locator, _launcher, timeout=timeout)


def _target(
    object_id: str | None,
    object_path: str | None,
    object_name: str | None,
) -> dict[str, str]:
    values = [("id", object_id), ("path", object_path), ("name", object_name)]
    selected = [(key, value.strip()) for key, value in values if value and value.strip()]
    if len(selected) != 1:
        raise ValueError("object_id、object_path、object_name 必须且只能提供一个")
    key, value = selected[0]
    return {key: value}

def _resource_target(
    url: str | None,
    package_name: str | None,
    item_name: str | None,
    item_path: str | None,
) -> dict[str, str]:
    if url and url.strip():
        if package_name or item_name or item_path:
            raise ValueError("url 不能与 package_name/item_name/item_path 同时提供")
        return {"url": url.strip()}
    if not package_name or not package_name.strip():
        raise ValueError("必须提供 url，或 package_name 与 item_name/item_path")
    choices = [("itemName", item_name), ("itemPath", item_path)]
    selected = [(key, value.strip()) for key, value in choices if value and value.strip()]
    if len(selected) != 1:
        raise ValueError("使用 package_name 时，item_name、item_path 必须且只能提供一个")
    key, value = selected[0]
    return {"packageName": package_name.strip(), key: value}


@mcp.tool()
def fgui_status() -> dict[str, Any]:
    """读取本地 FairyGUI 工程选择和桥接心跳，不主动唤醒编辑器。"""
    return _client.describe_status()


@mcp.tool()
def fgui_ping() -> dict[str, Any]:
    """唤醒 FairyGUI Editor 并验证桥接协议、版本和能力。"""
    return _client.call("ping")


@mcp.tool()
def fgui_use_project(project_path: str) -> dict[str, Any]:
    """为当前 MCP 会话选择 .fairy 文件、FairyGUI 工程目录或仓库目录。"""
    return _locator.use_project(project_path).as_dict()


@mcp.tool()
def fgui_get_project() -> dict[str, Any]:
    """读取当前 FairyGUI 工程信息。"""
    return _client.call("get_project")


@mcp.tool()
def fgui_list_packages() -> list[dict[str, Any]]:
    """列出当前 FairyGUI 工程中的全部包。"""
    return _client.call("list_packages")


@mcp.tool()
def fgui_list_branches(
    refresh: bool = False,
    include_packages: bool = False,
    include_items: bool = False,
) -> dict[str, Any]:
    """列出工程分支及活跃分支；可附带每个包的分支根与资源。

    refresh=True 先从磁盘重扫。分支资源目录为 assets_<branch>/<package>，活跃分支不会让编辑器自动改道保存。
    """
    return _client.call(
        "list_branches",
        {"refresh": refresh, "includePackages": include_packages, "includeItems": include_items},
    )


@mcp.tool()
def fgui_create_branch(
    name: str,
    switch_to: bool = False,
    save_open_documents: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """创建分支并为每个包建立分支根；走工程原生 API，立即落盘且不可撤销。

    switch_to=True 创建后切换活跃分支；有未保存文档时需同时 save_open_documents=True。
    """
    params: dict[str, Any] = {
        "name": name,
        "switch": switch_to,
        "saveOpenDocuments": save_open_documents,
        "verify": verify,
    }
    return _client.call("create_branch", params)


@mcp.tool()
def fgui_switch_branch(name: str, save_open_documents: bool = False) -> dict[str, Any]:
    """切换活跃分支；name 传空字符串切回主干。

    只改变编辑器分支上下文。真机 6.1.4 上文档保存与资源创建不会自动改道，Bridge 的写操作按 branch 参数或活跃分支显式寻址。
    """
    return _client.call("switch_branch", {"name": name, "saveOpenDocuments": save_open_documents})


@mcp.tool()
def fgui_list_items(
    package_name: str,
    item_type: str | None = None,
    branch: str | None = None,
) -> list[dict[str, Any]]:
    """列出指定包中的资源，可按 FairyGUI 资源类型过滤。

    省略 branch 时跟随当前活跃分支，branch="" 表示主干。返回的分支视角中，
    分支资源覆盖同名主干资源；只读操作可以读取非活跃分支，不需要先切换。
    """
    params: dict[str, Any] = {"packageName": package_name}
    if item_type:
        params["type"] = item_type
    if branch is not None:
        params["branch"] = branch
    return _client.call("list_items", params)


@mcp.tool()
def fgui_open_document(package_name: str, item_name: str, branch: str | None = None) -> dict[str, Any]:
    """按包名和资源名打开 FairyGUI 组件文档。

    省略 branch 时跟随当前活跃分支，branch="" 表示主干。只读打开不要求该分支处于活跃状态，
    但后续写该文档前仍需切换。
    """
    params: dict[str, Any] = {"packageName": package_name, "itemName": item_name}
    if branch is not None:
        params["branch"] = branch
    return _client.call("open_document", params)


@mcp.tool()
def fgui_create_component(
    package_name: str,
    component_name: str,
    width: float = 800,
    height: float = 600,
    folder_path: str = "",
    extension_id: str | None = None,
    exported: bool = True,
    auto_rename: bool = False,
    create_folders: bool = True,
    open_after_create: bool = True,
    save: bool = False,
    verify: bool = True,
    branch: str | None = None,
) -> dict[str, Any]:
    """在指定包中新建组件文档；默认打开但不保存，重名时默认拒绝。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目；组件类资源没有可靠的 asset 重载手段，external_reload 不可用，strength 上限为 disk。
    """
    params: dict[str, Any] = {
        "packageName": package_name,
        "componentName": component_name,
        "width": width,
        "height": height,
        "folderPath": folder_path,
        "exported": exported,
        "autoRename": auto_rename,
        "createFolders": create_folders,
        "openAfterCreate": open_after_create,
        "save": save,
        "verify": verify,
    }
    if extension_id:
        params["extensionId"] = extension_id
    if branch is not None:
        params["branch"] = branch
    return _client.call("create_component", params)


@mcp.tool()
def fgui_import_image(
    package_name: str,
    source_path: str,
    folder_path: str = "",
    resource_name: str | None = None,
    conflict_policy: Literal["error", "auto_rename", "replace"] = "error",
    exported: bool = True,
    create_folders: bool = True,
    max_size: int | None = None,
    timeout_seconds: float = 120,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
    branch: str | None = None,
) -> dict[str, Any]:
    """从绝对本地路径导入图片；这是磁盘写入操作，支持拒绝、自动改名或替换同名图片。

    max_size 是长边上限（像素，1~32768）：源图长边超过它就先等比缩放再入库，响应里的 scaled 回报缩放前后尺寸与缩放比，atlasPrecheck 给出按真实图集约束的前置判定（fit 为 fits/exceeds/unknown，unknown 不等于放行）。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目和资源文件；external_reload=True（需 save=True）卸载并重新加载 asset 再比对，响应 strength 为 reload / disk / none。
    """
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    if max_size is not None and (not isinstance(max_size, int) or max_size <= 0 or max_size > 32768):
        raise ValueError("max_size 必须是 1 到 32768 之间的整数")
    resolved_source = Path(source_path).expanduser().resolve()
    params: dict[str, Any] = {
        "packageName": package_name,
        "sourcePath": str(resolved_source),
        "folderPath": folder_path,
        "conflictPolicy": conflict_policy,
        "exported": exported,
        "createFolders": create_folders,
        "save": save,
        "verify": verify,
        "externalReload": external_reload,
    }
    if resource_name:
        params["resourceName"] = resource_name
    if max_size is not None:
        params["maxSize"] = max_size
    if branch is not None:
        params["branch"] = branch
    return _client.call("import_image", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_import_font(
    package_name: str,
    source_path: str,
    folder_path: str = "",
    resource_name: str | None = None,
    conflict_policy: Literal["error", "auto_rename", "replace"] = "error",
    exported: bool = True,
    create_folders: bool = True,
    timeout_seconds: float = 120,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
    branch: str | None = None,
) -> dict[str, Any]:
    """从绝对本地路径导入字体；这是磁盘写入操作，支持拒绝、自动改名或替换同名字体。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目和资源文件；external_reload=True（需 save=True）卸载并重新加载 asset 再比对，响应 strength 为 reload / disk / none。
    """
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    resolved_source = Path(source_path).expanduser().resolve()
    params: dict[str, Any] = {
        "packageName": package_name,
        "sourcePath": str(resolved_source),
        "folderPath": folder_path,
        "conflictPolicy": conflict_policy,
        "exported": exported,
        "createFolders": create_folders,
        "save": save,
        "verify": verify,
        "externalReload": external_reload,
    }
    if resource_name:
        params["resourceName"] = resource_name
    if branch is not None:
        params["branch"] = branch
    return _client.call("import_font", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_create_button(
    package_name: str,
    button_name: str,
    width: float = 160,
    height: float = 60,
    folder_path: str = "",
    mode: Literal["common", "check", "radio"] = "common",
    image_urls: list[str] | None = None,
    create_text: bool = True,
    create_icon: bool = True,
    create_relations: bool = True,
    as_list_item: bool = False,
    exported: bool = True,
    auto_rename: bool = False,
    create_folders: bool = True,
    open_after_create: bool = True,
    extension_id: str | None = None,
    save: bool = False,
    verify: bool = True,
    branch: str | None = None,
) -> dict[str, Any]:
    """创建标准 FairyGUI Button 组件；状态图顺序为 up/down/over/selectedOver/disabled/selectedDisabled。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目；组件类资源不支持 external_reload，strength 上限为 disk。
    """
    params: dict[str, Any] = {
        "packageName": package_name,
        "buttonName": button_name,
        "width": width,
        "height": height,
        "folderPath": folder_path,
        "mode": mode,
        "imageUrls": image_urls or [],
        "createText": create_text,
        "createIcon": create_icon,
        "createRelations": create_relations,
        "asListItem": as_list_item,
        "exported": exported,
        "autoRename": auto_rename,
        "createFolders": create_folders,
        "openAfterCreate": open_after_create,
        "save": save,
        "verify": verify,
    }
    if extension_id:
        params["extensionId"] = extension_id
    if branch is not None:
        params["branch"] = branch
    return _client.call("create_button", params)


@mcp.tool()
def fgui_get_active_document() -> dict[str, Any]:
    """读取当前活动文档、修改状态和选择数量。"""
    return _client.call("get_active_document")


@mcp.tool()
def fgui_get_tree(max_depth: int = 12, branch: str | None = None) -> dict[str, Any]:
    """读取当前组件对象树；修改前应先取得稳定的对象 ID 或路径。

    branch 指定时要求当前文档属于该分支；只读读取不要求该分支处于活跃状态。
    """
    if max_depth < 0 or max_depth > 64:
        raise ValueError("max_depth 必须在 0 到 64 之间")
    params: dict[str, Any] = {"maxDepth": max_depth}
    if branch is not None:
        params["branch"] = branch
    return _client.call("get_tree", params)


@mcp.tool()
def fgui_import_sound(
    package_name: str,
    source_path: str,
    folder_path: str = "",
    resource_name: str | None = None,
    conflict_policy: Literal["error", "auto_rename", "replace"] = "error",
    exported: bool = True,
    create_folders: bool = True,
    timeout_seconds: float = 120,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
    branch: str | None = None,
) -> dict[str, Any]:
    """从绝对本地路径导入声音资源；支持替换同名声音，属于磁盘写入。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目和资源文件；external_reload=True（需 save=True）卸载并重新加载 asset 再比对，响应 strength 为 reload / disk / none。
    """
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    params: dict[str, Any] = {
        "packageName": package_name,
        "sourcePath": str(Path(source_path).expanduser().resolve()),
        "folderPath": folder_path,
        "conflictPolicy": conflict_policy,
        "exported": exported,
        "createFolders": create_folders,
        "save": save,
        "verify": verify,
        "externalReload": external_reload,
    }
    if resource_name:
        params["resourceName"] = resource_name
    if branch is not None:
        params["branch"] = branch
    return _client.call("import_sound", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_create_movieclip(
    package_name: str,
    movieclip_name: str,
    frame_paths: list[str],
    folder_path: str = "",
    fps: int = 12,
    repeat_delay: int = 0,
    swing: bool = False,
    frame_delays: list[int] | None = None,
    conflict_policy: Literal["error", "auto_rename", "replace"] = "error",
    exported: bool = True,
    create_folders: bool = True,
    timeout_seconds: float = 120,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
    branch: str | None = None,
) -> dict[str, Any]:
    """用有序绝对图片路径创建或替换 MovieClip；图片序列由 FairyGUI 原生动画资源处理。

    save=True 保存包与工程后默认比对 package.xml（分支写入比对 package_branch.xml）条目和资源文件；external_reload=True（需 save=True）卸载并重新加载 asset 再比对，响应 strength 为 reload / disk / none。
    """
    if not frame_paths:
        raise ValueError("frame_paths 至少需要一帧")
    if not 1 <= fps <= 255 or not 0 <= repeat_delay <= 255:
        raise ValueError("fps 必须是 1 到 255，repeat_delay 必须是 0 到 255 的额外延迟帧数")
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    params: dict[str, Any] = {
        "packageName": package_name,
        "movieClipName": movieclip_name,
        "framePaths": [str(Path(path).expanduser().resolve()) for path in frame_paths],
        "folderPath": folder_path,
        "fps": fps,
        "repeatDelay": repeat_delay,
        "swing": swing,
        "conflictPolicy": conflict_policy,
        "exported": exported,
        "createFolders": create_folders,
        "save": save,
        "verify": verify,
        "externalReload": external_reload,
    }
    if frame_delays is not None:
        if len(frame_delays) != len(frame_paths) or any(delay < 0 or delay > 255 for delay in frame_delays):
            raise ValueError("frame_delays 必须与 frame_paths 等长，且每项在 0 到 255 之间")
        params["frameDelays"] = frame_delays
    if branch is not None:
        params["branch"] = branch
    return _client.call("create_movieclip", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_get_movieclip(
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
) -> dict[str, Any]:
    """读取 MovieClip 的帧、FPS、Swing 和 RepeatDelay 设置。"""
    return _client.call("get_movieclip", _resource_target(url, package_name, item_name, item_path))


@mcp.tool()
def fgui_update_movieclip(
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    frame_paths: list[str] | None = None,
    fps: int | None = None,
    speed: float | None = None,
    repeat_delay: int | None = None,
    swing: bool | None = None,
    frame_delays: list[int] | None = None,
    exported: bool | None = None,
    timeout_seconds: float = 120,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """更新已有 MovieClip；传入 frame_paths 时使用新的有序图片序列替换动画帧。

    save=True 保存包与工程后默认比对 package.xml 条目和资源文件；external_reload=True（需 save=True）卸载并重新加载 asset 再比对，响应 strength 为 reload / disk / none。
    """
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    if fps is not None and not 1 <= fps <= 255:
        raise ValueError("fps 必须是 1 到 255 之间的整数")
    if repeat_delay is not None and not 0 <= repeat_delay <= 255:
        raise ValueError("repeat_delay 必须是 0 到 255 的额外延迟帧数")
    params = _resource_target(url, package_name, item_name, item_path)
    if frame_paths is not None:
        if not frame_paths:
            raise ValueError("frame_paths 至少需要一帧")
        params["framePaths"] = [str(Path(path).expanduser().resolve()) for path in frame_paths]
    if speed is not None and not 0.001 <= speed <= 1000:
        raise ValueError("speed 必须在 0.001 到 1000 之间")
    if frame_delays is not None and any(delay < 0 or delay > 255 for delay in frame_delays):
        raise ValueError("frame_delays 每项必须在 0 到 255 之间")
    updates = (("fps", fps), ("speed", speed), ("repeatDelay", repeat_delay), ("swing", swing), ("frameDelays", frame_delays), ("exported", exported))
    for key, value in updates:
        if value is not None:
            params[key] = value
    if not any(value is not None for _, value in updates) and frame_paths is None:
        raise ValueError("至少需要提供一个 MovieClip 更新字段")
    params["save"] = save
    params["verify"] = verify
    params["externalReload"] = external_reload
    return _client.call("update_movieclip", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_remove_movieclip(
    force: bool = False,
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    save: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """删除 MovieClip 包资源；这是不可逆资源操作，必须显式 force=True。

    save=True 保存包与工程后默认比对 package.xml 确认条目已移除；删除没有诚实的重载基元，external_reload 不可用，strength 上限为 disk。
    """
    params = _resource_target(url, package_name, item_name, item_path)
    params["force"] = force
    params["save"] = save
    params["verify"] = verify
    return _client.call("remove_movieclip", params)


# --- P9-4 包资源管理（0.8.22） ---------------------------------------------
# 真机 6.1.4 实测：四个原语都立即落盘、不进 Agent 撤销栈。
# 编辑器原生 DeleteItem 不拦引用（会留悬空引用），MoveItem 的目标目录必须已存在，
# RenameItem/MoveItem 不会更新引用方文档的 fileName 属性。


@mcp.tool()
def fgui_delete_package_item(
    force: bool = False,
    allow_dangling_references: bool = False,
    close_open_documents: bool = False,
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    save: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """删除包资源（组件/图片/字体/声音/MovieClip/目录）；不可逆操作，必须显式 force=True。

    编辑器原生 DeleteItem 不会拦引用：被引用的资源照样删，引用方会留下悬空 src。
    默认检测到引用就拒绝并列出引用位置；确认要删就传 allow_dangling_references=True，响应会回报哪些引用会变悬空。
    目标组件的文档正开着时默认拒绝；传 close_open_documents=True 让本工具关闭它（未保存改动一律拒绝）。
    删除会连带删掉磁盘文件，不进 Agent 撤销栈。
    """
    params = _resource_target(url, package_name, item_name, item_path)
    params["force"] = force
    params["allowDanglingReferences"] = allow_dangling_references
    params["closeOpenDocuments"] = close_open_documents
    params["save"] = save
    params["verify"] = verify
    return _client.call("delete_package_item", params)


@mcp.tool()
def fgui_rename_package_item(
    new_name: str,
    close_open_documents: bool = False,
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    save: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """重命名包资源；磁盘文件同步改名，不可撤销。

    new_name 不带扩展名（编辑器按资源类型补）。同名资源会被拒绝。
    改名不会更新引用方文档的 fileName 属性（id 不变，运行时按 id 解析不受影响），
    响应里的 staleFileNameSlots 会列出这些位置，需要时让那些文档经编辑器重新保存一次即可补齐。
    """
    params = _resource_target(url, package_name, item_name, item_path)
    params["newName"] = new_name
    params["closeOpenDocuments"] = close_open_documents
    params["save"] = save
    params["verify"] = verify
    return _client.call("rename_package_item", params)


@mcp.tool()
def fgui_move_package_item(
    folder_path: str,
    create_folders: bool = True,
    close_open_documents: bool = False,
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    save: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """把包资源移动到包内另一个目录；磁盘文件同步移动，不可撤销。

    folder_path 是包内目录（如 "/ui/"）。编辑器原生 MoveItem 要求目标目录已存在，
    否则会抛原生异常；本工具默认按 create_folders=True 先建目录再移动，并在响应里回报是否新建了目录。
    移动不会更新引用方文档的 fileName 属性（id 不变，运行时按 id 解析不受影响），响应里的 staleFileNameSlots 会列出这些位置。
    """
    params = _resource_target(url, package_name, item_name, item_path)
    params["folderPath"] = folder_path
    params["createFolders"] = create_folders
    params["closeOpenDocuments"] = close_open_documents
    params["save"] = save
    params["verify"] = verify
    return _client.call("move_package_item", params)


@mcp.tool()
def fgui_duplicate_package_item(
    new_name: str | None = None,
    conflict_policy: str = "error",
    url: str | None = None,
    package_name: str | None = None,
    item_name: str | None = None,
    item_path: str | None = None,
    save: bool = False,
    verify: bool = True,
) -> dict[str, Any]:
    """复制包资源；副本是新 id 的新资源，磁盘文件一并复制，原资源不受影响。

    new_name 省略时用 "<原名>_copy"。conflict_policy 取 error（同名即拒绝）或 auto_rename（自动加后缀）。
    """
    params = _resource_target(url, package_name, item_name, item_path)
    if new_name is not None:
        params["newName"] = new_name
    params["conflictPolicy"] = conflict_policy
    params["save"] = save
    params["verify"] = verify
    return _client.call("duplicate_package_item", params)



@mcp.tool()
def fgui_list_transitions() -> list[dict[str, Any]]:
    """读取当前组件的全部 Transition 及类型化关键帧。"""
    return _client.call("list_transitions")


@mcp.tool()
def fgui_get_transition(name: str) -> dict[str, Any]:
    """按名称读取当前组件的一个 Transition。"""
    return _client.call("get_transition", {"name": name})


@mcp.tool()
def fgui_verify_transition(name: str | None = None, check_bounds: bool = True) -> dict[str, Any]:
    """只读校验当前组件的 Transition：目标对象、关键帧值、嵌套引用与 XY 位置范围。

    不修改文档、不保存。省略 name 时校验全部 Transition。summary.valid 只统计 error；
    position_outside_canvas 是 warning——滑入/滑出动画的越界坐标本身是合法的。
    """
    params: dict[str, Any] = {"checkBounds": check_bounds}
    if name:
        params["name"] = name
    return _client.call("verify_transition", params)


@mcp.tool()
def fgui_upsert_transition(transition: TransitionDefinition, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """声明式创建或完整替换一个 Transition；一次调用可由 fgui_undo/redo 原子回退。

    save=True 保存后默认比对磁盘 XML 中的 <transition> 节点；external_reload=True（需 save=True）关闭并重新打开文档再比对，响应 strength 为 reload / disk / none。
    """
    return _client.call("upsert_transition", {"transition": transition, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_remove_transition(name: str, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """删除当前组件中的一个 Transition；可由 fgui_undo 恢复。

    save=True 保存后默认确认磁盘 XML 不再包含该 Transition；external_reload=True（需 save=True）关闭重开后确认仍不存在，响应 strength 为 reload / disk / none。
    """
    return _client.call("remove_transition", {"name": name, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_add_transition_item(name: str, item: TransitionItem, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """向 Transition 添加一个类型化关键帧轨道项。

    save=True 保存后默认比对磁盘 XML 中该 Transition 的条目数；external_reload=True（需 save=True）关闭重开再比对，响应 strength 为 reload / disk / none。
    """
    return _client.call("add_transition_item", {"name": name, "item": item, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_update_transition_item(name: str, item_index: int, item: TransitionItem, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """替换 Transition 指定索引的关键帧项；可用 fgui_undo/redo 回退。

    save=True 保存后默认比对磁盘 XML 中该 Transition 的条目数；external_reload=True（需 save=True）关闭重开再比对，响应 strength 为 reload / disk / none。
    """
    if item_index < 0:
        raise ValueError("item_index 不能小于 0")
    return _client.call("update_transition_item", {"name": name, "itemIndex": item_index, "item": item, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_remove_transition_item(name: str, item_index: int, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """删除 Transition 指定索引的关键帧项；可用 fgui_undo 恢复。

    save=True 保存后默认比对磁盘 XML 中该 Transition 的条目数；external_reload=True（需 save=True）关闭重开再比对，响应 strength 为 reload / disk / none。
    """
    if item_index < 0:
        raise ValueError("item_index 不能小于 0")
    return _client.call("remove_transition_item", {"name": name, "itemIndex": item_index, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_add_keyframes(name: str, keyframes: list[KeyframeSpec], save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """在 Transition 时间轴上创建关键帧；一次调用可由 fgui_undo/redo 原子回退。

    每项需要 targetId（空表示根组件）、type 与 frame；value 省略时由编辑器采样对象当前状态。
    label 可写说明文字。同一轨道同一帧已存在会整体拒绝，不会留下半写入。
    save=True 保存后默认比对磁盘 XML 中该 Transition 的条目数；external_reload=True（需 save=True）关闭重开再比对。
    """
    if not keyframes:
        raise ValueError("keyframes 不能为空")
    return _client.call("add_keyframes", {"name": name, "keyframes": keyframes, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_set_keyframe(
    name: str,
    changes: KeyframeChanges,
    item_index: int | None = None,
    target_id: str | None = None,
    track_type: str | None = None,
    frame: int | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """修改一个已有关键帧；可用 item_index，或 target_id + track_type + frame 定位。

    按 target_id/type/frame 还能定位 get_transition 隐藏的 Tween 合成端点（此时
    itemIndex=null、syntheticEndpoint=true）。changes 支持 frame / label / tween / ease /
    repeat / yoyo / value / endValue。tween=true 只能用于已处于 Tween 关系中的关键帧
    （Tween 起点，或插入已有 Tween 后形成的端点）；普通关键帧之间建立 Tween 请用
    fgui_upsert_transition。endValue 写入 Tween 端点；tween=false 不能同时给 endValue。
    save=True 保存后默认比对磁盘 XML；external_reload=True（需 save=True）关闭重开再比对。
    """
    if not changes:
        raise ValueError("changes 至少需要一个字段")
    if item_index is not None:
        if item_index < 0:
            raise ValueError("item_index 不能小于 0")
        if target_id is not None or track_type is not None or frame is not None:
            raise ValueError("item_index 不能与 target_id/track_type/frame 同时提供")
    elif track_type is None or frame is None:
        raise ValueError("必须提供 item_index，或 target_id（可选）+ track_type + frame")
    params: dict[str, Any] = {"name": name, "changes": changes, "save": save, "verify": verify, "externalReload": external_reload}
    if item_index is not None:
        params["itemIndex"] = item_index
    else:
        params["type"] = track_type
        params["frame"] = frame
        if target_id is not None:
            params["targetId"] = target_id
    return _client.call("set_keyframe", params)


@mcp.tool()
def fgui_duplicate_transition(name: str, new_name: str | None = None, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """复制一个 Transition（含全部关键帧）；可由 fgui_undo 回退。

    6.1.4 的 DuplicateTransition 运行时不接受新名称参数，Bridge 会复制后再经文档模型改名；
    structureNormalized=true 表示副本结构经编辑器归一化，与源不完全一致。省略 new_name 时沿用编辑器自动命名。
    save=True 保存后默认比对磁盘 XML 中副本的 <transition> 节点；external_reload=True（需 save=True）关闭重开再比对。
    """
    params: dict[str, Any] = {"name": name, "save": save, "verify": verify, "externalReload": external_reload}
    if new_name:
        params["newName"] = new_name
    return _client.call("duplicate_transition", params)


@mcp.tool()
def fgui_preview_animation(
    kind: Literal["transition", "movieclip"],
    operation: Literal["play", "pause", "stop", "seek", "next", "previous", "status"],
    name: str | None = None,
    document_url: str | None = None,
    frame: int | None = None,
    times: int | None = None,
    delay: float | None = None,
    start_frame: int | None = None,
    end_frame: int | None = None,
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
) -> dict[str, Any]:
    """在 Editor 中播放、暂停、停止、跳帧或查询预览状态；预览不会保存到 FairyGUI 资源。"""
    params: dict[str, Any] = {"kind": kind, "operation": operation}
    if kind == "transition":
        if not name:
            raise ValueError("Transition 预览需要 name")
        params["target"] = {"name": name}
        if document_url:
            params["target"]["documentUrl"] = document_url
    else:
        params["target"] = _target(object_id, object_path, object_name)
    for key, value in (("frame", frame), ("times", times), ("delay", delay), ("startFrame", start_frame), ("endFrame", end_frame)):
        if value is not None:
            params[key] = value
    return _client.call("preview_animation", params)


@mcp.tool()
def fgui_get_history() -> dict[str, Any]:
    """读取 Agent 属性事务栈和 FairyGUI 原生撤销状态。"""
    return _client.call("get_history")


@mcp.tool()
def fgui_select_object(
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
) -> dict[str, Any]:
    """通过对象 ID、对象树路径或唯一名称选择一个对象。"""
    return _client.call("select_object", {"target": _target(object_id, object_path, object_name)})


@mcp.tool()
def fgui_set_property(
    property_name: str,
    value: Any,
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """修改白名单属性；该操作进入 Agent 属性 undo/redo 事务栈。

    save=True 保存后默认比对磁盘 XML；external_reload=True 会在保存后关闭并重新打开文档再比对，需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    return _client.call(
        "set_property",
        {
            "target": _target(object_id, object_path, object_name),
            "property": property_name,
            "value": value,
            "save": save,
            "verify": verify,
            "externalReload": external_reload,
        },
    )


@mcp.tool()
def fgui_replace_object_resource(resource_url: str, object_id: str | None = None, object_path: str | None = None, object_name: str | None = None, expected_type: str | None = None, state: str | None = None, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """通过 Editor API 替换 Image/Loader 图片引用或**组件实例的源组件**（0.8.21+）；保存后默认比对磁盘 XML。Button 状态暂不支持。

    组件实例换源组件走编辑器原生命令 Document.ReplaceSelection：id/name/xy/relation/显式 size 全部保留，
    没有显式 size 时尺寸跟随新源组件（FGUI 语义，preserve_size 对组件实例不适用）。
    expected_type 省略时按目标对象推导（image/loader→image，组件实例→component），显式传入则作为断言。

    external_reload=True 会在保存后关闭并重新打开文档再比对，是唯一能证明「重新载入时值不丢」的验证；需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    params: dict[str, Any] = {"target": _target(object_id, object_path, object_name), "resourceURL": resource_url, "save": save, "verify": verify, "externalReload": external_reload}
    if expected_type: params["expectedType"] = expected_type
    if state: params["state"] = state
    return _client.call("replace_object_resource", params)


@mcp.tool()
def fgui_query_references(resource_url: str, max_items: int | None = None, skip_package_open: bool = False) -> dict[str, Any]:
    """查询全工程里哪些位置引用了目标资源（只读，0.8.10+）。

    走编辑器原生 DependencyQuery，返回的每条引用精确到「哪个包的哪个资源的哪个属性槽」：
    packageId / itemId / propKey / arrayIndex / valueType。改资源引用前先跑它，能直接回答
    「换掉这张图会影响哪些节点」，也可作为 replace_object_resource 的影响面预览。

    只读：不会保存、不会标记文档修改。max_items 限制返回条数（默认 200，上限 2000），
    截断时 truncated=true 且 totalCount 仍为真实总数，不会静默丢弃。
    skip_package_open=True 跳过「预先打开未打开的包」，更快但可能少算未打开包里的引用；
    默认会先打开，代价记录在响应的 packages 字段里。
    """
    params: dict[str, Any] = {"url": resource_url, "skipPackageOpen": skip_package_open}
    if max_items is not None:
        params["maxItems"] = max_items
    return _client.call("query_references", params)


@mcp.tool()
def fgui_query_dependencies(resource_url: str, seek_level: str = "samePackage", max_items: int | None = None, skip_package_open: bool = False) -> dict[str, Any]:
    """查询目标资源依赖了哪些资源（只读，0.8.10+）。

    走编辑器原生 DependencyQuery。seek_level 取 selection / samePackageButNotExported /
    samePackage（默认）/ all，决定依赖搜索范围；响应会回报实际生效的 seekLevel。

    只读：不会保存、不会标记文档修改。max_items、skip_package_open 同 fgui_query_references。
    """
    params: dict[str, Any] = {"url": resource_url, "seekLevel": seek_level, "skipPackageOpen": skip_package_open}
    if max_items is not None:
        params["maxItems"] = max_items
    return _client.call("query_dependencies", params)


@mcp.tool()
def fgui_find_unused(
    packages: list[str] | None = None,
    types: list[str] | None = None,
    include_branches: bool = True,
    skip_exported: bool = False,
    max_items: int | None = None,
) -> dict[str, Any]:
    """找出工程内没有任何引用位置的资源（只读，0.8.19+）。

    返回每个未引用资源的包、路径、URL、文件大小，图片还附带尺寸。判断口径是
    「当前工程内零引用」：导出资源可能被运行时按 URL 使用，默认仍会列出并标记
    exported，删改前请确认；skip_exported=True 可排除它们。

    packages 传包名或包 ID，省略时扫描全工程；types 可按 image / font / sound /
    movieclip / component 过滤；max_items 限制返回明细条数，unusedCount 仍是真实总数。
    """
    params: dict[str, Any] = {
        "includeBranches": include_branches,
        "skipExported": skip_exported,
    }
    if packages:
        params["packages"] = packages
    if types:
        params["types"] = types
    if max_items is not None:
        params["maxItems"] = max_items
    return _client.call("find_unused", params)


@mcp.tool()
def fgui_find_duplicate(
    packages: list[str] | None = None,
    types: list[str] | None = None,
    include_branches: bool = True,
    max_groups: int | None = None,
    max_items_per_group: int | None = None,
) -> dict[str, Any]:
    """找出文件内容完全相同的资源，按 MD5 分组（只读，0.8.19+）。

    适合清理重复导入的图片、字体和音效；组件 XML 也参与比较。每组返回文件大小、
    条目和可回收字节数，按浪费体积从大到小排序。同名不同内容不算重复。

    packages / types / include_branches 同 fgui_find_unused；max_groups 和
    max_items_per_group 分别限制组数与组内明细条数，计数字段不受截断影响。
    """
    params: dict[str, Any] = {"includeBranches": include_branches}
    if packages:
        params["packages"] = packages
    if types:
        params["types"] = types
    if max_groups is not None:
        params["maxGroups"] = max_groups
    if max_items_per_group is not None:
        params["maxItemsPerGroup"] = max_items_per_group
    return _client.call("find_duplicate", params)


@mcp.tool()
def fgui_replace_references(
    resource_url: str,
    new_resource_url: str,
    execute: bool = False,
    max_items: int | None = None,
    skip_package_open: bool = False,
) -> dict[str, Any]:
    """把全工程对某个资源的所有引用替换成另一个资源（0.8.11+）。

    先预览、再执行，这是硬要求而不是建议：编辑器原生 ReplaceReferences 直接改包 XML，
    **立即落盘**、不进 Agent 撤销栈、没有 save 兜底，也没有 external_reload 可做——
    响应里 undoable=false 就是这个意思。默认 execute=false 只出预览，
    确认 totalCount 与 references 明细后再显式传 execute=True。

    与 fgui_replace_object_resource 分工：那个改「某一个对象的某一个属性槽」，
    走文档模型、可撤销、有 save/verify/external_reload 梯子；这个改「全工程引用图」，
    走原生批处理、不可撤销。两者不要互相替代。

    执行后按引用图回读验证（源资源残留引用必须为 0），verification.scope 会标明
    "reference-graph"——这是引用图口径，不宣称属性级一致：原生批量替换不会同步
    image 元素的 fileName，落盘后该属性短暂滞后，warnings 字段会显式报出槽位数量，
    这些节点下次经编辑器保存时自动补齐。

    max_items、skip_package_open 同 fgui_query_references。
    """
    params: dict[str, Any] = {
        "url": resource_url,
        "newUrl": new_resource_url,
        "mode": "execute" if execute else "preview",
        "skipPackageOpen": skip_package_open,
    }
    if max_items is not None:
        params["maxItems"] = max_items
    return _client.call("replace_references", params)


@mcp.tool()
def fgui_get_text_style(object_id: str | None = None, object_path: str | None = None, object_name: str | None = None) -> dict[str, Any]:
    """读取 TextField/RichText 的统一文本样式。"""
    return _client.call("get_text_style", {"target": _target(object_id, object_path, object_name)})


@mcp.tool()
def fgui_set_text_style(style: dict[str, Any], object_id: str | None = None, object_path: str | None = None, object_name: str | None = None, save: bool = False, verify: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """设置 TextField/RichText 的统一文本样式。

    external_reload=True 会在保存后关闭并重新打开文档再比对，是唯一能证明「重新载入时值不丢」的验证；需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    return _client.call("set_text_style", {"target": _target(object_id, object_path, object_name), "style": style, "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_set_instance_override(
    properties: dict[str, Any],
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """写组件实例的扩展级 override（同一个组件、不同实例不同文案/样式）。

    只支持**扩展级**覆盖，这是编辑器与 FGUI 运行时共同支持的那一层：
    源组件是 Button 扩展时可写 title（text 是别名）、icon、selectedTitle、selectedIcon、
    titleColor（#RRGGBB 六位，alpha 会被编辑器丢掉）、titleFontSize；Label 扩展可写
    title、icon、titleColor、titleFontSize。落盘形态是实例节点里的扩展子节点
    `<component ...><Button title="..."/></component>`，运行时按同一组字段消费。

    边界（真机 6.1.4 实测）：编辑器**不支持**逐子对象覆盖——改实例内部子对象只改到内存，
    磁盘不落盘；这类需求请改用 insert_text 直接建对象，或把样式固化成组件类型。
    源组件没有扩展时也会被拒绝。

    external_reload=True 会在保存后关闭并重新打开文档再比对，是唯一能证明「重新载入时值不丢」
    的验证；需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    return _client.call(
        "set_instance_override",
        {
            "target": _target(object_id, object_path, object_name),
            "properties": properties,
            "save": save,
            "verify": verify,
            "externalReload": external_reload,
        },
    )


@mcp.tool()
def fgui_verify_document(max_depth: int = 12, object_id: str | None = None, object_path: str | None = None, object_name: str | None = None, expected: dict[str, Any] | None = None, read_xml: bool = True, external_reload: bool = False) -> dict[str, Any]:
    """只读验证 target 的 expected 属性；默认比对磁盘 XML，不保存。无 expected 时仅返回快照。

    expected 为纯属性对象时比对单个 target（必须提供 object_id/object_path/object_name）。expected 含 children 时执行对象树比对，可省略 target（默认根组件）：每个节点用 id/name/type 断言或定位，children 为子节点 spec 数组；childrenMode 默认 "exact"（按位置全等，数量必须一致），"subset" 表示每个 spec 按 id/name/index 定位一个子节点、允许多余节点。

    external_reload=True 会关闭并重新打开当前文档再比对——这是只读操作仍能达到的最强持久化证明。本命令不会保存，因此文档存在未保存改动时会拒绝执行。
    """
    params: dict[str, Any] = {"maxDepth": max_depth, "readXml": read_xml, "externalReload": external_reload}
    if expected is not None:
        is_tree = any(k in expected for k in ("children", "childrenMode", "index"))
        if not any((object_id, object_path, object_name)) and not is_tree:
            raise ValueError("expected 必须提供 target；含 children 的树结构比对可省略 target（默认根组件）")
        params["expected"] = expected
    if any((object_id, object_path, object_name)): params["target"] = _target(object_id, object_path, object_name)
    return _client.call("verify_document", params)


@mcp.tool()
def fgui_set_list_layout(
    fields: dict[str, Any],
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """修改 List 对象的布局与滚动属性（0.8.8+）。fields 支持：

    layout（single_column/single_row/flow_horizontal/flow_vertical/pagination）、
    selectionMode（none/single/multiple/multiple_singleclick）、lineGap、columnGap、
    defaultItem（ui:// 组件资源）、autoItemSize、align/vAlign（含 none）、
    selectionController（控制器名）、foldInvisibleItems、clearOnPublish、
    scrollItemToViewOnClick、overflow（visible/hidden/scroll）、margin（"l,t,r,b"）。

    external_reload=True 需 save=True，关闭重开文档后重新比对；strength 标明验证强度。
    """
    params: dict[str, Any] = {"target": _target(object_id, object_path, object_name), "save": save, "verify": verify, "externalReload": external_reload}
    params.update(fields)
    return _client.call("set_list_layout", params)


@mcp.tool()
def fgui_set_group_layout(
    fields: dict[str, Any],
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """修改 Group 对象的布局属性（0.8.8+）。fields 支持：

    advanced、layout（horizontal/vertical 或 hz/vt）、lineGap、columnGap、
    excludeInvisibles、mainGridMinSize、mainGridIndex、autoSizeDisabled、collapsed。
    layout/lineGap/columnGap/excludeInvisibles 仅对 advanced=true 的高级组有效。

    external_reload=True 需 save=True，关闭重开文档后重新比对；strength 标明验证强度。
    """
    params: dict[str, Any] = {"target": _target(object_id, object_path, object_name), "save": save, "verify": verify, "externalReload": external_reload}
    params.update(fields)
    return _client.call("set_group_layout", params)


@mcp.tool()
def fgui_set_relation(
    relations: list[dict[str, Any]],
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """整体替换对象的 Relation 绑定（0.8.8+）。relations 每项为：

    {"target": {"id"/"path"/"name"} 或 null（null/缺省 = 父组件）,
     "sidePair": "left-left,right-right" 或 "pairs": [{"source": "right", "target": "right", "percent": false}]}

    sidePair 方向名：left/center/right/leftext/rightext/width（水平），
    top/middle/bottom/topext/bottomext/height（垂直）；percent 追加 % 后缀。

    external_reload=True 需 save=True，关闭重开文档后重新比对；strength 标明验证强度。
    """
    params: dict[str, Any] = {"target": _target(object_id, object_path, object_name), "relations": relations, "save": save, "verify": verify, "externalReload": external_reload}
    return _client.call("set_relation", params)


@mcp.tool()
def fgui_set_gear_display(
    controller: str | None,
    pages: list[str] | str | None = None,
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """设置对象的 gearDisplay 联动（0.8.8+）：指定控制器与可见页面。

    controller=None 或空字符串清除联动；pages 为页面 id 或名称列表（也接受 "0,1" 逗号串），
    省略 pages 保持现有页面不变。

    external_reload=True 需 save=True，关闭重开文档后重新比对；strength 标明验证强度。
    """
    params: dict[str, Any] = {"target": _target(object_id, object_path, object_name), "controller": controller, "save": save, "verify": verify, "externalReload": external_reload}
    if pages is not None:
        params["pages"] = pages
    return _client.call("set_gear_display", params)


@mcp.tool()
def fgui_list_controllers() -> dict[str, Any]:
    """列出当前文档根组件的全部 Controller（0.8.8+）。"""
    return _client.call("list_controllers")


@mcp.tool()
def fgui_set_controller(
    name: str,
    pages: list[str] | None = None,
    add_pages: list[str] | None = None,
    selected_index: int | None = None,
    selected_page: str | None = None,
    exported: bool | None = None,
    auto_radio_group_depth: bool | None = None,
    home_page: str | None = None,
    create: bool = False,
    remove: bool = False,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """创建、修改或删除当前组件的 Controller（0.8.8+）。

    create=True 创建不存在的控制器；remove=True 删除；pages 整体替换页面集
    （会重新分配页面 id，gearDisplay 中的页面引用需重新核对）；add_pages 追加；
    selected_index/selected_page 设置选中页。

    external_reload=True 需 save=True，关闭重开文档后重新比对；strength 标明验证强度。
    """
    params: dict[str, Any] = {"name": name, "create": create, "remove": remove, "save": save, "verify": verify, "externalReload": external_reload}
    for key, value in (("pages", pages), ("addPages", add_pages), ("selectedIndex", selected_index), ("selectedPage", selected_page),
                       ("exported", exported), ("autoRadioGroupDepth", auto_radio_group_depth), ("homePage", home_page)):
        if value is not None:
            params[key] = value
    return _client.call("set_controller", params)


@mcp.tool()
def fgui_insert_text(
    text: str = "",
    x: float = 0,
    y: float = 0,
    name: str | None = None,
    style: dict[str, Any] | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """在当前文档根组件下创建文本对象（0.8.20+）；结构操作不能由 Agent 属性事务栈撤销。

    文本是 FGUI 的裸节点、不是包资源，所以只能用 insert_text 造，不能用 insert_object。
    style 支持：font / fontSize / color / align / vAlign / autoSize / letterSpacing / lineGap /
    width / height / bold / italic / underline / strokeSize / strokeColor / shadowX / shadowY / shadowColor。
    其中 width/height 会自动把 autoSize 切成 none（否则编辑器在保存时按文字自然尺寸重算，写进去的尺寸会被改写）。
    投影偏移（shadowX/shadowY）会自动打开投影开关：偏移不伴随开关时编辑器不会落盘。

    save=True 保存后默认比对磁盘 XML；external_reload=True 会在保存后关闭并重新打开文档再比对，需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    params: dict[str, Any] = {"text": text, "x": x, "y": y, "save": save, "verify": verify, "externalReload": external_reload}
    if name:
        params["name"] = name
    if style:
        params["style"] = style
    return _client.call("insert_text", params)


@mcp.tool()
def fgui_insert_object(
    url: str,
    x: float = 0,
    y: float = 0,
    name: str | None = None,
    insert_index: int | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """插入已有 ui:// 资源；结构操作不能由 Agent 属性事务栈撤销。

    save=True 保存后默认比对磁盘 XML；external_reload=True 会在保存后关闭并重新打开文档再比对，需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    params: dict[str, Any] = {"url": url, "x": x, "y": y, "save": save, "verify": verify, "externalReload": external_reload}
    if name:
        params["name"] = name
    if insert_index is not None:
        params["insertIndex"] = insert_index
    return _client.call("insert_object", params)


@mcp.tool()
def fgui_remove_object(
    object_id: str | None = None,
    object_path: str | None = None,
    object_name: str | None = None,
    save: bool = False,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """删除非根对象；需要可靠回退时使用 fgui_discard_document。

    删除按「缺失性验证」处理：save=True 保存后确认磁盘 XML 不再包含该节点；external_reload=True 关闭重开后确认目标仍不存在，需要 save=True。响应中的 strength 字段标明验证强度：reload / disk / none。
    """
    return _client.call("remove_object", {"target": _target(object_id, object_path, object_name), "save": save, "verify": verify, "externalReload": external_reload})


@mcp.tool()
def fgui_undo() -> dict[str, Any]:
    """优先撤销 Agent 属性事务；事务栈为空时回退到 FairyGUI 原生撤销。"""
    return _client.call("undo")


@mcp.tool()
def fgui_redo() -> dict[str, Any]:
    """优先重做 Agent 属性事务；事务栈为空时回退到 FairyGUI 原生重做。"""
    return _client.call("redo")


@mcp.tool()
def fgui_save_document() -> dict[str, Any]:
    """显式保存当前 FairyGUI 文档，并清空 Agent 属性事务栈。"""
    return _client.call("save_document")


@mcp.tool()
def fgui_save_all() -> dict[str, Any]:
    """显式保存所有 FairyGUI 文档、已打开包和工程，并清空 Agent 属性事务栈。"""
    return _client.call("save_all")


@mcp.tool()
def fgui_get_publish_settings(package_name: str | None = None) -> dict[str, Any]:
    """读取工程发布目录、格式、图集、代码生成和包级覆盖设置。发布前应先调用。"""
    params: dict[str, Any] = {}
    if package_name:
        params["packageName"] = package_name
    return _client.call("get_publish_settings", params)


@mcp.tool()
def fgui_analyze_atlas_fit(package_name: str | None = None) -> dict[str, Any]:
    """按图集打包器的真实约束（PackSettings / 全局 AtlasSetting）判断每张图能否入图集。

    只读，不改任何资源。返回每张图的 fit（fits / exceeds / unknown）、卡住它的约束
    （maxWidth / maxHeight / squareSide）以及与旧的大图硬编码规则的差异统计
    （disagreements）——发布时仍按旧规则标记 folderAtlas=alone，本工具只暴露差异，
    供决定是否切换。
    """
    params: dict[str, Any] = {}
    if package_name:
        params["packageName"] = package_name
    return _client.call("analyze_atlas_fit", params)


@mcp.tool()
def fgui_clear_atlas_markers(
    package_name: str,
    execute: bool = False,
    item_ids: list[str] | None = None,
    item_names: list[str] | None = None,
    close_open_documents: bool = False,
) -> dict[str, Any]:
    """清除磁盘 package.xml 中错误的 atlas="alone" 标记（只处理按真实约束装得下的图片）。

    默认只预览，execute=True 才写；可用 item_ids / item_names 限定目标。
    这是带外修改：绕过编辑器对象模型，不可撤销、不进 Agent 撤销栈。执行前会保存
    当前包并备份 package.xml，写后回读磁盘并 Dispose + 重开包。包内有未保存文档时
    直接拒绝；有已保存的打开文档时，需要显式 close_open_documents=True 才会关闭它们。

    只清除错误标记，不写任意图集归属；装不下或无法判定的 alone 标记会保留并在
    held 里说明原因。
    """
    params: dict[str, Any] = {
        "packageName": package_name,
        "execute": execute,
        "closeOpenDocuments": close_open_documents,
    }
    if item_ids is not None:
        params["itemIds"] = item_ids
    if item_names is not None:
        params["itemNames"] = item_names
    return _client.call("clear_atlas_markers", params)


@mcp.tool()
def fgui_set_publish_settings(
    package_name: str,
    settings: dict[str, Any],
    save: bool = True,
    verify: bool = True,
    external_reload: bool = False,
) -> dict[str, Any]:
    """按包写入发布与图集设置：输出路径、代码生成、图集约束（PackSettings）与排除列表。

    走**对象模型**（包级设置没有 DocElement 入口），响应里 writePath 会显式声明
    object-model：它不进组件文档的撤销栈，也不走组件的持久化验证梯子。

    只写你确实要改的字段——未提供的字段保持编辑器当前值，不会被重置。
    atlasList 是**全量替换**语义：传进来的数组就是落盘的最终列表，不做增量合并；
    省略该字段则完全不碰图集设置。packSettings 里未提供的键取编辑器新建对象的默认值。

    external_reload 是保存后关闭重开包的回读，属于**同进程**重开，不等于跨重启持久化。
    """
    params: dict[str, Any] = {
        "packageName": package_name,
        "settings": settings,
        "save": save,
        "verify": verify,
        "externalReload": external_reload,
    }
    return _client.call("set_publish_settings", params)


@mcp.tool()
def fgui_publish(
    scope: Literal["active", "packages", "all"] = "active",
    package_names: list[str] | None = None,
    branch: str | None = None,
    save_before_publish: bool = True,
    publish_desc_only: bool = False,
    timeout_seconds: float = 120,
) -> dict[str, Any]:
    """按工程发布设置导出 FairyGUI 包。默认发布当前文档所属包并先保存；可选择指定包或全部包。"""
    if timeout_seconds <= 0 or timeout_seconds > 1800:
        raise ValueError("timeout_seconds 必须在 0 到 1800 之间")
    params: dict[str, Any] = {
        "scope": scope,
        "saveBeforePublish": save_before_publish,
        "publishDescOnly": publish_desc_only,
    }
    if package_names is not None:
        params["packageNames"] = package_names
    if branch is not None:
        params["branch"] = branch
    return _client.call("publish", params, timeout=timeout_seconds)


@mcp.tool()
def fgui_discard_document() -> dict[str, Any]:
    """放弃当前文档全部未保存修改并重新加载磁盘版本。"""
    return _client.call("discard_document")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=f"FairyGUI Agent Bridge MCP {__version__}")
    parser.add_argument("--project", help=".fairy 文件、FairyGUI 工程目录或仓库目录")
    parser.add_argument("--editor", help="FairyGUI Editor .app 或可执行文件路径")
    parser.add_argument("--timeout", type=float, default=10.0, help="桥接命令超时秒数")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    configure_runtime(project=args.project, editor=args.editor, timeout=args.timeout)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
