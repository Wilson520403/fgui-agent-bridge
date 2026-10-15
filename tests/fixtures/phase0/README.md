# Phase 0 FairyGUI fixture

隔离回归工程是仓库内的 `sample/`（FairyGUI 工程根 `sample/sample.fairy`），
夹具组件为 `sample/assets/Package1/BridgeFixture.xml`，包 `Package1`。

它覆盖 `manifest.json` 声明的八类对象：

| 对象 | 节点 | 证据 |
| --- | --- | --- |
| Image | `imgIcon` (`n0_fix01`) | `<image src="p93m2">` |
| Loader | `loaderItem` (`n1_fix01`) | `<loader url="ui://qsezbqtwp93m1">` |
| Button | `btnMain` (`n3_fix01`) | 引用 `BridgeTestButton.xml`（`extention="Button"`） |
| Text | `txtLabel` (`n2_fix01`) | `<text>` |
| List | `listItems` (`n4_fix01`) | `<list defaultItem=...>` |
| Group | `grpRows` (`n7_fix01`) | `<group advanced="true" layout="vt">`，子节点用 `group="n7_fix01"` 反向引用 |
| Controller | `ctrlState` | `<controller pages="0,idle,1,busy">`，被 `gearDisplay` 引用 |
| Transition | `transFade` | `<transition frameRate="60">` + 2 条关键帧轨道 |

## 快照

`initial-tree.json` / `initial-resources.json` / `initial-xml.xml` 由
FairyGUI Editor 6.1.4 回读并重新序列化后生成，不是手写占位。

## 命令

离线校验（不需要编辑器，CI 可直接跑）：

```bash
uv run python scripts/phase0_fixture.py verify
```

实况校验（需要编辑器打开 `sample` 工程）：

```bash
# 首次 clone 后 sample/plugins/ 是同步产物，需先安装插件
uv run fgui-agent --project sample update --apply

open -a ~/Downloads/FairyGUI-Editor.app sample/sample.fairy
uv run python -u scripts/phase0_fixture.py verify --live
```

`sample/plugins/` 是 `fgui-agent update` 同步过去的插件快照，按 §5.2 不入库；
`sample/.agent/` 与 `sample/.objs/` 是运行时状态，同样不入库。
入库的只有夹具定义本身（`sample.fairy`、`assets/`、`.gitignore`）。

重新抓取快照（夹具有意修改后）：

```bash
uv run python -u scripts/phase0_fixture.py capture
```

两种模式输出同一份 JSON 报告（`kind: fgui-bridge-phase0-report`）。
报告约定：失败项必须带 `target`（对象 id/路径）、`expected`、`actual`，
必要时带 `xmlFragment`，以便直接定位。

## 已知限制

Bridge 没有创建 List/Group/Controller/Loader 节点的 Action
（`insert_object` 只能插入已有包资源），所以该矩阵只能由工程文件承载。
Phase 4 若要提供这些节点的写入能力，需要先补编辑器侧的创建 Action。

本机 FairyGUI Editor 不在 `/Applications`，而在 `~/Downloads/FairyGUI-Editor.app`；
`EditorLauncher._find_default_editor()` 的第三个候选即该路径。
