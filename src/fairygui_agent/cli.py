"""FairyGUI Agent Bridge 命令行入口。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .bridge_client import BridgeClient, BridgeError
from .editor_launcher import EditorLauncher
from .project_locator import ProjectLocator


def load_json_value(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def target_from_args(args: argparse.Namespace) -> dict[str, str]:
    if getattr(args, "target_path", None):
        return {"path": args.target_path}
    if getattr(args, "target_id", None):
        return {"id": args.target_id}
    if getattr(args, "target_name", None):
        return {"name": args.target_name}
    raise ValueError("必须通过 --path、--id 或 --name 指定对象")


def print_result(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _add_target_arguments(parser: argparse.ArgumentParser) -> None:
    target_group = parser.add_mutually_exclusive_group(required=True)
    target_group.add_argument("--path", dest="target_path")
    target_group.add_argument("--id", dest="target_id")
    target_group.add_argument("--name", dest="target_name")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="通过本地队列操作 FairyGUI Editor")
    parser.add_argument("--project", help=".fairy 文件、FairyGUI 工程目录或仓库目录")
    parser.add_argument("--editor", help="FairyGUI Editor .app 或可执行文件路径")
    parser.add_argument("--timeout", type=float, default=10.0, help="命令超时秒数")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status", help="读取本地桥接心跳，不主动唤醒编辑器")
    subparsers.add_parser("ping", help="测试桥接连接")
    subparsers.add_parser("project", help="读取当前工程")
    subparsers.add_parser("packages", help="列出所有包")

    items_parser = subparsers.add_parser("items", help="列出包内资源")
    items_parser.add_argument("package_name")
    items_parser.add_argument("--type", dest="item_type")

    open_parser = subparsers.add_parser("open", help="打开组件文档")
    open_parser.add_argument("package_name")
    open_parser.add_argument("item_name")

    create_component_parser = subparsers.add_parser("create-component", help="新建组件文档")
    create_component_parser.add_argument("package_name")
    create_component_parser.add_argument("component_name")
    create_component_parser.add_argument("--width", type=float, default=800)
    create_component_parser.add_argument("--height", type=float, default=600)
    create_component_parser.add_argument("--folder", dest="folder_path", default="")
    create_component_parser.add_argument("--extension", dest="extension_id")
    create_component_parser.add_argument("--not-exported", action="store_true")
    create_component_parser.add_argument("--auto-rename", action="store_true")
    create_component_parser.add_argument("--no-create-folders", action="store_true")
    create_component_parser.add_argument("--no-open", action="store_true")

    import_image_parser = subparsers.add_parser("import-image", help="从本地路径导入图片")
    import_image_parser.add_argument("package_name")
    import_image_parser.add_argument("source_path")
    import_image_parser.add_argument("--folder", dest="folder_path", default="")
    import_image_parser.add_argument("--name", dest="resource_name")
    import_image_parser.add_argument(
        "--conflict",
        dest="conflict_policy",
        choices=("error", "auto_rename", "replace"),
        default="error",
    )
    import_image_parser.add_argument("--not-exported", action="store_true")
    import_image_parser.add_argument("--no-create-folders", action="store_true")
    import_image_parser.add_argument("--import-timeout", type=float, default=120.0)

    create_button_parser = subparsers.add_parser("create-button", help="创建标准 FairyGUI Button 组件")
    create_button_parser.add_argument("package_name")
    create_button_parser.add_argument("button_name")
    create_button_parser.add_argument("--width", type=float, default=160)
    create_button_parser.add_argument("--height", type=float, default=60)
    create_button_parser.add_argument("--folder", dest="folder_path", default="")
    create_button_parser.add_argument("--mode", choices=("common", "check", "radio"), default="common")
    create_button_parser.add_argument(
        "--image",
        dest="image_urls",
        action="append",
        help="按 up/down/over/selectedOver/disabled/selectedDisabled 顺序重复传入 ui:// 图片；空状态传空字符串",
    )
    create_button_parser.add_argument("--no-text", action="store_true")
    create_button_parser.add_argument("--no-icon", action="store_true")
    create_button_parser.add_argument("--no-relations", action="store_true")
    create_button_parser.add_argument("--as-list-item", action="store_true")
    create_button_parser.add_argument("--not-exported", action="store_true")
    create_button_parser.add_argument("--auto-rename", action="store_true")
    create_button_parser.add_argument("--no-create-folders", action="store_true")
    create_button_parser.add_argument("--no-open", action="store_true")
    create_button_parser.add_argument("--extension", dest="extension_id")

    subparsers.add_parser("active", help="读取当前文档")

    tree_parser = subparsers.add_parser("tree", help="读取当前组件对象树")
    tree_parser.add_argument("--max-depth", type=int, default=12)

    select_parser = subparsers.add_parser("select", help="选择对象")
    _add_target_arguments(select_parser)

    set_parser = subparsers.add_parser("set", help="修改对象属性")
    _add_target_arguments(set_parser)
    set_parser.add_argument("property")
    set_parser.add_argument("value", help="支持 JSON 值，例如 12、true、\"文本\"")

    insert_parser = subparsers.add_parser("insert", help="插入已有 FairyGUI 资源")
    insert_parser.add_argument("url", help="资源 URL，例如 ui://packageIditemId")
    insert_parser.add_argument("--x", type=float, default=0)
    insert_parser.add_argument("--y", type=float, default=0)
    insert_parser.add_argument("--name")
    insert_parser.add_argument("--index", type=int, dest="insert_index")

    remove_parser = subparsers.add_parser("remove", help="删除对象；保存前可用 discard 放弃修改")
    _add_target_arguments(remove_parser)

    subparsers.add_parser("save", help="保存当前文档")
    subparsers.add_parser("discard", help="放弃当前文档未保存的修改")
    subparsers.add_parser("save-all", help="保存全部文档、已打开包和工程")
    publish_settings_parser = subparsers.add_parser("publish-settings", help="读取工程和包级发布设置")
    publish_settings_parser.add_argument("package_name", nargs="?")
    publish_parser = subparsers.add_parser("publish", help="按 FairyGUI 工程发布设置导出资源")
    publish_parser.add_argument(
        "--scope",
        choices=("active", "packages", "all"),
        default="active",
        help="发布当前文档所属包、指定包或全部包",
    )
    publish_parser.add_argument("--package", dest="package_names", action="append")
    publish_parser.add_argument("--branch")
    publish_parser.add_argument("--no-save", action="store_true", help="发布前不自动保存文档和工程")
    publish_parser.add_argument("--desc-only", action="store_true", help="仅发布描述文件")
    publish_parser.add_argument("--publish-timeout", type=float, default=120.0)
    subparsers.add_parser("history", help="读取 Agent 与原生撤销状态")
    subparsers.add_parser("undo", help="撤销")
    subparsers.add_parser("redo", help="重做")

    call_parser = subparsers.add_parser("call", help="调试用：调用原始 action")
    call_parser.add_argument("action")
    call_parser.add_argument("--params", default="{}", help="JSON 对象")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    locator = ProjectLocator(args.project)
    client = BridgeClient(locator, EditorLauncher(args.editor), timeout=args.timeout)

    try:
        if args.command == "status":
            print_result(client.describe_status())
            return 0

        action = args.command
        params: dict[str, Any] = {}
        command_timeout = args.timeout

        if args.command == "project":
            action = "get_project"
        elif args.command == "packages":
            action = "list_packages"
        elif args.command == "items":
            action = "list_items"
            params = {"packageName": args.package_name}
            if args.item_type:
                params["type"] = args.item_type
        elif args.command == "open":
            action = "open_document"
            params = {"packageName": args.package_name, "itemName": args.item_name}
        elif args.command == "create-component":
            action = "create_component"
            params = {
                "packageName": args.package_name,
                "componentName": args.component_name,
                "width": args.width,
                "height": args.height,
                "folderPath": args.folder_path,
                "exported": not args.not_exported,
                "autoRename": args.auto_rename,
                "createFolders": not args.no_create_folders,
                "openAfterCreate": not args.no_open,
            }
            if args.extension_id:
                params["extensionId"] = args.extension_id
        elif args.command == "import-image":
            action = "import_image"
            source_path = str(Path(args.source_path).expanduser().resolve())
            params = {
                "packageName": args.package_name,
                "sourcePath": source_path,
                "folderPath": args.folder_path,
                "conflictPolicy": args.conflict_policy,
                "exported": not args.not_exported,
                "createFolders": not args.no_create_folders,
            }
            if args.resource_name:
                params["resourceName"] = args.resource_name
            command_timeout = args.import_timeout
        elif args.command == "create-button":
            action = "create_button"
            params = {
                "packageName": args.package_name,
                "buttonName": args.button_name,
                "width": args.width,
                "height": args.height,
                "folderPath": args.folder_path,
                "mode": args.mode,
                "imageUrls": args.image_urls or [],
                "createText": not args.no_text,
                "createIcon": not args.no_icon,
                "createRelations": not args.no_relations,
                "asListItem": args.as_list_item,
                "exported": not args.not_exported,
                "autoRename": args.auto_rename,
                "createFolders": not args.no_create_folders,
                "openAfterCreate": not args.no_open,
            }
            if args.extension_id:
                params["extensionId"] = args.extension_id
        elif args.command == "active":
            action = "get_active_document"
        elif args.command == "tree":
            action = "get_tree"
            params = {"maxDepth": args.max_depth}
        elif args.command == "select":
            action = "select_object"
            params = {"target": target_from_args(args)}
        elif args.command == "set":
            action = "set_property"
            params = {
                "target": target_from_args(args),
                "property": args.property,
                "value": load_json_value(args.value),
            }
        elif args.command == "insert":
            action = "insert_object"
            params = {"url": args.url, "x": args.x, "y": args.y}
            if args.name:
                params["name"] = args.name
            if args.insert_index is not None:
                params["insertIndex"] = args.insert_index
        elif args.command == "remove":
            action = "remove_object"
            params = {"target": target_from_args(args)}
        elif args.command == "save":
            action = "save_document"
        elif args.command == "discard":
            action = "discard_document"
        elif args.command == "save-all":
            action = "save_all"
        elif args.command == "publish-settings":
            action = "get_publish_settings"
            if args.package_name:
                params["packageName"] = args.package_name
        elif args.command == "publish":
            action = "publish"
            params = {
                "scope": args.scope,
                "saveBeforePublish": not args.no_save,
                "publishDescOnly": args.desc_only,
            }
            if args.package_names:
                params["packageNames"] = args.package_names
            if args.branch is not None:
                params["branch"] = args.branch
            command_timeout = args.publish_timeout
        elif args.command == "history":
            action = "get_history"
        elif args.command == "call":
            action = args.action
            decoded = json.loads(args.params)
            if not isinstance(decoded, dict):
                raise ValueError("--params 必须是 JSON 对象")
            params = decoded

        response = client.call_raw(action, params, timeout=command_timeout)
        print_result(response)
        return 0 if response.get("ok") else 1
    except (BridgeError, OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
