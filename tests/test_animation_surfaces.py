from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fairygui_agent import mcp_server
from fairygui_agent.bridge_client import ANIMATION_CAPABILITIES, REQUIRED_CAPABILITIES, BridgeClient, BridgeError
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
                {"name": "fade", "itemIndex": 2, "item": {"value": {"volume": 0.5}}},
                None,
            ),
        )
        self.assertEqual(fake.calls[1][0], "preview_animation")
        self.assertEqual(fake.calls[1][1]["operation"], "status")
        self.assertEqual(fake.calls[1][1]["target"]["documentUrl"], "ui://packagecomponent")

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
    def test_large_image_atlas_rule_is_compiled_into_plugin(self) -> None:
        root = Path(__file__).resolve().parents[1]
        source = (root / "plugin/main.ts").read_text(encoding="utf-8")
        generated = (root / "plugin/main.js").read_text(encoding="utf-8")
        for text in (source, generated):
            self.assertIn("LARGE_IMAGE_LONG_SIDE_MIN = 1920", text)
            self.assertIn("LARGE_IMAGE_2K_SIDE_MIN = 2048", text)
            self.assertIn('LARGE_IMAGE_ATLAS = "alone"', text)
            self.assertIn("function enforceLargeImageAtlasRule", text)
            self.assertIn("largeImageAtlasRule", text)


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
            ["upsert-transition", json.dumps({"name": "fade", "items": []})],
            ["remove-transition", "fade"],
            ["add-transition-item", "fade", json.dumps({"type": "Alpha"})],
            ["update-transition-item", "fade", "0", json.dumps({"label": "start"})],
            ["remove-transition-item", "fade", "0"],
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

    def test_version_is_synchronized(self) -> None:
        root = Path(__file__).resolve().parents[1]
        package_version = json.loads((root / "plugin/package.json").read_text(encoding="utf-8"))["version"]
        pyproject = (root / "pyproject.toml").read_text(encoding="utf-8")
        init = (root / "src/fairygui_agent/__init__.py").read_text(encoding="utf-8")
        plugin = (root / "plugin/main.ts").read_text(encoding="utf-8")
        generated = (root / "plugin/main.js").read_text(encoding="utf-8")
        self.assertEqual(package_version, "0.8.1")
        for text in (pyproject, init, plugin, generated):
            self.assertIn("0.8.1", text)

    def test_documented_mcp_tool_count_is_current(self) -> None:
        root = Path(__file__).resolve().parents[1]
        documented = (root / ".agents/skills/fgui-agent-bridge/references/current-capabilities.md").read_text(encoding="utf-8")
        tool_names = [name for name in vars(mcp_server) if name.startswith("fgui_")]
        self.assertEqual(len(tool_names), 38)
        self.assertIn("MCP 工具数：38", documented)


if __name__ == "__main__":
    unittest.main()
