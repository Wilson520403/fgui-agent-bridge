"""FairyGUI Agent Bridge 的 MCP stdio 服务。"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import __version__
from .bridge_client import BridgeClient
from .editor_launcher import EditorLauncher
from .project_locator import ProjectLocator

mcp = FastMCP(
    "FairyGUI Agent Bridge",
    instructions=(
        "先读取工程、包和对象树，再执行修改。文档属性和对象修改默认不保存；"
        "创建组件或按钮会新增包资源，导入/替换图片会写入磁盘，调用前必须确认包、目录、名称和冲突策略。"
        "结构与资源修改不能由 Agent 属性事务栈完整撤销，且图片导入不能由 fgui_discard_document 回滚。"
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
def fgui_list_items(package_name: str, item_type: str | None = None) -> list[dict[str, Any]]:
    """列出指定包中的资源，可按 FairyGUI 资源类型过滤。"""
    params: dict[str, Any] = {"packageName": package_name}
    if item_type:
        params["type"] = item_type
    return _client.call("list_items", params)


@mcp.tool()
def fgui_open_document(package_name: str, item_name: str) -> dict[str, Any]:
    """按包名和资源名打开 FairyGUI 组件文档。"""
    return _client.call("open_document", {"packageName": package_name, "itemName": item_name})


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
) -> dict[str, Any]:
    """在指定包中新建组件文档；默认打开但不保存，重名时默认拒绝。"""
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
    }
    if extension_id:
        params["extensionId"] = extension_id
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
    timeout_seconds: float = 120,
) -> dict[str, Any]:
    """从绝对本地路径导入图片；这是磁盘写入操作，支持拒绝、自动改名或替换同名图片。"""
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
    }
    if resource_name:
        params["resourceName"] = resource_name
    return _client.call("import_image", params, timeout=timeout_seconds)


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
) -> dict[str, Any]:
    """创建标准 FairyGUI Button 组件；状态图顺序为 up/down/over/selectedOver/disabled/selectedDisabled。"""
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
    }
    if extension_id:
        params["extensionId"] = extension_id
    return _client.call("create_button", params)


@mcp.tool()
def fgui_get_active_document() -> dict[str, Any]:
    """读取当前活动文档、修改状态和选择数量。"""
    return _client.call("get_active_document")


@mcp.tool()
def fgui_get_tree(max_depth: int = 12) -> dict[str, Any]:
    """读取当前组件对象树；修改前应先取得稳定的对象 ID 或路径。"""
    if max_depth < 0 or max_depth > 64:
        raise ValueError("max_depth 必须在 0 到 64 之间")
    return _client.call("get_tree", {"maxDepth": max_depth})


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
) -> dict[str, Any]:
    """修改白名单属性但不保存；该操作进入 Agent 属性 undo/redo 事务栈。"""
    return _client.call(
        "set_property",
        {
            "target": _target(object_id, object_path, object_name),
            "property": property_name,
            "value": value,
        },
    )


@mcp.tool()
def fgui_insert_object(
    url: str,
    x: float = 0,
    y: float = 0,
    name: str | None = None,
    insert_index: int | None = None,
) -> dict[str, Any]:
    """插入已有 ui:// 资源但不保存；结构操作不能由 Agent 属性事务栈撤销。"""
    params: dict[str, Any] = {"url": url, "x": x, "y": y}
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
) -> dict[str, Any]:
    """删除非根对象但不保存；需要可靠回退时使用 fgui_discard_document。"""
    return _client.call("remove_object", {"target": _target(object_id, object_path, object_name)})


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
