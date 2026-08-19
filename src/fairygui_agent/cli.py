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

    import_font_parser = subparsers.add_parser("import-font", help="从本地路径导入字体")
    import_font_parser.add_argument("package_name")
    import_font_parser.add_argument("source_path")
    import_font_parser.add_argument("--folder", dest="folder_path", default="")
    import_font_parser.add_argument("--name", dest="resource_name")
    import_font_parser.add_argument(
        "--conflict",
        dest="conflict_policy",
        choices=("error", "auto_rename", "replace"),
        default="error",
    )
    import_font_parser.add_argument("--not-exported", action="store_true")
    import_font_parser.add_argument("--no-create-folders", action="store_true")
    import_font_parser.add_argument("--import-timeout", type=float, default=120.0)

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

    import_sound_parser = subparsers.add_parser("import-sound", help="从本地路径导入声音")
    import_sound_parser.add_argument("package_name")
    import_sound_parser.add_argument("source_path")
    import_sound_parser.add_argument("--folder", dest="folder_path", default="")
    import_sound_parser.add_argument("--name", dest="resource_name")
    import_sound_parser.add_argument("--conflict", dest="conflict_policy", choices=("error", "auto_rename", "replace"), default="error")
    import_sound_parser.add_argument("--not-exported", action="store_true")
    import_sound_parser.add_argument("--no-create-folders", action="store_true")
    import_sound_parser.add_argument("--import-timeout", type=float, default=120.0)

    create_movieclip_parser = subparsers.add_parser("create-movieclip", help="用有序图片序列创建 MovieClip")
    create_movieclip_parser.add_argument("package_name")
    create_movieclip_parser.add_argument("movieclip_name")
    create_movieclip_parser.add_argument("--frame", dest="frame_paths", action="append", required=True, help="按播放顺序重复传入绝对图片路径")
    create_movieclip_parser.add_argument("--folder", dest="folder_path", default="")
    create_movieclip_parser.add_argument("--fps", type=int, default=12)
    create_movieclip_parser.add_argument("--repeat-delay", type=int, default=0)
    create_movieclip_parser.add_argument("--swing", action="store_true")
    create_movieclip_parser.add_argument("--frame-delays", help="JSON 数组，每帧延迟")
    create_movieclip_parser.add_argument("--conflict", dest="conflict_policy", choices=("error", "auto_rename", "replace"), default="error")
    create_movieclip_parser.add_argument("--not-exported", action="store_true")
    create_movieclip_parser.add_argument("--no-create-folders", action="store_true")
    create_movieclip_parser.add_argument("--animation-timeout", type=float, default=120.0)

    get_movieclip_parser = subparsers.add_parser("get-movieclip", help="读取 MovieClip 设置")
    get_movieclip_parser.add_argument("url", help="MovieClip ui:// URL")
    update_movieclip_parser = subparsers.add_parser("update-movieclip", help="更新 MovieClip 设置或图片序列")
    update_movieclip_parser.add_argument("url", help="MovieClip ui:// URL")
    update_movieclip_parser.add_argument("--frame", dest="frame_paths", action="append", help="按播放顺序替换全部帧")
    update_movieclip_parser.add_argument("--fps", type=int)
    update_movieclip_parser.add_argument("--speed", type=float)
    update_movieclip_parser.add_argument("--repeat-delay", type=int)
    update_movieclip_parser.add_argument("--swing", action="store_const", const=True, default=None)
    update_movieclip_parser.add_argument("--no-swing", dest="swing", action="store_const", const=False)
    update_movieclip_parser.add_argument("--frame-delays", help="JSON 数组，每帧延迟")
    update_movieclip_parser.add_argument("--exported", action="store_const", const=True, default=None)
    update_movieclip_parser.add_argument("--not-exported", dest="exported", action="store_const", const=False)
    update_movieclip_parser.add_argument("--animation-timeout", type=float, default=120.0)
    remove_movieclip_parser = subparsers.add_parser("remove-movieclip", help="删除 MovieClip 包资源")
    remove_movieclip_parser.add_argument("url", help="MovieClip ui:// URL")
    remove_movieclip_parser.add_argument("--force", action="store_true", help="确认不可逆删除")

    subparsers.add_parser("transitions", help="列出当前组件的全部 Transition")
    get_transition_parser = subparsers.add_parser("get-transition", help="读取当前组件的一个 Transition")
    get_transition_parser.add_argument("name")
    upsert_transition_parser = subparsers.add_parser("upsert-transition", help="声明式创建或替换 Transition")
    upsert_transition_parser.add_argument("definition", help="Transition JSON 对象")
    remove_transition_parser = subparsers.add_parser("remove-transition", help="删除当前组件的 Transition")
    remove_transition_parser.add_argument("name")
    add_transition_item_parser = subparsers.add_parser("add-transition-item", help="向 Transition 添加关键帧")
    add_transition_item_parser.add_argument("name")
    add_transition_item_parser.add_argument("item", help="Transition item JSON 对象")
    update_transition_item_parser = subparsers.add_parser("update-transition-item", help="更新指定 Transition 关键帧")
    update_transition_item_parser.add_argument("name")
    update_transition_item_parser.add_argument("item_index", type=int)
    update_transition_item_parser.add_argument("item", help="Transition item JSON 对象")
    remove_transition_item_parser = subparsers.add_parser("remove-transition-item", help="删除指定 Transition 关键帧")
    remove_transition_item_parser.add_argument("name")
    remove_transition_item_parser.add_argument("item_index", type=int)

    preview_transition_parser = subparsers.add_parser("preview-transition", help="预览当前组件的 Transition，不保存")
    preview_transition_parser.add_argument("operation", choices=("play", "pause", "stop", "seek", "next", "previous", "status"))
    preview_transition_parser.add_argument("name")
    preview_transition_parser.add_argument("--document-url")
    preview_transition_parser.add_argument("--frame", type=int)
    preview_transition_parser.add_argument("--times", type=int)
    preview_transition_parser.add_argument("--delay", type=float)
    preview_transition_parser.add_argument("--start-frame", type=int)
    preview_transition_parser.add_argument("--end-frame", type=int)
    preview_movieclip_parser = subparsers.add_parser("preview-movieclip", help="预览当前组件中的 MovieClip，不保存")
    preview_movieclip_parser.add_argument("operation", choices=("play", "pause", "stop", "seek", "next", "previous", "status"))
    _add_target_arguments(preview_movieclip_parser)
    preview_movieclip_parser.add_argument("--frame", type=int)

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

    update_parser = subparsers.add_parser("update", help="从源仓库拉取最新代码并同步插件与 Skill 到工程")
    update_parser.add_argument(
        "--pull",
        action="store_true",
        help="在同步前从 Git 源仓库执行 git pull --ff-only 并更新依赖",
    )
    update_parser.add_argument("--skill-root", help="可选：安装 Skill 的目标仓库根目录")
    update_parser.add_argument("--apply", action="store_true", help="实际写入；省略时仅输出预览")

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

        if args.command == "update":
            context = locator.resolve()
            repo_root = Path(__file__).resolve().parents[2]
            if str(repo_root) not in sys.path:
                sys.path.insert(0, str(repo_root))
            try:
                from scripts.sync_to_project import perform_sync
            except ImportError:
                import importlib.util

                sync_script = repo_root / "scripts" / "sync_to_project.py"
                if not sync_script.is_file():
                    raise RuntimeError(f"未找到同步脚本：{sync_script}")
                spec = importlib.util.spec_from_file_location("sync_to_project", sync_script)
                if spec is None or spec.loader is None:
                    raise RuntimeError(f"无法加载同步脚本：{sync_script}")
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                perform_sync = mod.perform_sync

            perform_sync(
                project_value=str(context.project_file),
                skill_root_value=args.skill_root,
                apply=args.apply,
                pull=args.pull,
                repo_root=repo_root,
            )
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
        elif args.command == "import-font":
            action = "import_font"
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
        elif args.command == "import-sound":
            action = "import_sound"
            params = {
                "packageName": args.package_name,
                "sourcePath": str(Path(args.source_path).expanduser().resolve()),
                "folderPath": args.folder_path,
                "conflictPolicy": args.conflict_policy,
                "exported": not args.not_exported,
                "createFolders": not args.no_create_folders,
            }
            if args.resource_name:
                params["resourceName"] = args.resource_name
            command_timeout = args.import_timeout
        elif args.command == "create-movieclip":
            action = "create_movieclip"
            params = {
                "packageName": args.package_name,
                "movieClipName": args.movieclip_name,
                "framePaths": [str(Path(path).expanduser().resolve()) for path in args.frame_paths],
                "folderPath": args.folder_path,
                "fps": args.fps,
                "repeatDelay": args.repeat_delay,
                "swing": args.swing,
                "conflictPolicy": args.conflict_policy,
                "exported": not args.not_exported,
                "createFolders": not args.no_create_folders,
            }
            if args.frame_delays:
                params["frameDelays"] = json.loads(args.frame_delays)
            command_timeout = args.animation_timeout
        elif args.command == "get-movieclip":
            action = "get_movieclip"
            params = {"url": args.url}
        elif args.command == "update-movieclip":
            action = "update_movieclip"
            params = {"url": args.url}
            if args.frame_paths:
                params["framePaths"] = [str(Path(path).expanduser().resolve()) for path in args.frame_paths]
            for key, value in (("fps", args.fps), ("speed", args.speed), ("repeatDelay", args.repeat_delay), ("swing", args.swing), ("exported", args.exported)):
                if value is not None:
                    params[key] = value
            if args.frame_delays:
                params["frameDelays"] = json.loads(args.frame_delays)
            command_timeout = args.animation_timeout
        elif args.command == "remove-movieclip":
            action = "remove_movieclip"
            params = {"url": args.url, "force": args.force}
        elif args.command == "transitions":
            action = "list_transitions"
        elif args.command == "get-transition":
            action = "get_transition"
            params = {"name": args.name}
        elif args.command == "upsert-transition":
            action = "upsert_transition"
            definition = json.loads(args.definition)
            if not isinstance(definition, dict):
                raise ValueError("definition 必须是 JSON 对象")
            params = {"transition": definition}
        elif args.command == "remove-transition":
            action = "remove_transition"
            params = {"name": args.name}
        elif args.command == "add-transition-item":
            action = "add_transition_item"
            item = json.loads(args.item)
            if not isinstance(item, dict):
                raise ValueError("item 必须是 JSON 对象")
            params = {"name": args.name, "item": item}
        elif args.command == "update-transition-item":
            action = "update_transition_item"
            item = json.loads(args.item)
            if not isinstance(item, dict):
                raise ValueError("item 必须是 JSON 对象")
            params = {"name": args.name, "itemIndex": args.item_index, "item": item}
        elif args.command == "remove-transition-item":
            action = "remove_transition_item"
            params = {"name": args.name, "itemIndex": args.item_index}
        elif args.command == "preview-transition":
            action = "preview_animation"
            params = {"kind": "transition", "operation": args.operation, "target": {"name": args.name}}
            if args.document_url:
                params["target"]["documentUrl"] = args.document_url
            for key, value in (("frame", args.frame), ("times", args.times), ("delay", args.delay), ("startFrame", args.start_frame), ("endFrame", args.end_frame)):
                if value is not None:
                    params[key] = value
        elif args.command == "preview-movieclip":
            action = "preview_animation"
            params = {"kind": "movieclip", "operation": args.operation, "target": target_from_args(args)}
            if args.frame is not None:
                params["frame"] = args.frame
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
