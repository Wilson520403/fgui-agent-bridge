from __future__ import annotations

import inspect
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fairygui_agent import mcp_server
from fairygui_agent.bridge_client import ANIMATION_CAPABILITIES, AUDIT_CAPABILITIES, BRANCH_CAPABILITIES, LAYOUT_CAPABILITIES, PACKAGE_ITEM_CAPABILITIES, PUBLISH_SETTINGS_CAPABILITIES, REFERENCE_CAPABILITIES, REFERENCE_REPLACE_CAPABILITIES, REQUIRED_CAPABILITIES, TRANSITION_KEYFRAME_CAPABILITIES, TRANSITION_VERIFY_CAPABILITIES, BridgeClient, BridgeError
from fairygui_agent.cli import build_parser


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, float | None]] = []

    def call(self, action: str, params: dict | None = None, *, timeout: float | None = None):
        payload = params or {}
        self.calls.append((action, payload, timeout))
        return {"action": action, "params": payload, "timeout": timeout}


class McpAnimationSurfaceTests(unittest.TestCase):
    def test_create_movieclip_maps_typed_parameters(self) -> None:
        fake = FakeClient()
        with patch.object(mcp_server, "_client", fake):
            result = mcp_server.fgui_create_movieclip(
                "ViewHub",
                "Loading",
                ["~/frames/001.png", "~/frames/002.png"],
                fps=24,
                repeat_delay=3,
                swing=True,
                frame_delays=[0, 2],
                conflict_policy="replace",
            )
        self.assertEqual(result["action"], "create_movieclip")
        action, params, timeout = fake.calls[-1]
        self.assertEqual(action, "create_movieclip")
        self.assertEqual(params["movieClipName"], "Loading")
        self.assertEqual(params["fps"], 24)
        self.assertEqual(params["repeatDelay"], 3)
        self.assertEqual(params["frameDelays"], [0, 2])
        self.assertTrue(all(Path(path).is_absolute() for path in params["framePaths"]))
        self.assertEqual(timeout, 120)

    def test_movieclip_validation_rejects_invalid_ranges_and_empty_update(self) -> None:
        with self.assertRaisesRegex(ValueError, "frame_delays"):
            mcp_server.fgui_create_movieclip("Pkg", "Clip", ["a.png", "b.png"], frame_delays=[0])
        with self.assertRaisesRegex(ValueError, "repeat_delay"):
            mcp_server.fgui_create_movieclip("Pkg", "Clip", ["a.png"], repeat_delay=256)
        with self.assertRaisesRegex(ValueError, "至少需要提供一个"):
            mcp_server.fgui_update_movieclip(url="ui://packageitem")
        with self.assertRaisesRegex(ValueError, "speed"):
            mcp_server.fgui_update_movieclip(url="ui://packageitem", speed=0)

    def test_transition_and_preview_parameter_mapping(self) -> None:
        fake = FakeClient()
        with patch.object(mcp_server, "_client", fake):
            mcp_server.fgui_update_transition_item("fade", 2, {"value": {"volume": 0.5}})
            mcp_server.fgui_preview_animation(
                "transition",
                "status",
                name="fade",
                document_url="ui://packagecomponent",
            )
        self.assertEqual(
            fake.calls[0],
            (
                "update_transition_item",
                {"name": "fade", "itemIndex": 2, "item": {"value": {"volume": 0.5}}, "save": False, "verify": True, "externalReload": False},
                None,
            ),
        )
        self.assertEqual(fake.calls[1][0], "preview_animation")
        self.assertEqual(fake.calls[1][1]["operation"], "status")
        self.assertEqual(fake.calls[1][1]["target"]["documentUrl"], "ui://packagecomponent")

    def test_verify_transition_maps_read_only_parameters(self) -> None:
        fake = FakeClient()
        with patch.object(mcp_server, "_client", fake):
            mcp_server.fgui_verify_transition()
            mcp_server.fgui_verify_transition("fade", check_bounds=False)
        self.assertEqual(fake.calls[0], ("verify_transition", {"checkBounds": True}, None))
        self.assertEqual(fake.calls[1], ("verify_transition", {"checkBounds": False, "name": "fade"}, None))

    def test_keyframe_write_parameter_mapping(self) -> None:
        fake = FakeClient()
        with patch.object(mcp_server, "_client", fake):
            mcp_server.fgui_add_keyframes("fade", [{"targetId": "n1", "type": "Alpha", "frame": 10}])
            mcp_server.fgui_set_keyframe("fade", {"label": "mid"}, item_index=1)
            mcp_server.fgui_set_keyframe("fade", {"frame": 12}, target_id="n1", track_type="Alpha", frame=10)
            mcp_server.fgui_duplicate_transition("fade", new_name="fadeCopy")
        self.assertEqual(
            fake.calls[0],
            (
                "add_keyframes",
                {"name": "fade", "keyframes": [{"targetId": "n1", "type": "Alpha", "frame": 10}], "save": False, "verify": True, "externalReload": False},
                None,
            ),
        )
        self.assertEqual(fake.calls[1][1], {"name": "fade", "changes": {"label": "mid"}, "itemIndex": 1, "save": False, "verify": True, "externalReload": False})
        self.assertEqual(
            fake.calls[2][1],
            {"name": "fade", "changes": {"frame": 12}, "type": "Alpha", "frame": 10, "targetId": "n1", "save": False, "verify": True, "externalReload": False},
        )
        self.assertEqual(fake.calls[3][1], {"name": "fade", "newName": "fadeCopy", "save": False, "verify": True, "externalReload": False})

    def test_keyframe_input_validation_rejects_ambiguous_or_empty_requests(self) -> None:
        with self.assertRaisesRegex(ValueError, "keyframes 不能为空"):
            mcp_server.fgui_add_keyframes("fade", [])
        with self.assertRaisesRegex(ValueError, "changes 至少需要一个字段"):
            mcp_server.fgui_set_keyframe("fade", {}, item_index=0)
        with self.assertRaisesRegex(ValueError, "不能与"):
            mcp_server.fgui_set_keyframe("fade", {"label": "x"}, item_index=0, target_id="n1", track_type="Alpha", frame=0)
        with self.assertRaisesRegex(ValueError, "必须提供 item_index"):
            mcp_server.fgui_set_keyframe("fade", {"label": "x"})

    def test_legacy_plugin_only_fails_when_animation_action_is_used(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = BridgeClient.__new__(BridgeClient)
            context = SimpleNamespace(queue_root=Path(directory), project_file=Path(directory) / "FairyGUI.fairy")
            client.project_context = lambda: context
            client.ensure_ready = lambda: {
                "protocolVersion": "1.0",
                "bridgeVersion": "0.7.0",
                "capabilities": sorted(REQUIRED_CAPABILITIES),
            }
            with self.assertRaisesRegex(BridgeError, "缺少动画能力.*list_transitions"):
                client.call_raw("list_transitions")


class LargeImageAtlasSurfaceTests(unittest.TestCase):
    def test_atlas_assignment_judges_by_pack_settings_not_by_retired_constants(self) -> None:
        root = Path(__file__).resolve().parents[1]
        source = (root / "plugin/main.ts").read_text(encoding="utf-8")
        generated = (root / "plugin/main.js").read_text(encoding="utf-8")
        for text in (source, generated):
            # 退役常量仍在，但只作诊断对照；判定入口换成真实约束。
            self.assertIn("RETIRED_LARGE_IMAGE_LONG_SIDE_MIN = 1920", text)
            self.assertIn('ALONE_ATLAS = "alone"', text)
            self.assertIn("function decideAtlasAssignment", text)
            self.assertIn("function applyAtlasAssignmentRule", text)
            self.assertIn("function enforceAtlasAssignmentRule", text)
            # 旧的尺寸常量判定函数必须真的消失，而不是换个名字继续用。
            self.assertNotIn("isLargeImageDimensions", text)
            self.assertNotIn("function applyLargeImageAtlasRule", text)

    def test_the_write_path_reads_the_atlas_marker_from_disk(self) -> None:
        # 真机 6.1.4：folderAtlas 写盘保留、重启后内存回到空串。幂等守卫读内存值的话，
        # 重启后每次 publish 都会重复施加。这里钉住磁盘口径是唯一判据。
        root = Path(__file__).resolve().parents[1]
        source = (root / "plugin/main.ts").read_text(encoding="utf-8")
        self.assertIn("persistedAtlasByItemId(pkg)", source)
        self.assertIn("folderAtlasSource: \"package.xml\"", source)
        self.assertIn("usedByWritePath: true", source)

    def test_the_report_discloses_that_the_retired_rule_is_gone(self) -> None:
        # 文档/响应若还说「publish 时生效」，使用者会以为旧规则仍在改真实工程。
        root = Path(__file__).resolve().parents[1]
        source = (root / "plugin/main.ts").read_text(encoding="utf-8")
        self.assertIn('retiredIn: "0.8.14"', source)
        self.assertIn("stillAppliedOnPublish: false", source)
        self.assertIn("alsoAppliedOnImport: false", source)

    def test_publish_reports_unnecessary_and_unknown_markers_instead_of_hiding_them(self) -> None:
        # aloneNotNeeded / unknown 是「看了但没动手」。只回 assigned 的话，
        # 「磁盘上有 3 个多余标记、2 个判不出来」这类事实会被静默吞掉。
        root = Path(__file__).resolve().parents[1]
        source = (root / "plugin/main.ts").read_text(encoding="utf-8")
        self.assertIn("aloneNotNeededCount: atlasAssignment.aloneNotNeeded.length", source)
        self.assertIn("unknownCount: atlasAssignment.unknown.length", source)
        self.assertIn('rule: "packer-constraints"', source)


class CliAnimationSurfaceTests(unittest.TestCase):
    def test_parser_exposes_all_animation_commands(self) -> None:
        parser = build_parser()
        cases = [
            ["import-sound", "Pkg", "/tmp/tone.wav"],
            ["create-movieclip", "Pkg", "Loading", "--frame", "/tmp/1.png"],
            ["get-movieclip", "ui://packageitem"],
            ["update-movieclip", "ui://packageitem", "--fps", "30"],
            ["remove-movieclip", "ui://packageitem", "--force"],
            ["transitions"],
            ["get-transition", "fade"],
            ["verify-transition", "fade", "--no-bounds"],
            ["upsert-transition", json.dumps({"name": "fade", "items": []})],
            ["remove-transition", "fade"],
            ["add-transition-item", "fade", json.dumps({"type": "Alpha"})],
            ["update-transition-item", "fade", "0", json.dumps({"label": "start"})],
            ["remove-transition-item", "fade", "0"],
            ["add-keyframes", "fade", json.dumps([{"type": "Alpha", "frame": 10}])],
            ["set-keyframe", "fade", json.dumps({"label": "mid"}), "--item-index", "1"],
            ["set-keyframe", "fade", json.dumps({"frame": 12}), "--target-id", "n1", "--type", "Alpha", "--frame", "10"],
            ["duplicate-transition", "fade", "--new-name", "fadeCopy"],
            ["preview-transition", "status", "fade"],
            ["preview-movieclip", "status", "--id", "n0"],
        ]
        parsed = [parser.parse_args(case).command for case in cases]
        self.assertEqual(len(parsed), len(cases))


class CapabilityConsistencyTests(unittest.TestCase):
    def test_animation_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in ANIMATION_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_layout_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in LAYOUT_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_package_item_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        parser = build_parser()
        for action in PACKAGE_ITEM_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_package_item_cli_subcommands_exist(self) -> None:
        parser = build_parser()
        actions = [action for action in parser._actions if hasattr(action, "choices") and action.choices]
        commands = set(actions[0].choices)
        for command in ("delete-item", "rename-item", "move-item", "duplicate-item"):
            self.assertIn(command, commands)

    def test_documented_mcp_tool_count_is_current(self) -> None:
        root = Path(__file__).resolve().parents[1]
        documented = (root / ".agents/skills/fgui-agent-bridge/references/current-capabilities.md").read_text(encoding="utf-8")
        tool_names = [name for name in vars(mcp_server) if name.startswith("fgui_")]
        self.assertEqual(len(tool_names), 69)
        self.assertIn("MCP 工具数：69", documented)

    def test_branch_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in BRANCH_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_transition_verify_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in TRANSITION_VERIFY_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)
        # 只读校验不能混进 0.8.1 的动画能力集，否则旧插件的缺失提示会报错最低版本。
        self.assertEqual(TRANSITION_VERIFY_CAPABILITIES & ANIMATION_CAPABILITIES, frozenset())

    def test_keyframe_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in TRANSITION_KEYFRAME_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)
        # 写侧能力不能并进 0.8.1 动画集或 0.8.15 只读校验集：
        # 否则旧插件的缺失提示会把最低版本说错。
        self.assertEqual(TRANSITION_KEYFRAME_CAPABILITIES & ANIMATION_CAPABILITIES, frozenset())
        self.assertEqual(TRANSITION_KEYFRAME_CAPABILITIES & TRANSITION_VERIFY_CAPABILITIES, frozenset())

    def test_keyframe_writes_are_blocked_during_publish(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        blocked = plugin.split("actionsBlockedDuringPublish:")[1].split("};")[0]
        for action in TRANSITION_KEYFRAME_CAPABILITIES:
            self.assertIn(f"{action}: true", blocked)

    def test_keyframe_writes_enter_the_timeline_and_restore_the_playhead(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        timeline = plugin.split("function withTransitionTimeline(")[1].split("function applyKeyFrameValue(")[0]
        self.assertIn("doc.EnterTimelineMode(transitionName)", timeline)
        self.assertIn("doc.head = previousHead", timeline)
        self.assertIn("doc.ExitTimelineMode()", timeline)
        for action in ("addKeyFrames", "setKeyframe", "duplicateTransition"):
            body = plugin.split(f"function {action}(")[1].split("\nfunction ")[0]
            self.assertIn("withTransitionTimeline(doc", body, action)

    def test_duplicate_transition_renames_after_the_runtime_quirk(self) -> None:
        # 6.1.4 实测 DuplicateTransition 忽略第二个参数，副本名落成 null；
        # 实现必须复制后经文档模型改名，不能相信声明里的 newInstanceName。
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        body = plugin.split("function duplicateTransition(")[1].split("\nfunction ")[0]
        self.assertIn("doc.DuplicateTransition(sourceName)", body)
        self.assertIn('doc.SetTransitionProperty(copy, "name", requestedName)', body)

    def test_verify_transition_is_read_only_in_every_layer(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        body = plugin.split("function verifyTransition(")[1].split("function validateTransitionTarget")[0]
        self.assertIn("readOnly: true", body)
        self.assertNotIn("SetModified", body)
        self.assertNotIn("doc.Save(", body)
        signature = inspect.signature(mcp_server.fgui_verify_transition)
        self.assertNotIn("save", signature.parameters)
        self.assertNotIn("external_reload", signature.parameters)
        parsed = build_parser().parse_args(["verify-transition", "fade"])
        self.assertFalse(hasattr(parsed, "save"))
        self.assertFalse(hasattr(parsed, "external_reload"))

    def test_reference_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in REFERENCE_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_reference_replace_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in REFERENCE_REPLACE_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)
        # 写侧能力集不能混进只读集合：否则缺失提示会沿用 0.8.10 的说法。
        self.assertEqual(REFERENCE_REPLACE_CAPABILITIES & REFERENCE_CAPABILITIES, frozenset())

    def test_publish_settings_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in PUBLISH_SETTINGS_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)

    def test_publish_settings_write_is_blocked_during_publish(self) -> None:
        """发布期间改图集约束会让本次导出用一半旧一半新的设置，必须封锁。"""
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        blocked = plugin.split("actionsBlockedDuringPublish:")[1].split("};")[0]
        self.assertIn("set_publish_settings: true", blocked)

    def test_publish_settings_write_declares_object_model_and_rejects_sizeoption(self) -> None:
        """包级设置没有 DocElement 入口：写路径必须自称 object-model，且 sizeOption
        是读侧投影，写回它会静默丢失，必须在任何改动之前拒绝。"""
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        body = plugin.split("function setPublishSettings(")[1]
        self.assertIn("WRITE_PATH_MODEL", body)
        self.assertIn("sizeOption", plugin)
        harness = (root / "tests/p0_host_harness.cjs").read_text(encoding="utf-8")
        self.assertIn("sizeOption is a read-side projection", harness)

    def test_reference_replace_is_preview_first_and_blocked_during_publish(self) -> None:
        """原生替换立即落盘、不可撤销：默认必须只预览，发布期间必须封锁。"""
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        blocked_during_publish = plugin.split("actionsBlockedDuringPublish:")[1].split("};")[0]
        self.assertIn("replace_references: true", blocked_during_publish)

        parser = build_parser()
        parsed = parser.parse_args(["replace-references", "ui://pkgold", "--new-url", "ui://pkgnew"])
        self.assertFalse(parsed.execute, "缺省必须是预览，不能默认执行")

    def test_reference_queries_are_read_only_in_every_layer(self) -> None:
        """只读语义必须在四层同时成立：插件不写、CLI 不带 save、MCP 不带写参数、能力集不与写动作混淆。"""
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        blocked_during_publish = plugin.split("actionsBlockedDuringPublish:")[1].split("};")[0]
        parser = build_parser()
        for action in REFERENCE_CAPABILITIES:
            self.assertNotIn(f"{action}: true", blocked_during_publish)
        for command in ("references", "dependencies"):
            parsed = parser.parse_args([command, "ui://pkgitem"])
            self.assertFalse(hasattr(parsed, "save"))
            self.assertFalse(hasattr(parsed, "external_reload"))
        signature = inspect.signature(mcp_server.fgui_query_references)
        self.assertNotIn("save", signature.parameters)
        self.assertNotIn("external_reload", signature.parameters)

    def test_audit_capabilities_match_plugin_dispatch_and_mcp_functions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        for action in AUDIT_CAPABILITIES:
            self.assertIn(f'"{action}"', plugin)
            self.assertIn(f'case "{action}"', plugin)
            self.assertTrue(hasattr(mcp_server, f"fgui_{action}"), action)
        self.assertEqual(AUDIT_CAPABILITIES & REFERENCE_REPLACE_CAPABILITIES, frozenset())
        blocked_during_publish = plugin.split("actionsBlockedDuringPublish:")[1].split("};")[0]
        for action in AUDIT_CAPABILITIES:
            self.assertNotIn(f"{action}: true", blocked_during_publish)


if __name__ == "__main__":
    unittest.main()
