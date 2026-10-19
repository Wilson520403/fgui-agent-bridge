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


def _add_write_verify_arguments(parser: argparse.ArgumentParser, *, external_reload: bool = False) -> None:
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--no-verify", action="store_true")
    if external_reload:
        parser.add_argument(
            "--external-reload",
            action="store_true",
            help="保存后执行重载验证：文档写操作关闭重开文档比对，包资源写操作卸载并重新加载 asset（需 --save）",
        )


def _write_verify_params(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "save": args.save,
        "verify": not args.no_verify,
        "externalReload": getattr(args, "external_reload", False),
    }


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
    _add_write_verify_arguments(create_component_parser)

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
    _add_write_verify_arguments(import_image_parser, external_reload=True)

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
    _add_write_verify_arguments(import_font_parser, external_reload=True)

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
    _add_write_verify_arguments(create_button_parser)

    import_sound_parser = subparsers.add_parser("import-sound", help="从本地路径导入声音")
    import_sound_parser.add_argument("package_name")
    import_sound_parser.add_argument("source_path")
    import_sound_parser.add_argument("--folder", dest="folder_path", default="")
    import_sound_parser.add_argument("--name", dest="resource_name")
    import_sound_parser.add_argument("--conflict", dest="conflict_policy", choices=("error", "auto_rename", "replace"), default="error")
    import_sound_parser.add_argument("--not-exported", action="store_true")
    import_sound_parser.add_argument("--no-create-folders", action="store_true")
    import_sound_parser.add_argument("--import-timeout", type=float, default=120.0)
    _add_write_verify_arguments(import_sound_parser, external_reload=True)

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
    _add_write_verify_arguments(create_movieclip_parser, external_reload=True)

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
    _add_write_verify_arguments(update_movieclip_parser, external_reload=True)
    remove_movieclip_parser = subparsers.add_parser("remove-movieclip", help="删除 MovieClip 包资源")
    remove_movieclip_parser.add_argument("url", help="MovieClip ui:// URL")
    remove_movieclip_parser.add_argument("--force", action="store_true", help="确认不可逆删除")
    _add_write_verify_arguments(remove_movieclip_parser)

    subparsers.add_parser("transitions", help="列出当前组件的全部 Transition")
    get_transition_parser = subparsers.add_parser("get-transition", help="读取当前组件的一个 Transition")
    get_transition_parser.add_argument("name")
    upsert_transition_parser = subparsers.add_parser("upsert-transition", help="声明式创建或替换 Transition")
    upsert_transition_parser.add_argument("definition", help="Transition JSON 对象")
    _add_write_verify_arguments(upsert_transition_parser, external_reload=True)
    remove_transition_parser = subparsers.add_parser("remove-transition", help="删除当前组件的 Transition")
    remove_transition_parser.add_argument("name")
    _add_write_verify_arguments(remove_transition_parser, external_reload=True)
    add_transition_item_parser = subparsers.add_parser("add-transition-item", help="向 Transition 添加关键帧")
    add_transition_item_parser.add_argument("name")
    add_transition_item_parser.add_argument("item", help="Transition item JSON 对象")
    _add_write_verify_arguments(add_transition_item_parser, external_reload=True)
    update_transition_item_parser = subparsers.add_parser("update-transition-item", help="更新指定 Transition 关键帧")
    update_transition_item_parser.add_argument("name")
    update_transition_item_parser.add_argument("item_index", type=int)
    update_transition_item_parser.add_argument("item", help="Transition item JSON 对象")
    _add_write_verify_arguments(update_transition_item_parser, external_reload=True)
    remove_transition_item_parser = subparsers.add_parser("remove-transition-item", help="删除指定 Transition 关键帧")
    remove_transition_item_parser.add_argument("name")
    remove_transition_item_parser.add_argument("item_index", type=int)
    _add_write_verify_arguments(remove_transition_item_parser, external_reload=True)

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
    set_parser.add_argument("--save", action="store_true")
    set_parser.add_argument("--no-verify", action="store_true")
    set_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    resource_parser = subparsers.add_parser("replace-object-resource", help="替换对象资源引用")
    _add_target_arguments(resource_parser)
    resource_parser.add_argument("resource_url")
    resource_parser.add_argument("--expected-type", default="image")
    resource_parser.add_argument("--state")
    resource_parser.add_argument("--save", action="store_true")
    resource_parser.add_argument("--no-verify", action="store_true")
    resource_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    # P8-2 引用图（只读）。不带 --save / --verify 语义：这两条命令不写任何东西。
    references_parser = subparsers.add_parser("references", help="查询哪些资源引用了目标资源（只读）")
    references_parser.add_argument("url", help="目标资源的 ui:// URL")
    references_parser.add_argument("--max-items", type=int, help=f"最多返回条数（默认 200，上限 2000）")
    references_parser.add_argument("--skip-package-open", action="store_true", help="不预先打开未打开的包；更快，但可能少算未打开包里的引用")
    dependencies_parser = subparsers.add_parser("dependencies", help="查询目标资源依赖了哪些资源（只读）")
    dependencies_parser.add_argument("url", help="目标资源的 ui:// URL")
    dependencies_parser.add_argument("--seek-level", choices=["selection", "samePackageButNotExported", "samePackage", "all"], default="samePackage", help="依赖搜索范围，默认 samePackage")
    dependencies_parser.add_argument("--max-items", type=int, help="最多返回条数（默认 200，上限 2000）")
    dependencies_parser.add_argument("--skip-package-open", action="store_true", help="不预先打开未打开的包；更快，但可能少算未打开包里的引用")

    text_get_parser = subparsers.add_parser("get-text-style", help="读取文本样式")
    _add_target_arguments(text_get_parser)
    text_set_parser = subparsers.add_parser("set-text-style", help="设置文本样式")
    _add_target_arguments(text_set_parser)
    text_set_parser.add_argument("style", help="文本样式 JSON 对象")
    text_set_parser.add_argument("--save", action="store_true")
    text_set_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")
    verify_parser = subparsers.add_parser("verify-document", help="验证当前文档")
    verify_parser.add_argument("--max-depth", type=int, default=12)
    verify_parser.add_argument("--path")
    verify_parser.add_argument("--id")
    verify_parser.add_argument("--name")
    verify_parser.add_argument("--expected", help="预期属性 JSON 对象；含 children 时执行对象树比对且可省略 target（默认根组件）")
    verify_parser.add_argument("--editor-only", action="store_true", help="只比对 Editor，不读取 XML")
    verify_parser.add_argument("--external-reload", action="store_true", help="关闭并重新打开文档再比对；要求文档已保存，本命令不会保存")

    insert_parser = subparsers.add_parser("insert", help="插入已有 FairyGUI 资源")
    insert_parser.add_argument("url", help="资源 URL，例如 ui://packageIditemId")
    insert_parser.add_argument("--x", type=float, default=0)
    insert_parser.add_argument("--y", type=float, default=0)
    insert_parser.add_argument("--name")
    insert_parser.add_argument("--index", type=int, dest="insert_index")
    insert_parser.add_argument("--save", action="store_true")
    insert_parser.add_argument("--no-verify", action="store_true")
    insert_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    remove_parser = subparsers.add_parser("remove", help="删除对象；保存前可用 discard 放弃修改")
    _add_target_arguments(remove_parser)
    remove_parser.add_argument("--save", action="store_true")
    remove_parser.add_argument("--no-verify", action="store_true")
    remove_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认目标在重载后仍不存在（需 --save）")

    list_layout_parser = subparsers.add_parser("set-list-layout", help="修改 List 布局属性（layout/gap/defaultItem/align/overflow 等）")
    _add_target_arguments(list_layout_parser)
    list_layout_parser.add_argument("fields", help="布局字段 JSON 对象，如 {\"layout\":\"flow_vertical\",\"lineGap\":8}")
    list_layout_parser.add_argument("--save", action="store_true")
    list_layout_parser.add_argument("--no-verify", action="store_true")
    list_layout_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    group_layout_parser = subparsers.add_parser("set-group-layout", help="修改 Group 布局属性（advanced/layout/gap/excludeInvisibles 等）")
    _add_target_arguments(group_layout_parser)
    group_layout_parser.add_argument("fields", help="布局字段 JSON 对象，如 {\"advanced\":true,\"layout\":\"vt\",\"lineGap\":12}")
    group_layout_parser.add_argument("--save", action="store_true")
    group_layout_parser.add_argument("--no-verify", action="store_true")
    group_layout_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    relation_parser = subparsers.add_parser("set-relation", help="整体替换对象 Relation 绑定")
    _add_target_arguments(relation_parser)
    relation_parser.add_argument("relations", help="JSON 数组，如 [{\"target\":{\"id\":\"n1\"},\"sidePair\":\"right-right\"}]；target 省略表示父组件")
    relation_parser.add_argument("--save", action="store_true")
    relation_parser.add_argument("--no-verify", action="store_true")
    relation_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    gear_parser = subparsers.add_parser("set-gear-display", help="设置对象 gearDisplay 联动（控制器 + 页面）")
    _add_target_arguments(gear_parser)
    gear_parser.add_argument("--controller", help="控制器名；空字符串清除联动", required=True)
    gear_parser.add_argument("--pages", help="页面 id 或名称，逗号分隔或 JSON 数组；省略保持不变")
    gear_parser.add_argument("--save", action="store_true")
    gear_parser.add_argument("--no-verify", action="store_true")
    gear_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

    subparsers.add_parser("controllers", help="列出当前组件的全部 Controller")

    controller_parser = subparsers.add_parser("set-controller", help="创建、修改或删除当前组件的 Controller")
    controller_parser.add_argument("name")
    controller_parser.add_argument("--pages", help="页面名 JSON 数组，整体替换页面集（会重新分配页面 id）")
    controller_parser.add_argument("--add-pages", help="页面名 JSON 数组，追加到页面集")
    controller_parser.add_argument("--selected-index", type=int)
    controller_parser.add_argument("--selected-page")
    controller_parser.add_argument("--exported", help="true/false")
    controller_parser.add_argument("--auto-radio-group-depth", help="true/false")
    controller_parser.add_argument("--home-page")
    controller_parser.add_argument("--create", action="store_true", help="控制器不存在时创建")
    controller_parser.add_argument("--remove", action="store_true", help="删除控制器")
    controller_parser.add_argument("--save", action="store_true")
    controller_parser.add_argument("--no-verify", action="store_true")
    controller_parser.add_argument("--external-reload", action="store_true", help="保存后关闭并重新打开文档再比对，确认真实持久化（需 --save）")

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
                **_write_verify_params(args),
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
                **_write_verify_params(args),
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
                **_write_verify_params(args),
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
                **_write_verify_params(args),
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
                **_write_verify_params(args),
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
                **_write_verify_params(args),
            }
            if args.frame_delays:
                params["frameDelays"] = json.loads(args.frame_delays)
            command_timeout = args.animation_timeout
        elif args.command == "get-movieclip":
            action = "get_movieclip"
            params = {"url": args.url}
        elif args.command == "update-movieclip":
            action = "update_movieclip"
            params = {"url": args.url, **_write_verify_params(args)}
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
            params = {"url": args.url, "force": args.force, **_write_verify_params(args)}
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
            params = {"transition": definition, **_write_verify_params(args)}
        elif args.command == "remove-transition":
            action = "remove_transition"
            params = {"name": args.name, **_write_verify_params(args)}
        elif args.command == "add-transition-item":
            action = "add_transition_item"
            item = json.loads(args.item)
            if not isinstance(item, dict):
                raise ValueError("item 必须是 JSON 对象")
            params = {"name": args.name, "item": item, **_write_verify_params(args)}
        elif args.command == "update-transition-item":
            action = "update_transition_item"
            item = json.loads(args.item)
            if not isinstance(item, dict):
                raise ValueError("item 必须是 JSON 对象")
            params = {"name": args.name, "itemIndex": args.item_index, "item": item, **_write_verify_params(args)}
        elif args.command == "remove-transition-item":
            action = "remove_transition_item"
            params = {"name": args.name, "itemIndex": args.item_index, **_write_verify_params(args)}
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
        elif args.command == "replace-object-resource":
            action = "replace_object_resource"
            params = {"target": target_from_args(args), "resourceURL": args.resource_url, "expectedType": args.expected_type, "verify": not args.no_verify, "save": args.save, "externalReload": args.external_reload}
            if args.state: params["state"] = args.state
        elif args.command == "references":
            action = "query_references"
            params = {"url": args.url, "skipPackageOpen": args.skip_package_open}
            if args.max_items is not None: params["maxItems"] = args.max_items
        elif args.command == "dependencies":
            action = "query_dependencies"
            params = {"url": args.url, "seekLevel": args.seek_level, "skipPackageOpen": args.skip_package_open}
            if args.max_items is not None: params["maxItems"] = args.max_items
        elif args.command == "get-text-style":
            action = "get_text_style"
            params = {"target": target_from_args(args)}
        elif args.command == "set-text-style":
            action = "set_text_style"
            params = {"target": target_from_args(args), "style": load_json_value(args.style), "save": args.save, "verify": True, "externalReload": args.external_reload}
        elif args.command == "verify-document":
            action = "verify_document"
            params = {"maxDepth": args.max_depth, "readXml": not args.editor_only, "externalReload": args.external_reload}
            if args.expected is not None:
                expected_value = load_json_value(args.expected)
                is_tree = isinstance(expected_value, dict) and any(k in expected_value for k in ("children", "childrenMode", "index"))
                if not any((args.path, args.id, args.name)) and not is_tree:
                    raise ValueError("--expected 必须指定目标；含 children 的树结构比对可省略 target（默认根组件）")
                params["expected"] = expected_value
            target = {k: v for k, v in (("path", args.path), ("id", args.id), ("name", args.name)) if v}
            if len(target) > 1: raise ValueError("verify-document 的 target 参数只能提供一个")
            if target: params["target"] = target
        elif args.command == "set":
            action = "set_property"
            params = {
                "target": target_from_args(args),
                "property": args.property,
                "value": load_json_value(args.value),
                "save": args.save,
                "verify": not args.no_verify,
                "externalReload": args.external_reload,
            }
        elif args.command == "insert":
            action = "insert_object"
            params = {"url": args.url, "x": args.x, "y": args.y, "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
            if args.name:
                params["name"] = args.name
            if args.insert_index is not None:
                params["insertIndex"] = args.insert_index
        elif args.command == "remove":
            action = "remove_object"
            params = {"target": target_from_args(args), "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
        elif args.command == "set-list-layout":
            action = "set_list_layout"
            params = {"target": target_from_args(args), "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
            params.update(load_json_value(args.fields))
        elif args.command == "set-group-layout":
            action = "set_group_layout"
            params = {"target": target_from_args(args), "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
            params.update(load_json_value(args.fields))
        elif args.command == "set-relation":
            action = "set_relation"
            params = {"target": target_from_args(args), "relations": load_json_value(args.relations), "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
        elif args.command == "set-gear-display":
            action = "set_gear_display"
            params = {"target": target_from_args(args), "controller": args.controller, "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
            if args.pages is not None:
                params["pages"] = load_json_value(args.pages)
        elif args.command == "controllers":
            action = "list_controllers"
        elif args.command == "set-controller":
            action = "set_controller"
            params = {"name": args.name, "create": args.create, "remove": args.remove, "save": args.save, "verify": not args.no_verify, "externalReload": args.external_reload}
            if args.pages is not None:
                params["pages"] = load_json_value(args.pages)
            if args.add_pages is not None:
                params["addPages"] = load_json_value(args.add_pages)
            for key, value in (("selectedIndex", args.selected_index), ("selectedPage", args.selected_page), ("homePage", args.home_page)):
                if value is not None:
                    params[key] = value
            for key, value in (("exported", args.exported), ("autoRadioGroupDepth", args.auto_radio_group_depth)):
                if value is not None:
                    params[key] = bool(load_json_value(value))
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
