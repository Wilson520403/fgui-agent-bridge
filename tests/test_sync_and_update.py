"""测试同步与更新能力 (sync_to_project 与 describe_status)。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import scripts.sync_to_project as sync_mod
from fairygui_agent import __version__
from fairygui_agent.bridge_client import BridgeClient
from fairygui_agent.cli import build_parser
from fairygui_agent.project_locator import ProjectContext


class TestSyncAndUpdate(unittest.TestCase):
    def test_classify_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            src = temp_path / "src.txt"
            src.write_text("hello", encoding="utf-8")

            dest = temp_path / "dest.txt"
            entry_create = sync_mod.CopyEntry(src, dest)
            self.assertEqual(sync_mod.classify(entry_create), "CREATE")

            dest.write_text("hello", encoding="utf-8")
            entry_unchanged = sync_mod.CopyEntry(src, dest)
            self.assertEqual(sync_mod.classify(entry_unchanged), "UNCHANGED")

            dest.write_text("world", encoding="utf-8")
            entry_update = sync_mod.CopyEntry(src, dest)
            self.assertEqual(sync_mod.classify(entry_update), "UPDATE")

    def test_sync_entries_apply_and_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            src = temp_path / "main.js"
            src.write_text("console.log('v2');", encoding="utf-8")
            dest = temp_path / "target" / "main.js"

            entries = [sync_mod.CopyEntry(src, dest)]

            # Dry run: does not create file
            created, updated, unchanged, modified = sync_mod.sync_entries(
                entries, plugin_count=1, apply=False
            )
            self.assertEqual((created, updated, unchanged, modified), (1, 0, 0, True))
            self.assertFalse(dest.exists())

            # Apply: creates file
            created, updated, unchanged, modified = sync_mod.sync_entries(
                entries, plugin_count=1, apply=True
            )
            self.assertEqual((created, updated, unchanged, modified), (1, 0, 0, True))
            self.assertTrue(dest.exists())
            self.assertEqual(dest.read_text(encoding="utf-8"), "console.log('v2');")

            # Second run: unchanged
            created, updated, unchanged, modified = sync_mod.sync_entries(
                entries, plugin_count=1, apply=True
            )
            self.assertEqual((created, updated, unchanged, modified), (0, 0, 1, False))

    def test_pull_source_repository_no_git(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            success, msg = sync_mod.pull_source_repository(temp_path)
            self.assertFalse(success)
            self.assertIn("未在", msg)

    @patch("subprocess.run")
    @patch("shutil.which")
    def test_pull_source_repository_success(self, mock_which: MagicMock, mock_run: MagicMock) -> None:
        mock_which.return_value = "/usr/bin/git"
        mock_run.return_value = MagicMock(returncode=0, stdout="Already up to date.\n", stderr="")

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            (temp_path / ".git").mkdir()

            success, msg = sync_mod.pull_source_repository(temp_path)
            self.assertTrue(success)
            self.assertIn("Already up to date", msg)

    def test_describe_status_version_matching(self) -> None:
        locator = MagicMock()
        context = ProjectContext(Path("/fake/FairyGUI.fairy"))
        locator.resolve.return_value = context
        client = BridgeClient(locator)

        # 1. No status file
        with patch.object(client, "read_status", return_value=None):
            desc = client.describe_status()
            self.assertEqual(desc["bridgeClientVersion"], __version__)
            self.assertIsNone(desc["pluginVersion"])
            self.assertIsNone(desc["versionMatch"])
            self.assertNotIn("updateWarning", desc)

        # 2. Matching status version
        with patch.object(
            client,
            "read_status",
            return_value={
                "bridgeVersion": __version__,
                "protocolVersion": "1.0",
                "timestamp": "2026-08-19T00:00:00",
            },
        ):
            desc = client.describe_status()
            self.assertEqual(desc["bridgeClientVersion"], __version__)
            self.assertEqual(desc["pluginVersion"], __version__)
            self.assertTrue(desc["versionMatch"])
            self.assertNotIn("updateWarning", desc)

        # 3. Mismatched status version
        with patch.object(
            client,
            "read_status",
            return_value={
                "bridgeVersion": "0.7.0",
                "protocolVersion": "1.0",
                "timestamp": "2026-08-19T00:00:00",
            },
        ):
            desc = client.describe_status()
            self.assertEqual(desc["bridgeClientVersion"], __version__)
            self.assertEqual(desc["pluginVersion"], "0.7.0")
            self.assertFalse(desc["versionMatch"])
            self.assertIn("updateWarning", desc)

    def test_cli_update_parser(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["update", "--pull", "--apply", "--skill-root", "/fake/repo"])
        self.assertEqual(args.command, "update")
        self.assertTrue(args.pull)
        self.assertTrue(args.apply)
        self.assertEqual(args.skill_root, "/fake/repo")


if __name__ == "__main__":
    unittest.main()
