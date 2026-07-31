"""按平台唤醒或打开 FairyGUI Editor。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

EDITOR_ENV = "FAIRYGUI_EDITOR_PATH"
LEGACY_EDITOR_ENV = "FAIRYGUI_EDITOR_APP"


class EditorLauncher:
    """封装编辑器路径解析与平台差异。"""

    def __init__(self, editor_path: str | None = None) -> None:
        configured = editor_path or os.environ.get(EDITOR_ENV) or os.environ.get(LEGACY_EDITOR_ENV)
        self.editor_path = Path(configured).expanduser() if configured else self._find_default_editor()

    @staticmethod
    def _find_default_editor() -> Path | None:
        if sys.platform == "darwin":
            candidates = [
                Path("/Applications/FairyGUI-Editor.app"),
                Path.home() / "Applications" / "FairyGUI-Editor.app",
                Path.home() / "Downloads" / "FairyGUI-Editor.app",
            ]
            return next((path for path in candidates if path.exists()), None)
        return None

    def wake(self, project_file: Path, *, open_project: bool = False) -> bool:
        """尽力激活编辑器；失败不直接中断，后续由心跳给出准确错误。"""

        try:
            if sys.platform == "darwin":
                command = ["open"]
                if self.editor_path and self.editor_path.exists():
                    command.extend(["-a", str(self.editor_path)])
                    if open_project:
                        command.append(str(project_file))
                elif open_project:
                    command.append(str(project_file))
                else:
                    command.extend(["-a", "FairyGUI-Editor"])
                subprocess.run(
                    command,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True

            if sys.platform == "win32":
                if self.editor_path and self.editor_path.is_file():
                    command = [str(self.editor_path)]
                    if open_project:
                        command.append(str(project_file))
                    subprocess.Popen(
                        command,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return True
                if open_project and hasattr(os, "startfile"):
                    os.startfile(str(project_file))  # type: ignore[attr-defined]
                    return True
        except OSError:
            return False

        return False
