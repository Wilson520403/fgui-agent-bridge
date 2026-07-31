#!/usr/bin/env python3
"""将独立仓库中的 FairyGUI 插件和可选 Skill 同步到目标工程。"""

from __future__ import annotations

import argparse
import filecmp
import shutil
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
    parser.add_argument(
        "--project",
        required=True,
        help="目标 .fairy 文件、FairyGUI 工程目录或包含 FairyGUI/FairyGUI.fairy 的仓库目录。",
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
    project_file = resolve_project_file(args.project)
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
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(1) from None
