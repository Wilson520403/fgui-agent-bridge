#!/usr/bin/env python3
"""将独立仓库中的 FairyGUI 插件和可选 Skill 同步到目标工程。"""

from __future__ import annotations

import argparse
import filecmp
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_SOURCE = REPOSITORY_ROOT / "plugin"
SKILL_SOURCE = REPOSITORY_ROOT / ".agents" / "skills" / "fgui-agent-bridge"
IGNORED_PARTS = {".git", ".agent", ".venv", "__pycache__", "node_modules"}
IGNORED_SUFFIXES = {".pyc", ".pyo"}


@dataclass(frozen=True)
class CopyEntry:
    source: Path
    destination: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="预览或执行 FGUI Agent Bridge 插件与 Skill 同步。"
    )
    project_group = parser.add_mutually_exclusive_group(required=True)
    project_group.add_argument(
        "--project",
        help="目标 .fairy 文件、FairyGUI 工程目录或包含 FairyGUI/FairyGUI.fairy 的仓库目录。",
    )
    project_group.add_argument(
        "--choose-project",
        action="store_true",
        help="打开目录选择器，选择目标 FairyGUI 工程。",
    )
    parser.add_argument(
        "--skill-root",
        help="可选：安装 Skill 的目标仓库根目录。",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际写入；省略时仅输出预览。",
    )
    return parser.parse_args()


def _run_directory_picker(command: list[str]) -> Path | None:
    """运行系统目录选择器；空输出或取消选择时返回 None。"""
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return Path(value).expanduser() if value else None


def _choose_with_tkinter() -> Path | None:
    """使用 Tk 作为跨平台回退；无桌面或未安装 Tk 时给出明确错误。"""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # pragma: no cover - 依赖本机 GUI 环境
        raise RuntimeError(
            "当前系统没有可用的目录选择器，请改用 --project 指定工程路径。"
        ) from exc

    try:
        root = tk.Tk()
    except Exception as exc:  # pragma: no cover - 依赖本机 GUI 环境
        raise RuntimeError(
            "无法打开目录选择器，请改用 --project 指定工程路径。"
        ) from exc

    try:
        root.withdraw()
        root.update()
        value = filedialog.askdirectory(
            parent=root,
            title="选择 FairyGUI 工程目录",
            mustexist=True,
        )
        return Path(value).expanduser() if value else None
    finally:
        root.destroy()


def choose_project_directory() -> Path | None:
    """打开系统目录选择器，返回用户选择的工程目录。"""
    system = platform.system()

    if system == "Darwin" and shutil.which("osascript"):
        return _run_directory_picker(
            [
                "osascript",
                "-e",
                'POSIX path of (choose folder with prompt "选择 FairyGUI 工程目录")',
            ]
        )

    if system == "Windows":
        powershell = shutil.which("powershell") or shutil.which("pwsh")
        if powershell:
            script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$dialog.Description = '选择 FairyGUI 工程目录'; "
                "$dialog.ShowNewFolderButton = $false; "
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) "
                "{ $dialog.SelectedPath }"
            )
            return _run_directory_picker(
                [powershell, "-NoProfile", "-STA", "-Command", script]
            )

    if system == "Linux":
        if shutil.which("zenity"):
            return _run_directory_picker(
                [
                    "zenity",
                    "--file-selection",
                    "--directory",
                    "--title=选择 FairyGUI 工程目录",
                ]
            )
        if shutil.which("kdialog"):
            return _run_directory_picker(
                [
                    "kdialog",
                    "--getexistingdirectory",
                    ".",
                    "--title",
                    "选择 FairyGUI 工程目录",
                ]
            )

    return _choose_with_tkinter()


def resolve_project_file(value: str) -> Path:
    candidate = Path(value).expanduser().resolve()
    if candidate.is_file():
        if candidate.suffix.lower() != ".fairy":
            raise ValueError(f"不是 FairyGUI 工程文件：{candidate}")
        return candidate

    if not candidate.is_dir():
        raise ValueError(f"工程路径不存在或不是目录：{candidate}")

    preferred = candidate / "FairyGUI.fairy"
    if preferred.is_file():
        return preferred

    nested = candidate / "FairyGUI" / "FairyGUI.fairy"
    if nested.is_file():
        return nested

    matches = sorted(path for path in candidate.glob("*.fairy") if path.is_file())
    if len(matches) == 1:
        return matches[0]

    raise ValueError(
        f"在 {candidate} 中未找到唯一 FairyGUI 工程；"
        "请传入 .fairy 文件、FairyGUI 工程目录或包含 FairyGUI/FairyGUI.fairy 的仓库目录。"
    )


def iter_files(root: Path) -> list[Path]:
    result: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in relative.parts):
            continue
        if path.suffix in IGNORED_SUFFIXES or path.name == "main.js.map":
            continue
        result.append(path)
    return result


def build_entries(source_root: Path, destination_root: Path) -> list[CopyEntry]:
    return [
        CopyEntry(source, destination_root / source.relative_to(source_root))
        for source in iter_files(source_root)
    ]


def classify(entry: CopyEntry) -> str:
    if not entry.destination.exists():
        return "CREATE"
    if entry.destination.is_file() and filecmp.cmp(
        entry.source, entry.destination, shallow=False
    ):
        return "UNCHANGED"
    return "UPDATE"


def sync(entries: list[CopyEntry], *, apply: bool) -> tuple[int, int, int]:
    counts = {"CREATE": 0, "UPDATE": 0, "UNCHANGED": 0}
    for entry in entries:
        action = classify(entry)
        counts[action] += 1
        print(f"{action:9} {entry.destination}")
        if apply and action != "UNCHANGED":
            entry.destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(entry.source, entry.destination)
    return counts["CREATE"], counts["UPDATE"], counts["UNCHANGED"]


def main() -> int:
    args = parse_args()

    if args.choose_project:
        selected_project = choose_project_directory()
        if selected_project is None:
            print("已取消 FairyGUI 工程选择。")
            return 0
        print(f"已选择工程目录：{selected_project}")
        project_value = str(selected_project)
    else:
        project_value = args.project

    project_file = resolve_project_file(project_value)
    plugin_destination = project_file.parent / "plugins" / "agent-bridge"
    entries = build_entries(PLUGIN_SOURCE, plugin_destination)

    if args.skill_root:
        skill_root = Path(args.skill_root).expanduser().resolve()
        if not skill_root.is_dir():
            raise ValueError(f"Skill 根目录不存在或不是目录：{skill_root}")
        skill_destination = skill_root / ".agents" / "skills" / "fgui-agent-bridge"
        entries.extend(build_entries(SKILL_SOURCE, skill_destination))

    created, updated, unchanged = sync(entries, apply=args.apply)
    mode = "已写入" if args.apply else "预览"
    print(
        f"{mode}完成：create={created}, update={updated}, unchanged={unchanged}; "
        "脚本不会删除目标目录中的其他文件。"
    )
    if not args.apply:
        print("如需执行，请在确认目标后追加 --apply。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(1) from None
