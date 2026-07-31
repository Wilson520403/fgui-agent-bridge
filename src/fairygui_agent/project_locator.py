"""FairyGUI 工程定位与会话级切换。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

PROJECT_ENV = "FGUI_PROJECT_PATH"
CODEX_WORKSPACE_ENV = "CODEX_WORKSPACE_ROOT"


@dataclass(frozen=True)
class ProjectContext:
    """已解析的 FairyGUI 工程位置。"""

    project_file: Path

    @property
    def project_dir(self) -> Path:
        return self.project_file.parent

    @property
    def queue_root(self) -> Path:
        return self.project_dir / ".agent"

    def as_dict(self) -> dict[str, str]:
        return {
            "projectFile": str(self.project_file),
            "projectDir": str(self.project_dir),
            "queueRoot": str(self.queue_root),
        }


def _direct_project_file(directory: Path) -> Path | None:
    preferred = directory / "FairyGUI.fairy"
    if preferred.is_file():
        return preferred.resolve()

    nested = directory / "FairyGUI" / "FairyGUI.fairy"
    if nested.is_file():
        return nested.resolve()

    matches = sorted(path for path in directory.glob("*.fairy") if path.is_file())
    if len(matches) == 1:
        return matches[0].resolve()
    return None


def resolve_project_path(value: str | os.PathLike[str]) -> ProjectContext:
    """将 .fairy 文件、FairyGUI 目录或仓库目录解析为工程。"""

    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = (Path.cwd() / candidate).resolve()
    else:
        candidate = candidate.resolve()

    if candidate.is_file():
        if candidate.suffix.lower() != ".fairy":
            raise ValueError(f"不是 FairyGUI 工程文件：{candidate}")
        return ProjectContext(candidate)

    if not candidate.exists():
        raise ValueError(f"工程路径不存在：{candidate}")
    if not candidate.is_dir():
        raise ValueError(f"工程路径不是目录：{candidate}")

    project_file = _direct_project_file(candidate)
    if project_file is None:
        raise ValueError(
            f"在 {candidate} 中未找到唯一 FairyGUI 工程；"
            "请传入 .fairy 文件、FairyGUI 工程目录或包含 FairyGUI/FairyGUI.fairy 的仓库目录。"
        )
    return ProjectContext(project_file)


def _walk_candidates(start: Path) -> Iterable[Path]:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    yield current
    yield from current.parents


class ProjectLocator:
    """按固定优先级定位工程，并允许 MCP 会话覆盖。"""

    def __init__(self, startup_project: str | None = None) -> None:
        self._session_project: ProjectContext | None = None
        self._startup_project = startup_project

    def use_project(self, project_path: str) -> ProjectContext:
        self._session_project = resolve_project_path(project_path)
        return self._session_project

    def resolve(self) -> ProjectContext:
        if self._session_project is not None:
            return self._session_project

        explicit_values = [self._startup_project, os.environ.get(PROJECT_ENV)]
        for value in explicit_values:
            if value:
                return resolve_project_path(value)

        starts: list[Path] = []
        workspace_root = os.environ.get(CODEX_WORKSPACE_ENV)
        if workspace_root:
            starts.append(Path(workspace_root).expanduser())
        starts.append(Path.cwd())
        starts.append(Path(__file__).resolve())

        visited: set[Path] = set()
        for start in starts:
            for directory in _walk_candidates(start):
                if directory in visited:
                    continue
                visited.add(directory)
                project_file = _direct_project_file(directory)
                if project_file is not None:
                    return ProjectContext(project_file)

        raise RuntimeError(
            "无法自动定位 FairyGUI 工程。请调用 fgui_use_project，或设置 "
            f"{PROJECT_ENV}，或以 --project 指定 .fairy 文件/工程目录。"
        )
