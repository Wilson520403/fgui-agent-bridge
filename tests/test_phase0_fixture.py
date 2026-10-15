"""Phase 0 夹具的离线回归校验。

这些用例不依赖 FairyGUI Editor：只检查 `sample/` 隔离工程里的夹具组件是否
满足 manifest 声明的八类对象矩阵，以及初始快照是否已生成且与夹具一致。
需要编辑器回读的实况校验请用：

    uv run python -u scripts/phase0_fixture.py verify --live
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "phase0"
SAMPLE_PROJECT = REPO_ROOT / "sample"
PACKAGE_NAME = "Package1"
COMPONENT_NAME = "BridgeFixture"


def _load_phase0_module():
    spec = importlib.util.spec_from_file_location("phase0_fixture", REPO_ROOT / "scripts" / "phase0_fixture.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # dataclass 解析注解时会回查 sys.modules[cls.__module__]，必须先注册。
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


phase0 = _load_phase0_module()


class Phase0FixtureTests(unittest.TestCase):
    def test_manifest_requires_full_object_matrix(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(
            tuple(manifest["objects"]),
            phase0.REQUIRED_MATRIX,
            "manifest 声明的对象矩阵必须与校验器要求的八类对象一致",
        )
        self.assertEqual(manifest["fixture"]["package"], PACKAGE_NAME)
        self.assertEqual(manifest["fixture"]["component"], COMPONENT_NAME)

    def test_initial_snapshots_are_populated(self) -> None:
        """快照必须是真实内容；此前它们是空数组与占位注释。"""

        tree = json.loads((FIXTURE_DIR / "initial-tree.json").read_text(encoding="utf-8"))
        self.assertIn("tree", tree, "initial-tree.json 必须包含编辑器回读的对象树")
        self.assertGreater(phase0.count_nodes(tree["tree"]), 8, "对象树节点过少，八类对象无法成立")

        resources = json.loads((FIXTURE_DIR / "initial-resources.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(resources["resources"]), 5)

        xml_text = (FIXTURE_DIR / "initial-xml.xml").read_text(encoding="utf-8").strip()
        self.assertTrue(xml_text.startswith("<?xml"), "initial-xml.xml 不能是占位注释")
        self.assertGreater(len(xml_text), 500)

    def test_offline_verification_passes(self) -> None:
        report = phase0.verify(None, FIXTURE_DIR, SAMPLE_PROJECT, PACKAGE_NAME, COMPONENT_NAME, live=False)
        failures = [check["id"] for check in report["checks"] if check["status"] == "fail"]
        self.assertEqual(failures, [], f"离线校验失败项：{failures}")
        self.assertEqual(report["summary"]["status"], "pass")
        self.assertEqual(report["kind"], phase0.REPORT_KIND)
        self.assertEqual(report["schemaVersion"], phase0.REPORT_SCHEMA_VERSION)

    def test_report_contains_actionable_failure_detail(self) -> None:
        """失败时报告必须能定位到对象与 XML 片段，而不只是报一个布尔值。"""

        fixture_xml = SAMPLE_PROJECT / "assets" / PACKAGE_NAME / f"{COMPONENT_NAME}.xml"
        checks = phase0.verify_matrix_offline(fixture_xml, fixture_xml.parent)
        image_check = next(check for check in checks if check.id == "matrix.image")
        self.assertEqual(image_check.status, "pass")
        self.assertIn("<image", image_check.xml_fragment or "")
        self.assertEqual(image_check.target["path"], "//Image")

    def test_cli_verify_returns_zero(self) -> None:
        exit_code = phase0.main(["verify", "--project", str(SAMPLE_PROJECT), "--fixture-dir", str(FIXTURE_DIR)])
        self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    sys.exit(unittest.main())
