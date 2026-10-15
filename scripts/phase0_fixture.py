"""Phase 0 夹具快照与回归校验。

默认离线校验 `sample/` 隔离工程中的 `BridgeFixture` 组件是否满足
`tests/fixtures/phase0/manifest.json` 声明的八类对象矩阵，并与已提交的
初始快照比对；加 `--live` 时再通过 Bridge 向 FairyGUI Editor 回读对象树和
包资源做一致性比对。两种模式都输出同一份 JSON 报告。
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.fairygui_agent.bridge_client import BridgeClient, BridgeError  # noqa: E402
from src.fairygui_agent.project_locator import ProjectLocator  # noqa: E402

REPORT_SCHEMA_VERSION = "1.0"
REPORT_KIND = "fgui-bridge-phase0-report"
DEFAULT_FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "phase0"
DEFAULT_SAMPLE_PROJECT = REPO_ROOT / "sample"

# manifest.json 声明的对象矩阵 -> 离线 XML 证据。
# 每项给出 (显示名, 证据判定函数需要的 XML 标签或特殊键)。
REQUIRED_MATRIX = ("Image", "Loader", "Button", "Text", "List", "Group", "Controller", "Transition")

# 编辑器回读时用于判定对象类型的 node type。
NODE_TYPE_BY_MATRIX = {
    "Image": "image",
    "Loader": "loader",
    "Text": "text",
    "List": "list",
    "Group": "group",
    "Controller": None,  # get_tree 不展开 controller，靠 XML + transition 报告判定
    "Transition": None,  # 由 document.transitions 判定
    "Button": "component",
}


@dataclass
class Check:
    id: str
    description: str
    status: str = "skipped"
    target: dict[str, Any] = field(default_factory=dict)
    expected: Any = None
    actual: Any = None
    detail: str | None = None
    xml_fragment: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "description": self.description,
            "status": self.status,
            "target": self.target,
        }
        if self.expected is not None:
            payload["expected"] = self.expected
        if self.actual is not None:
            payload["actual"] = self.actual
        if self.detail:
            payload["detail"] = self.detail
        if self.xml_fragment:
            payload["xmlFragment"] = self.xml_fragment
        return payload


def _fragment(element: ET.Element, limit: int = 240) -> str:
    text = ET.tostring(element, encoding="unicode").strip().replace("\n", " ").replace("  ", " ")
    return text[:limit]


def _resolve_button_evidence(component: ET.Element, package_dir: Path) -> dict[str, Any]:
    """按钮证据：组件内出现 Button 扩展节点，或存在引用 extention=Button 组件的实例。"""

    if component.find("Button") is not None:
        return {"kind": "inline-extension", "target": "component/Button"}
    for node in component.iter("component"):
        file_name = node.get("fileName") or ""
        if not file_name.endswith(".xml"):
            continue
        candidate = (package_dir / file_name).resolve()
        if not candidate.is_file():
            continue
        try:
            target_root = ET.parse(candidate).getroot()
        except ET.ParseError:
            continue
        if target_root.get("extention") == "Button":
            return {
                "kind": "instance-of-button-component",
                "target": f"{file_name} (extention=Button)",
                "nodeId": node.get("id"),
            }
    return {}


def verify_matrix_offline(fixture_xml: Path, package_dir: Path) -> list[Check]:
    """仅依赖磁盘上的组件 XML，校验八类对象矩阵。"""

    checks: list[Check] = []
    if not fixture_xml.is_file():
        checks.append(
            Check(
                id="fixture.xml.present",
                description="夹具组件 XML 存在",
                status="fail",
                detail=f"未找到 {fixture_xml}",
            )
        )
        return checks

    checks.append(
        Check(
            id="fixture.xml.present",
            description="夹具组件 XML 存在",
            status="pass",
            target={"path": str(fixture_xml.relative_to(REPO_ROOT))},
            actual=f"{fixture_xml.stat().st_size} bytes",
        )
    )

    try:
        component = ET.parse(fixture_xml).getroot()
    except ET.ParseError as error:
        checks.append(
            Check(
                id="fixture.xml.parse",
                description="夹具组件 XML 可解析",
                status="fail",
                detail=str(error),
            )
        )
        return checks

    checks.append(
        Check(
            id="fixture.xml.parse",
            description="夹具组件 XML 可解析",
            status="pass",
            actual={"root": component.tag, "size": component.get("size")},
        )
    )

    def has_tag(tag: str) -> ET.Element | None:
        return component.find(f".//{tag}")

    for name in REQUIRED_MATRIX:
        check = Check(
            id=f"matrix.{name.lower()}",
            description=f"对象矩阵包含 {name}",
            target={"path": f"//{name}"},
        )
        if name == "Button":
            evidence = _resolve_button_evidence(component, package_dir)
            if evidence:
                check.status = "pass"
                check.actual = evidence
                check.target = {"nodeId": evidence.get("nodeId"), "component": evidence.get("target")}
            else:
                check.status = "fail"
                check.detail = "既没有 Button 扩展节点，也没有引用 extention=Button 组件的实例"
        else:
            tag = name.lower()
            node = has_tag(tag)
            if node is not None:
                check.status = "pass"
                check.actual = {"id": node.get("id"), "name": node.get("name")}
                check.xml_fragment = _fragment(node)
            else:
                check.status = "fail"
                check.detail = f"XML 中未找到 <{tag}> 节点"
        checks.append(check)

    return checks


def verify_transition(fixture_xml: Path) -> Check:
    """Transition 必须至少有一条带关键帧的轨道。"""

    check = Check(
        id="matrix.transition.tracks",
        description="Transition 至少包含一条关键帧轨道",
        target={"path": "//transition/item"},
    )
    if not fixture_xml.is_file():
        check.status = "fail"
        check.detail = "夹具 XML 不存在"
        return check
    component = ET.parse(fixture_xml).getroot()
    transition = component.find("transition")
    if transition is None:
        check.status = "fail"
        check.detail = "XML 中未找到 <transition>"
        return check
    items = transition.findall("item")
    check.expected = {"minimumTracks": 1}
    check.actual = {
        "name": transition.get("name"),
        "frameRate": transition.get("frameRate"),
        "tracks": len(items),
        "targets": sorted({item.get("target") for item in items if item.get("target")}),
    }
    check.status = "pass" if items else "fail"
    if items:
        check.xml_fragment = _fragment(transition)
    else:
        check.detail = "transition 没有任何 <item> 轨道"
    return check


def verify_xml_snapshot(fixture_xml: Path, snapshot_xml: Path) -> Check:
    """夹具当前 XML 必须与已提交的初始快照一致（保证基线可复现）。"""

    check = Check(
        id="snapshot.xml.match",
        description="夹具 XML 与初始快照 initial-xml.xml 一致",
        target={"path": str(fixture_xml.relative_to(REPO_ROOT))},
    )
    if not snapshot_xml.is_file():
        check.status = "fail"
        check.detail = f"缺少快照 {snapshot_xml.relative_to(REPO_ROOT)}，请先运行 capture"
        return check
    actual = fixture_xml.read_text(encoding="utf-8")
    expected = snapshot_xml.read_text(encoding="utf-8")
    if actual.strip() == expected.strip():
        check.status = "pass"
        check.actual = {"bytes": len(actual.encode("utf-8"))}
        return check
    check.status = "fail"
    check.expected = snapshot_xml.read_text(encoding="utf-8")[:400]
    check.actual = actual[:400]
    check.detail = "夹具已偏离初始快照；确认是有意修改后重新运行 capture"
    return check


def verify_tree_snapshot(tree: dict[str, Any], snapshot_path: Path) -> Check:
    """编辑器回读的对象树必须与初始快照一致。"""

    check = Check(
        id="snapshot.tree.match",
        description="编辑器对象树与初始快照 initial-tree.json 一致",
        target={"path": str(snapshot_path.relative_to(REPO_ROOT))},
    )
    if not snapshot_path.is_file():
        check.status = "fail"
        check.detail = f"缺少快照 {snapshot_path.relative_to(REPO_ROOT)}，请先运行 capture"
        return check
    expected = json.loads(snapshot_path.read_text(encoding="utf-8"))
    expected_tree = expected.get("tree", expected)
    if tree == expected_tree:
        check.status = "pass"
        check.actual = {"nodes": count_nodes(tree)}
        return check
    check.status = "fail"
    check.expected = flatten(expected_tree)[:12]
    check.actual = flatten(tree)[:12]
    check.detail = "对象树与快照不一致（显示前若干节点的 id/name/type）"
    return check


def verify_resource_snapshot(resources: list[dict[str, Any]], snapshot_path: Path) -> Check:
    check = Check(
        id="snapshot.resources.match",
        description="包资源与初始快照 initial-resources.json 一致",
        target={"path": str(snapshot_path.relative_to(REPO_ROOT))},
    )
    if not snapshot_path.is_file():
        check.status = "fail"
        check.detail = f"缺少快照 {snapshot_path.relative_to(REPO_ROOT)}，请先运行 capture"
        return check
    expected = json.loads(snapshot_path.read_text(encoding="utf-8")).get("resources", [])
    key = lambda item: (item.get("type"), item.get("name"), item.get("url"))  # noqa: E731
    if sorted(map(key, resources)) == sorted(map(key, expected)):
        check.status = "pass"
        check.actual = {"count": len(resources)}
        return check
    check.status = "fail"
    check.expected = sorted(map(key, expected))
    check.actual = sorted(map(key, resources))
    check.detail = "包资源集合与快照不一致"
    return check


def count_nodes(tree: dict[str, Any]) -> int:
    return 1 + sum(count_nodes(child) for child in tree.get("children") or [])


def flatten(tree: dict[str, Any], out: list[str] | None = None) -> list[str]:
    out = [] if out is None else out
    out.append(f"{tree.get('id')} {tree.get('name')} {tree.get('type')}")
    for child in tree.get("children") or []:
        flatten(child, out)
    return out


def build_report(checks: list[Check], extra: dict[str, Any]) -> dict[str, Any]:
    passed = sum(1 for check in checks if check.status == "pass")
    failed = sum(1 for check in checks if check.status == "fail")
    skipped = sum(1 for check in checks if check.status == "skipped")
    report: dict[str, Any] = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "kind": REPORT_KIND,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "summary": {
            "total": len(checks),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "status": "fail" if failed else "pass",
        },
        "checks": [check.to_dict() for check in checks],
    }
    report.update(extra)
    return report


def capture(client: BridgeClient, fixture_dir: Path, package_name: str, component_name: str) -> dict[str, Any]:
    """从编辑器抓取初始快照并写入 fixture 目录。"""

    client.call("open_document", {"packageName": package_name, "itemName": component_name})
    tree_result = client.call("get_tree", {"maxDepth": 12})
    items_result = client.call("list_items", {"packageName": package_name})

    context = client.project_context()
    package_dir = context.project_dir / "assets" / package_name
    fixture_xml = package_dir / f"{component_name}.xml"
    if not fixture_xml.is_file():
        raise BridgeError(f"夹具组件 XML 不存在：{fixture_xml}")

    document = tree_result.get("document", {})
    items = items_result.get("items", items_result if isinstance(items_result, list) else [])

    # list_items 会返回绝对路径，快照必须机器无关：改写成包内相对路径。
    sanitized: list[dict[str, Any]] = []
    for item in items:
        entry = dict(item)
        file_value = entry.get("file")
        if file_value:
            try:
                entry["file"] = str(Path(str(file_value)).resolve().relative_to(package_dir.resolve()))
            except ValueError:
                entry["file"] = Path(str(file_value)).name
        sanitized.append(entry)

    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / "initial-tree.json").write_text(
        json.dumps({"document": document, "tree": tree_result.get("tree")}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (fixture_dir / "initial-resources.json").write_text(
        json.dumps({"package": package_name, "resources": sanitized}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (fixture_dir / "initial-xml.xml").write_text(fixture_xml.read_text(encoding="utf-8"), encoding="utf-8")

    return build_report(
        [
            Check(
                id="capture.tree",
                description="写入初始对象树快照",
                status="pass",
                actual={"nodes": count_nodes(tree_result.get("tree") or {})},
            ),
            Check(
                id="capture.resources",
                description="写入初始包资源快照",
                status="pass",
                actual={"items": len(items)},
            ),
            Check(
                id="capture.xml",
                description="写入初始组件 XML 快照",
                status="pass",
                actual={"bytes": fixture_xml.stat().st_size},
            ),
        ],
        {
            "mode": "capture",
            "fixture": {"package": package_name, "component": component_name, "url": document.get("url")},
            "fixtureDir": str(fixture_dir.relative_to(REPO_ROOT)),
        },
    )


def verify(
    client: BridgeClient | None,
    fixture_dir: Path,
    project_dir: Path,
    package_name: str,
    component_name: str,
    live: bool,
) -> dict[str, Any]:
    package_dir = project_dir / "assets" / package_name
    fixture_xml = package_dir / f"{component_name}.xml"
    checks = verify_matrix_offline(fixture_xml, package_dir)
    checks.append(verify_transition(fixture_xml))
    checks.append(verify_xml_snapshot(fixture_xml, fixture_dir / "initial-xml.xml"))

    extra: dict[str, Any] = {
        "mode": "verify-live" if live else "verify-offline",
        "fixture": {
            "package": package_name,
            "component": component_name,
            "path": str(fixture_xml.relative_to(REPO_ROOT)) if fixture_xml.is_file() else None,
        },
    }

    if live:
        if client is None:
            checks.append(
                Check(
                    id="live.editor",
                    description="编辑器回读",
                    status="fail",
                    detail="--live 需要可用的 BridgeClient",
                )
            )
        else:
            client.call("open_document", {"packageName": package_name, "itemName": component_name})
            tree_result = client.call("get_tree", {"maxDepth": 12})
            items_result = client.call("list_items", {"packageName": package_name})
            document = tree_result.get("document", {})
            items = items_result.get("items", items_result if isinstance(items_result, list) else [])
            tree = tree_result.get("tree") or {}

            present_types = {node.get("type") for node in iter_nodes(tree)}
            checks.append(
                Check(
                    id="live.editor.online",
                    description="编辑器回读到夹具组件",
                    status="pass" if document.get("title") == component_name else "fail",
                    actual={
                        "title": document.get("title"),
                        "savedVersion": document.get("savedVersion"),
                        "transitions": [item.get("name") for item in document.get("transitions") or []],
                    },
                )
            )
            for name in REQUIRED_MATRIX:
                node_type = NODE_TYPE_BY_MATRIX.get(name)
                if node_type is None:
                    continue
                checks.append(
                    Check(
                        id=f"live.matrix.{name.lower()}",
                        description=f"编辑器对象树中存在 {name} 节点",
                        status="pass" if node_type in present_types else "fail",
                        actual={"nodeType": node_type, "present": sorted(t for t in present_types if t)},
                    )
                )
            checks.append(verify_tree_snapshot(tree, fixture_dir / "initial-tree.json"))
            checks.append(verify_resource_snapshot(items, fixture_dir / "initial-resources.json"))

            status = client.describe_status()
            extra["editor"] = {
                "online": status.get("online"),
                "heartbeatAgeSeconds": round(float(status.get("heartbeatAgeSeconds") or 0), 2),
                "bridgeClientVersion": status.get("bridgeClientVersion"),
                "pluginVersion": status.get("pluginVersion"),
                "versionMatch": status.get("versionMatch"),
            }

    return build_report(checks, extra)


def iter_nodes(tree: dict[str, Any]):
    if not tree:
        return
    yield tree
    for child in tree.get("children") or []:
        yield from iter_nodes(child)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Phase 0 夹具快照与回归校验")
    parser.add_argument("command", choices=("capture", "verify"))
    parser.add_argument("--project", default=str(DEFAULT_SAMPLE_PROJECT))
    parser.add_argument("--fixture-dir", default=str(DEFAULT_FIXTURE_DIR))
    parser.add_argument("--package", dest="package_name", default="Package1")
    parser.add_argument("--component", dest="component_name", default="BridgeFixture")
    parser.add_argument("--live", action="store_true", help="verify 时同时向 FairyGUI Editor 回读")
    parser.add_argument("--out", help="报告输出路径；缺省打印到 stdout")
    args = parser.parse_args(argv)

    fixture_dir = Path(args.fixture_dir).resolve()
    locator = ProjectLocator(args.project)
    project_dir = locator.resolve().project_dir
    client = BridgeClient(locator, timeout=20.0)

    if args.command == "capture":
        report = capture(client, fixture_dir, args.package_name, args.component_name)
    else:
        report = verify(client, fixture_dir, project_dir, args.package_name, args.component_name, args.live)

    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload + "\n", encoding="utf-8")
        print(f"报告已写入 {out_path}｜status={report['summary']['status']}")
    else:
        print(payload)

    return 0 if report["summary"]["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
