"""BridgeClient 队列超时语义测试（临时目录模拟插件响应，无需编辑器）。"""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

from fairygui_agent import __version__
from fairygui_agent.bridge_client import REQUIRED_CAPABILITIES, BridgeClient
from fairygui_agent.project_locator import ProjectLocator


def _write_fresh_status(queue_root: Path) -> None:
    status = {
        "online": True,
        "bridgeVersion": __version__,
        "protocolVersion": "1.0",
        "capabilities": sorted(REQUIRED_CAPABILITIES),
        "timestamp": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    (queue_root / "status.json").write_text(json.dumps(status), encoding="utf-8")


def _make_client(root: Path) -> BridgeClient:
    project_file = root / "FairyGUI.fairy"
    project_file.write_text("{}", encoding="utf-8")
    queue_root = root / ".agent"
    (queue_root / "requests").mkdir(parents=True)
    (queue_root / "responses").mkdir(parents=True)
    _write_fresh_status(queue_root)
    return BridgeClient(
        ProjectLocator(str(project_file)),
        MagicMock(),
        timeout=0.1,
        heartbeat_max_age=15.0,
        timeout_grace=0.3,
    )


class TestBridgeClientTimeout(unittest.TestCase):
    def test_timeout_cleans_unclaimed_request_and_warns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            client = _make_client(root)
            with self.assertRaisesRegex(TimeoutError, "重复执行"):
                client.call("ping")
            self.assertEqual(list((root / ".agent" / "requests").glob("*.json")), [])

    def test_late_response_within_grace_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            client = _make_client(root)

            def late_plugin() -> None:
                requests_dir = root / ".agent" / "requests"
                files: list[Path] = []
                deadline = time.monotonic() + 2.0
                while time.monotonic() < deadline:
                    files = list(requests_dir.glob("*.json"))
                    if files:
                        break
                    time.sleep(0.01)
                if not files:
                    return
                time.sleep(0.2)  # 主循环 0.1s 已超时，宽限期内送达的响应仍有效
                request = json.loads(files[0].read_text(encoding="utf-8"))
                response = {
                    "id": request["id"],
                    "ok": True,
                    "action": request["action"],
                    "result": {"late": True},
                }
                (root / ".agent" / "responses" / f"{request['id']}.json").write_text(
                    json.dumps(response), encoding="utf-8"
                )

            thread = threading.Thread(target=late_plugin)
            thread.start()
            try:
                result = client.call("ping")
            finally:
                thread.join()
            self.assertEqual(result, {"late": True})


if __name__ == "__main__":
    unittest.main()
