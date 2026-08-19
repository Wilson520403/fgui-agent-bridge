"""FairyGUI Editor JSON 文件队列客户端。"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from . import PROTOCOL_VERSION, __version__
from .editor_launcher import EditorLauncher
from .project_locator import ProjectContext, ProjectLocator

REQUIRED_CAPABILITIES = frozenset(
    {
        "ping",
        "get_project",
        "list_packages",
        "list_items",
        "open_document",
        "create_component",
        "import_image",
        "import_font",
        "create_button",
        "get_active_document",
        "get_tree",
        "select_object",
        "set_property",
        "insert_object",
        "remove_object",
        "save_document",
        "save_all",
        "get_publish_settings",
        "publish",
        "get_history",
        "discard_document",
        "undo",
        "redo",
    }
)

ANIMATION_CAPABILITIES = frozenset(
    {
        "import_sound",
        "create_movieclip",
        "get_movieclip",
        "update_movieclip",
        "remove_movieclip",
        "list_transitions",
        "get_transition",
        "upsert_transition",
        "remove_transition",
        "add_transition_item",
        "update_transition_item",
        "remove_transition_item",
        "preview_animation",
    }
)


class BridgeError(RuntimeError):
    """桥接器连接、协议或命令错误。"""


class BridgeCommandError(BridgeError):
    """FairyGUI Editor 返回的业务错误。"""

    def __init__(self, action: str, message: str) -> None:
        super().__init__(f"{action} 失败：{message}")
        self.action = action
        self.bridge_message = message


def status_age(status: dict[str, Any] | None) -> float:
    if status is None:
        return float("inf")
    try:
        timestamp = str(status["timestamp"])
        heartbeat = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
        return max(0.0, time.time() - heartbeat)
    except (KeyError, TypeError, ValueError):
        return float("inf")


class BridgeClient:
    """供 CLI 和 MCP 共用的桥接客户端。"""

    def __init__(
        self,
        locator: ProjectLocator,
        launcher: EditorLauncher | None = None,
        *,
        timeout: float = 10.0,
        heartbeat_max_age: float = 5.0,
    ) -> None:
        self.locator = locator
        self.launcher = launcher if launcher is not None else EditorLauncher()
        self.timeout = timeout
        self.heartbeat_max_age = heartbeat_max_age

    def project_context(self) -> ProjectContext:
        return self.locator.resolve()

    def read_status(self) -> dict[str, Any] | None:
        status_file = self.project_context().queue_root / "status.json"
        if not status_file.exists():
            return None
        try:
            value = json.loads(status_file.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def describe_status(self) -> dict[str, Any]:
        context = self.project_context()
        status = self.read_status()
        plugin_version = status.get("bridgeVersion") if status else None
        version_match = (plugin_version == __version__) if plugin_version else None
        result: dict[str, Any] = {
            "project": context.as_dict(),
            "statusFile": str(context.queue_root / "status.json"),
            "heartbeatAgeSeconds": status_age(status),
            "online": status is not None and status_age(status) <= self.heartbeat_max_age,
            "bridgeClientVersion": __version__,
            "pluginVersion": plugin_version,
            "versionMatch": version_match,
            "status": status,
        }
        if status and plugin_version and not version_match:
            result["updateWarning"] = (
                f"编辑器插件版本 (v{plugin_version}) 与 Bridge 客户端版本 (v{__version__}) 不一致，"
                "建议执行更新同步并在 FairyGUI Editor 中重新打开工程。"
            )
        return result

    def _validate_status(self, status: dict[str, Any]) -> None:
        protocol = str(status.get("protocolVersion", ""))
        expected_major = PROTOCOL_VERSION.split(".", 1)[0]
        actual_major = protocol.split(".", 1)[0] if protocol else ""
        if actual_major != expected_major:
            bridge_version = status.get("bridgeVersion", "unknown")
            raise BridgeError(
                "FairyGUI Agent Bridge 协议不兼容："
                f"客户端需要 {PROTOCOL_VERSION}，编辑器报告 {protocol or '未提供'} "
                f"(bridge {bridge_version})。请更新或重新加载编辑器插件。"
            )

        capabilities = {str(item) for item in status.get("capabilities", [])}
        missing = sorted(REQUIRED_CAPABILITIES - capabilities)
        if missing:
            raise BridgeError(f"FairyGUI Agent Bridge 缺少能力：{', '.join(missing)}")

    def ensure_ready(self) -> dict[str, Any]:
        context = self.project_context()
        status = self.read_status()
        if status_age(status) <= self.heartbeat_max_age:
            self._validate_status(status)
            return status

        self.launcher.wake(context.project_file)
        activate_deadline = time.monotonic() + 2.0
        while time.monotonic() < activate_deadline:
            status = self.read_status()
            if status_age(status) <= self.heartbeat_max_age:
                self._validate_status(status)
                return status
            time.sleep(0.1)

        self.launcher.wake(context.project_file, open_project=True)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            status = self.read_status()
            if status_age(status) <= self.heartbeat_max_age:
                self._validate_status(status)
                return status
            time.sleep(0.1)

        age = status_age(status)
        if status is None:
            raise BridgeError(
                f"未发现 {context.queue_root / 'status.json'}。请打开 {context.project_file}，"
                "并确认 FGUI Agent Bridge 插件已加载。"
            )
        raise BridgeError(
            f"FairyGUI Agent Bridge 心跳仍未恢复（{age:.1f} 秒）。请检查 FairyGUI 编辑器控制台。"
        )

    def call_raw(
        self,
        action: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        context = self.project_context()
        status = self.ensure_ready()
        if action in ANIMATION_CAPABILITIES:
            capabilities = {str(item) for item in status.get("capabilities", [])}
            if action not in capabilities:
                bridge_version = status.get("bridgeVersion", "unknown")
                raise BridgeError(
                    f"FairyGUI Agent Bridge 缺少动画能力：{action} "
                    f"(编辑器 bridge {bridge_version})。请更新并重新加载 0.8.1 或更高版本插件。"
                )

        request_dir = context.queue_root / "requests"
        response_dir = context.queue_root / "responses"
        request_dir.mkdir(parents=True, exist_ok=True)
        response_dir.mkdir(parents=True, exist_ok=True)

        request_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        request_path = request_dir / f"{request_id}.json"
        response_path = response_dir / f"{request_id}.json"
        temp_path = request_path.with_suffix(".json.tmp")
        payload = {
            "id": request_id,
            "action": action,
            "params": params or {},
            "protocolVersion": PROTOCOL_VERSION,
            "createdAt": datetime.now().astimezone().isoformat(),
            "clientPid": os.getpid(),
        }
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp_path, request_path)

        call_timeout = self.timeout if timeout is None else timeout
        deadline = time.monotonic() + call_timeout
        wake_again_at = time.monotonic() + min(1.0, call_timeout / 2)
        woke_again = False
        while time.monotonic() < deadline:
            if response_path.exists():
                try:
                    response = json.loads(response_path.read_text(encoding="utf-8"))
                finally:
                    response_path.unlink(missing_ok=True)
                if not isinstance(response, dict):
                    raise BridgeError(f"FairyGUI 返回了无效响应：{action}")
                return response
            if not woke_again and time.monotonic() >= wake_again_at:
                self.launcher.wake(context.project_file)
                woke_again = True
            time.sleep(0.05)

        request_path.unlink(missing_ok=True)
        raise TimeoutError(f"等待 FairyGUI 响应超时：{action} ({call_timeout:.1f}s)")

    def call(
        self,
        action: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> Any:
        response = self.call_raw(action, params, timeout=timeout)
        if not response.get("ok"):
            error = response.get("error")
            message = error.get("message") if isinstance(error, dict) else str(error or "未知错误")
            raise BridgeCommandError(action, str(message))
        return response.get("result")
