# FGUI Agent Bridge 改进规划

> 适用范围：`/Users/wilson/fgui-agent-bridge` 及其同步到业务工程的 FairyGUI 插件、MCP、CLI 和 Skill。
>
> 编写日期：2026-09-20
>
> 目标：让 FairyGUI 的常规 UI 拼装、Lanhu 设计还原、资源替换、文字样式调整、动画配置和发布验证尽可能通过 Bridge 完成，减少对 Computer Use 原生界面操作的依赖。

## 当前完成情况（2026-09-20 核查）

以本仓库当前实现（本轮工作树、版本 `0.8.3`）、`tests/reports/` 中的既有 Editor 报告及本次 Python 测试为依据。

**标记约定：** `[x]` 表示该工作项已实现；`[ ]` 表示未完成，带“部分完成”说明的项目不可按整项验收。实现完成不等于 Editor、Unity 或真机验收通过。下文背景保留为规划提出时的问题描述，不代表所有问题仍完全未处理。

| 阶段 | 当前状态 | 已有能力与主要缺口 |
| --- | --- | --- |
| Phase 0 | 部分完成 | 八类对象隔离夹具、初始快照、统一 JSON 报告与测试命令已于 2026-10-15 落地（`scripts/phase0_fixture.py`、`sample/assets/Package1/BridgeFixture.xml`）；external reload 已于 2026-10-15 补齐并真机验证，「请求成功但未持久化」的自动断言仍只覆盖写 Action，`set_property` 等旧接口未纳入。 |
| Phase 1 | 部分完成 | locator、等待 Editor 响应、结构化错误、expected 比对和组件 XML 回读已实现；**external reload 已于 2026-10-15 完成并在 FairyGUI Editor 6.1.4 真机验证**（关闭方式实测为 `CloseDocuments`）；**2026-10-16 `set_property`/`insert_object`/`remove_object` 已迁入统一 `writeVerification` 语义并真机验证**，验证层新增 scale/rotation/alpha/visible/touchable/grayed/text/icon 通用属性；**同日 0.8.6 起全部 Transition 写操作与包资源写操作（创建/导入/MovieClip）已接入统一验证**：Transition 按 `<transition>` 名称与公开条目数验证、组件级 external reload；包资源按 `package.xml` 条目+资源文件验证、asset 类资源支持 `UnloadAsset`/`GetAsset` 重载；**0.8.7 起 `verify_document` 的 `expected` 支持递归 `children` 对象树比对**（`exact`/`subset` 模式、XML 阶段限活动文档序列化范围、external reload 整树重走），**已在 FairyGUI Editor 6.1.4 真机验证**。 |
| Phase 2 | 部分完成 | Image/Loader 替换已加入资源类型检查、稳定 ID 回定位、保存后 XML 回读；Button 状态、Controller page、字体及完整资源校验尚不能验收。 |
| Phase 3 | 部分完成 | 文本读写 API、字段校验、颜色规范化、字号/颜色/行距 XML 回读已实现；完整样式 schema、批量原子回滚未完成。 |
| Phase 4 | 部分完成 | **0.8.8 已实现** `set_list_layout`/`set_group_layout`/`set_relation`/`set_gear_display`/`set_controller`/`list_controllers` 六个 Action 并接入统一验证梯子（editor → save → 磁盘 XML → external reload）；模拟宿主 112 项全过，**已在 FairyGUI Editor 6.1.4 真机验证**（`tests/reports/phase4-live-0.8.8.json`）；List 的 numItems/item placeholder 写入、Controller page 批量资源替换尚未实现。 |
| Phase 5 | 部分完成 | Transition 类型校验、修改前快照、类型化轨道 API 已实现；自动同步关键帧、专用验证未完成；**0.8.12 已落地按真实 `PackSettings` 的图集约束分析（`analyze_atlas_fit`）并真机复验**，截图诉求由 P8-4 结论承担（Unity 侧渲染）。 |
| Phase 6 | 未完成 | 未找到标准 Lanhu manifest 生成、匹配和映射报告工作流。 |
| Phase 7 | 未完成 | 未找到组件截图、视觉差分或发布后 Unity 自动联调实现。**2026-10-19：Bridge 侧离屏截图路线已证伪并放弃**（见 P8-4），截图诉求改由发布后在 Unity 侧渲染承担；`preview_run` 交互预览仍待实现。 |
| Phase 8 | 部分完成 | **0.8.9 落地 P8-0 + P8-1 并通过真机复验**（Editor 6.1.4，证据 `tests/reports/p8-0-p8-1-live.json`）：属性写入优先走 `DocElement.SetProperty`、写 Action 回报 `writePath`、`save` 前置 fail-closed 检测静默保存；`plugin/types/editor.d.ts` 改为从真实声明生成，编译期可抓成员名/参数个数错误。**0.8.10 落地 P8-2 只读部分**：`query_references` / `query_dependencies` 走原生 `DependencyQuery`，引用精确到 `propKey`/`arrayIndex`，模拟宿主 129 项与 Python 33 项全过，**真机 6.1.4 已复验**（证据 `tests/reports/p8-2-live.json`）。**0.8.11 落地 P8-2 写侧**：`replace_references` 全工程替换，默认只预览、`--execute` 才写；实测发现原生 `ReplaceReferences` 只收 new 参数且立即落盘不进撤销栈、`fileName` 不跟随更新，因此验证只能按引用图口径并显式上报半状态，模拟宿主 137 项与 Python 35 项全过，**真机 6.1.4 已复验**（证据 `tests/reports/p8-2-write-live.json`）。**0.8.12 落地 P8-5 只读切片** `analyze_atlas_fit`：按真实 `PackSettings`（`padding`／下限放大／`maxWidth/maxHeight`／`square`／`rotation`）与全局 `AtlasSetting` 逐图判定 fit 与 binding，约束缺失时报 `unknown` 拒绝下结论，主产出是与旧大图硬编码规则的差异数 `disagreements`；纯只读，`publish` 仍按旧常量标记并以 `legacyRule.stillAppliedOnPublish` 显式声明。模拟宿主 150 项与 Python 35 项全过，**真机 6.1.4 已复验全局约束路径**（证据 `tests/reports/p8-5-atlas-fit-live.json`）；包级 `PackSettings` 路径真机无实例，仅模拟宿主覆盖。P8-5 写侧 `set_publish_settings`、`PublishHandler` 分步导出，以及 P8-3 ~ P8-7 规划完成未实现。原始发现：编辑器通过 Puerts 暴露的完整 API（`editor.d.ts`，FairyEditor.* 合计 184 类 / 2222 成员）已提取，Bridge 实际只用 18 个类型，计划中多项"未完成"能力编辑器原生就有入口。证据与 API 依据见 `docs/fgui-editor-api-capability-map.md`。 |

> **重排说明（2026-10-19）：** 本轮据此新增 Phase 8，并在 §7.1 给出按"能否清偿既有技术债"
> 重排的当前实际待办；Phase 6（Lanhu 工作流）顺延。证据、边界与 API 依据见
> `docs/fgui-editor-api-capability-map.md`，能力差集可用
> `python3 scripts/extract_editor_api.py --list-untouched plugin/main.ts` 复现。

### 核查证据与验收边界

- 本次执行 `uv run python -m unittest discover -s tests -q`：**29 项通过**（含 2026-10-15 新增的 5 项 Phase 0 夹具离线校验；模拟宿主内部另有 36 项回归）；这是 Python/协议与静态接口测试，不是真实 Editor 全流程验收。
- 既有 Editor 记录：`tests/reports/sample-p0-validation.json`、`sample-p0-retest.json`、`sample-p0-color-errors-retest.json`。较新的报告修复了早期颜色和错误码失败，但仍列出 Button 状态、自动 XML 回读、自动重载、批量原子性、lineGap 响应等缺口。
- **2026-10-15 已真机验证 external reload（本次唯一一次重新操作 Editor 的部分）：** 在 FairyGUI Editor 6.1.4 上对 `BridgeFixture.txtLabel` 执行「写入 + 保存 + 关闭重开 + 重新定位比对」，`strength` 为 `reload`，`verification.reload.performed` 为 true，重载后 `fontSize/color/lineGap` 与 `expected` 一致；关闭方式由运行时探测实测为 `CloseDocuments`，非假设。完整用例与环境记录见 `tests/reports/external-reload-live.json`。**仍未做：** 发布资源、刷新 Unity、Play Mode 或真机测试。
- **本轮已处理：** `writeVerification` 检查保存状态、读取组件 XML 与 expected 比对；`verifyDocument` 支持 expected 校验；external reload 与 `strength` 验证强度分级。**0.8.7 已补齐** `verify_document` 对象树比对：`expected` 支持递归 `children` spec（`childrenMode`：`exact` 默认按位置全等 / `subset` 按 id/name/index 定位），三阶段验证沿用同一梯子（editor 内存树 → 磁盘 XML 限活动文档序列化范围 → external reload 整树重走），模拟宿主 87 项全过；**已于 2026-10-16 在 FairyGUI Editor 6.1.4 真机复验**：BridgeFixture 根组件 exact 全树 10 节点通过（XML 覆盖 9、嵌套组件内部跳过 1）、subset 容忍多余节点、属性不符报 `editor_rejected`（details.node 定位到 `expected.children[i]`）、未定位子节点报 `target_not_found`、磁盘 XML 人为改坏报 `persistence_failed`(stage xml)、非根 target 子树的嵌套节点记入 `xmlSkipped`、`external_reload` 经 `CloseDocuments` 关闭重开后整树重走得 `strength:reload`。
- **2026-10-15 已补齐 Phase 0 夹具：** `tests/fixtures/phase0/initial-*.{json,xml}` 已由 FairyGUI Editor 6.1.4 回读并重新序列化生成（不再是空数组与占位注释），覆盖 Image/Loader/Button/Text/List/Group/Controller/Transition 八类对象；`scripts/phase0_fixture.py` 提供 `capture` / `verify [--live]` 两种模式并输出统一 JSON 报告。离线 12 项、实况 21 项校验全通过。**仍缺：** Bridge 无创建 List/Group/Controller/Loader 节点的 Action（`insert_object` 只能插入已有包资源），这 4 类节点只能由工程文件承载，并已验证编辑器可加载与重写它们。
- **2026-10-15 修复「XML 缺省属性导致假失败」：** FairyGUI 序列化时会省略仍为默认值的属性，而 `persistedObjectValues` 把缺失属性读成 `null`，导致断言任何默认值属性（典型如默认色 `#FFFFFF`、默认对齐 `left`）时抛出**虚假的** `persistence_failed`——表现像严重的持久化故障，足以诱发对正确改动的错误回滚。修复把缺失属性解析为 FairyGUI 默认值，使「期望默认值」通过、「期望非默认值而 XML 缺失」仍然失败关闭。原有测试 `Read-only verify compares expected Editor and disk` 此前是因为夹具把默认属性也写进 XML 才通过，属于因错因通过，已随夹具改为真实序列化行为而转为因对因通过。**已于 2026-10-16 在 FairyGUI Editor 6.1.4 真机复验**：`verify_document` 断言 XML 缺失的默认属性 `align:"left"` 通过（`persisted:true`、`strength:disk`）；断言 `align:"center"` 在「内存已改、磁盘未存」时仍以 `persistence_failed`（stage `xml`）失败关闭；`set_text_style fontSize:36 --save --external-reload` 经 `CloseDocuments` 关闭重开后回读一致（`strength:reload`），随后已还原 fontSize:32。同时修复夹具脚本一个跨会话假失败：`get_tree` 中 List item 实例等运行时节点的 id 由编辑器按会话分配（如 `n0_dftm`→`n0_jrnu`），`snapshot.tree.match` 现只严格比对持久化到组件 XML 的 id，运行时节点仅比对 name/type/结构。证据见 `tests/reports/phase0-live-recheck.json`。
- **2026-10-16 `set_property`/`insert_object`/`remove_object` 迁入统一写验证（0.8.5）：** 三个 Action 复用 `writeVerification`/`validateReloadOptions`，返回统一的 `{ok,target,before/after,documentModified,saved,persisted,strength,verification,note}` 并支持 `save`/`verify`/`externalReload`。`set_property` 保留 Agent 属性事务栈，新增类型归一化（数值/布尔/字符串在写入前校验）与 `font` 的 `ui://` 解析；验证层 `VERIFIED_KEYS` 扩展 `scaleX/scaleY/rotation/alpha/visible/touchable/grayed/text/icon` 通用属性（序列化名与默认值已按 6.1.4 实测钉住，如 `visible` 仅在 `false` 时序列化）。`remove_object` 改为缺失性验证：编辑器回读确认不可解析、保存后磁盘 XML 不含节点 id、external reload 重开后仍缺失才报 `persisted`；`insert_object` 验证新节点 `id/name/type/x/y`（含引用时 `resourceURL`）。模拟宿主 51 项全过；真机 6.1.4 已验证 `x`、`visible` 双向、`scaleX` 关闭重开、insert 磁盘回读与 remove 重载后仍缺失。Transition/MovieClip/创建导入类 Action 未在本轮接入。
- **2026-10-16 剩余写 Action 迁入统一写验证（0.8.6）：** `mutateTransitions` 拆分 mutation 与验证：验证失败（如保存失败）不再触发快照回滚，与对象级写一致；新增 `transitionWriteVerification`/`writePackageVerification` 两条等效梯子。Transition 验证 `<transition>` 名称与公开条目数（tween 合成端点按磁盘序列化折叠），`externalReload` 关闭重开文档后在新文档上重读 Transition 集合并回报 `closeStrategy`；包资源验证 `package.xml` 条目 + `checkFile` 资源文件，image/sound/font/movieclip 的 `externalReload` 为 `UnloadAsset` + `GetAsset` asset 重载，组件创建与删除按 `invalid_argument` 在任何变更前拒绝该参数。`mutateTransitions` 变更前统一走 `validateReloadOptions`，不允许 `externalReload` 缺 `save` 或配 `verify:false`。响应统一带 `saved`/`persisted`/`strength`/`verification`/`note`，`requiresSave` 改为按实际保存结果返回。MCP/CLI 同步暴露 `save`/`verify`/`external_reload`。模拟宿主扩到 71 项全过（含 Transition 三态、stale XML、reload 丢值、包清单回读与缺失性验证）。**真机 6.1.4 已复验**：`upsert_transition`/`add_transition_item` 磁盘回读正确（tween 折叠 itemCount）、`remove_transition` external reload 经 `CloseDocuments` 关闭重开后仍缺失、`create_movieclip --save --external-reload` 走 asset 重载得 `strength:reload`、`remove_movieclip` 保存后包清单缺失、`create_component` 清单回读 `strength:disk`。真机还抓到一个名称归一化时序问题：`item.name` 在 MovieClip 创建时不带扩展名而 `package.xml` `name` 为文件名，已改为按去扩展名归一化比对。
- **0.8.8 Phase 4 落地（本轮）：** 新增 `set_list_layout`/`set_group_layout`/`set_relation`/`set_gear_display`/`set_controller`/`list_controllers` 六个 Action。布局字段经类型化校验后优先写对象模型成员（编辑器对象模型中 List/Group 布局成员本身就是序列化字符串），未暴露成员回退 `GetProperty`/`SetProperty`；未知字段报 `unsupported_property`，不产生半写入。Relation/gearDisplay 验证对象节点下的 `<relation>`/`<gearDisplay>` 子元素，Controller 验证顶层 `<controller>` 元素；三者均在 external reload 后按名称/id 在新文档上重新定位。枚举型序列化属性缺省时计入 `verification.xmlSkippedKeys`（不当作失败，也不声称已验证）。模拟宿主扩到 112 项全过。**已在 FairyGUI Editor 6.1.4 真机复验**（`tests/reports/phase4-live-0.8.8.json`，含 list/group 写存重载、relation/gear/controller 全链路与全部错误路径），真机暴露了三个模拟宿主无法发现的问题并已全部修复：①`GetPageNames()` 返回 `id:name` 混合串（页面名改用 `GetPages().name`）；②`FRelations.Reset()+AddItem` 绕过文档模型会使文档卡在 modified 且 save 静默失败（relation 写入改为 `DocElement.UpdateRelations`）；③`GetGear` 返回空接口 `IGear`（gearDisplay 读写改为 `DocElement.UpdateGears`/`FObject.WriteGears`），另确认 `scrollItemToViewOnClick` 序列化默认为 `true`、`selectionMode` 非默认才序列化、`clearOnPublish` 等是公开字段而非 `SetProperty` 属性。
- capability 文档实际路径为 `.agents/skills/fgui-agent-bridge/references/current-capabilities.md`，而非仓库根目录 `references/`。
- **环境记录（2026-10-15 夜）：** FairyGUI Editor 反复进入「进程存活但插件 `onUpdate` 停摆」的状态——桥接写入一次 status 后心跳即冻结，请求长期滞留在 `requests/` 不被认领。已排除插件自身原因（快照 `main.js` 与仓库字节完全一致且结尾完整；Player.log 中 `JsEnv has been disposed!` 是 Puerts 在编辑器关闭时的收尾噪音，非运行期异常）。已观察到两点可复现规律：编辑器**退到后台会被节流**，`App.runInBackground = true` 并未完全避免；以及工程打开后 `activeDocument` 可能为 `null`。同一现象在 20:07（尚未改动该修复时）也出现过，因此与本次修复无因果关系。后续真机复验前建议先手工打开编辑器并确认已有活动文档。

---

## 1. 背景与当前问题

本次拳击 HUD UI 拼装验证了 Bridge 的基础能力，但也暴露出以下问题：

### 1.1 图片资源替换语义不完整

当前 `import_image` 可以可靠地替换磁盘上的同名图片，并保持资源 ID，但它不等同于修改组件节点引用。

已出现过以下情况：

- `set_property(icon, ...)` 返回成功，但 XML 中的图片引用没有变化；
- 图片节点、Loader、Button 状态图、Controller page 资源引用没有统一的替换接口；
- 同名资源、不同目录、不同 package 的 `ui://` URL 容易混淆；
- 资源替换成功和组件引用替换成功没有统一的持久化验证。

### 1.2 文本样式属性覆盖不足

UI 设计还原经常需要同时修改：

- 字体资源；
- 字号；
- 颜色；
- 横向和纵向对齐；
- 自动缩放；
- 行距；
- 描边；
- 阴影；
- 文本框尺寸和基线位置。

目前这些属性没有通过一个稳定的文本样式接口统一暴露。部分属性只能依赖原生编辑器面板或直接检查 XML。

### 1.3 高级布局属性不是通用属性

FairyGUI 的列表、Group、关系和 Controller 属性具有特殊语义，不能全部当作普通 `x/y/width/height` 处理：

- `List.lineGap`、布局类型、自动 Item 尺寸；
- Group 的 `colGap`、`rowGap`、`excludeInvisibles`；
- `Relation` 的绑定目标和 sidePair；
- Controller 的 page、selectedIndex 和 gearDisplay；
- Button 状态和各状态资源；
- 根节点 `opaque`、`touchable` 等行为属性。

当前 Bridge 读取能力比写入能力完整，写入后也缺少统一的 XML 回读确认。

### 1.4 修改结果验证不够严格

当前某些 Action 只返回“请求成功”或对象内存中的 after 值，但没有确认：

1. FairyGUI 编辑器是否真正接受；
2. 当前文档是否已保存；
3. XML 是否已写入预期值；
4. 外部重新加载后值是否仍然存在；
5. 发布后的 `.bytes`、图集和资源引用是否正确。

这会造成“API 成功，但实际 UI 没有改变”的假成功。

### 1.5 视觉验证依赖 Computer Use

Bridge 当前可以读取结构和属性，但不能独立完成：

- 组件预览截图；
- 当前编辑器状态截图；
- Transition 关键帧视觉结果；
- Controller page 切换后的状态检查；
- 发布前后资源画面比较。

因此 UI 任务中仍需要频繁使用 Computer Use。

### 1.6 Lanhu 到 FairyGUI 的映射缺少标准工作流

Lanhu 切图通常包含：

- Android 密度规格；
- 设计稿逻辑坐标；
- 多个同名或近似命名的切图；
- 中英文素材；
- 同一资源的不同状态或方向。

目前这些映射主要靠任务脚本和人工判断，缺少标准化的 manifest、尺寸、哈希、目标节点和引用验证模型。

---

## 2. 总体目标

### 2.1 功能目标

Bridge 应能覆盖以下完整闭环：

```text
读取 FairyGUI 工程
  → 读取组件和资源
  → 修改节点结构与属性
  → 修改资源引用
  → 修改动画和 Controller
  → 保存并重新读取验证
  → 发布指定包
  → 检查发布产物
  → 输出可视化预览和变更报告
```

### 2.2 可靠性目标

所有写操作都必须能够区分：

- 请求已接收；
- 编辑器已执行；
- 文档内存已修改；
- XML 已保存；
- 发布已完成；
- 发布产物已验证。

任何一步未完成，Action 都不能返回最终成功。

### 2.3 Computer Use 使用目标

Computer Use 不应被完全禁止，而应降级为：

- 初次安装或登录编辑器；
- Bridge 没有覆盖的原生设置；
- 最终人工视觉验收；
- 异常恢复和诊断。

常规 UI 拼装不应依赖鼠标点击属性面板。

---

## 3. 设计原则

### 3.1 以 FairyGUI 编辑器语义为真源

不要只修改 XML 字符串。所有能力应优先调用 FairyGUI Editor API，确保：

- 节点对象类型正确；
- Controller、Relation、Transition 等内部结构完整；
- 编辑器可继续打开和编辑；
- XML 序列化格式由编辑器负责。

直接 XML 修改只能作为诊断、回读和兼容性检查手段。

### 3.2 Action 语义要高于通用属性白名单

不要继续无限扩大 `set_property` 的字符串白名单。应将复杂语义拆成明确 Action，例如：

- `replace_object_resource`；
- `set_text_style`；
- `set_list_layout`；
- `set_group_layout`；
- `set_relation`；
- `set_controller_page_resource`。

这样能减少参数误用，也方便进行类型校验和持久化验证。

### 3.3 写入后必须回读

每个写 Action 都应实现：

```text
resolve target
  → read before
  → validate input
  → apply editor mutation
  → save or mark dirty
  → read after from editor object
  → serialize / reload if requested
  → return before / after / persisted
```

### 3.4 资源替换必须保留身份

资源替换默认应保持：

- package；
- folder；
- item ID；
- resource name；
- exported 状态；
- atlas 配置；
- 组件引用 URL。

如果用户明确要求新增资源，才允许生成新 ID，并返回旧引用和新引用的映射表。

### 3.5 设计数据、逻辑数据、运行时数据分层

Lanhu 设计中的：

- 设计稿坐标；
- Android 导出尺寸；
- FairyGUI 组件尺寸；
- Unity 运行时缩放和位置；

必须分别保存，不能将其中一个值隐式当成另外三个值。

---

## 4. 分阶段实施计划

## Phase 0：基线、诊断和测试夹具

### 目标

建立能够复现当前问题的最小 FairyGUI 隔离工程和自动化测试夹具。

### 工作项

- [x] 固定 FairyGUI Editor 版本和 Bridge 插件版本。（2026-10-15 实测：编辑器 Info.plist 报告 `6.1.4`，`sample` 工程插件 `0.8.3`，`status.versionMatch = true`；两者一并写入 `verify --live` 的报告 `editor` 段。）
- [x] 创建隔离测试工程，包含：（已落地 `sample/assets/Package1/BridgeFixture.xml`，八类对象全部就位并经编辑器往返重写验证。）
  - 一个普通 Image；→ `imgIcon` (`n0_fix01`)
  - 一个 Loader；→ `loaderItem` (`n1_fix01`)
  - 一个 Button；→ `btnMain` (`n3_fix01`，引用 `extention="Button"` 的 `BridgeTestButton.xml`)
  - 一个 Text；→ `txtLabel` (`n2_fix01`)
  - 一个 List；→ `listItems` (`n4_fix01`)
  - 一个 Group；→ `grpRows` (`n7_fix01`，子节点用 `group="n7_fix01"` 反向引用)
  - 一个 Controller；→ `ctrlState`，被 `imgIcon`/`loaderItem` 的 `gearDisplay` 引用
  - 一个 Transition。→ `transFade`（frameRate 60，2 条关键帧轨道）
- [x] 为每个对象记录初始 XML、对象树和资源 URL。（`initial-tree.json`（17 节点）、`initial-resources.json`（6 项）、`initial-xml.xml`（1818 字节）均由编辑器回读/重写后生成。）
- [ ] 补充 Action 的“请求成功但未持久化”回归测试。（部分完成：已有人工 Editor 回归报告；2026-10-15 起 `verify --live` 会同时比对编辑器内存对象树、磁盘 XML 与包资源快照，可发现偏离，但尚未对写 Action 自动执行"写入→重载→断言"闭环。）
- [x] 将测试夹具放在独立 Bridge 仓库，不污染业务工程。（隔离工程为仓库内 `sample/`，夹具目录 `tests/fixtures/phase0/`。）
- [x] 建立统一的测试命令和 JSON 报告格式。（`scripts/phase0_fixture.py capture` / `verify [--live]`，报告 `kind: fgui-bridge-phase0-report`；失败项必须带 `target`/`expected`/`actual`/`xmlFragment`。离线用例已接入 `tests/test_phase0_fixture.py`。）

### 验收标准

- 可以在隔离工程中稳定复现 `icon` 修改不落盘问题；（夹具备齐，但"写入→重载→断言"尚未自动化）
- 可以区分内存修改、保存成功和重新加载成功；（已区分编辑器内存树与磁盘 XML；外部重载仍返回 false）
- 测试失败时能输出对象 ID、路径、before、after 和 XML 片段。（已满足：`verify` 报告失败项带 `target`/`expected`/`actual`/`xmlFragment`）

---

## Phase 1：目标定位和持久化验证层

### 目标

先解决所有 Action 共用的可靠性问题，再增加更多属性。

### 工作项

- [x] 统一 target locator（`resolveObject` 已支持以下定位，name/resourceURL 有唯一性检查；不代表所有路径歧义均已回归）：
  - `id`；
  - `path`；
  - `name`；
  - `resourceURL`；
  - 唯一性校验。
- [x] 所有写 Action 返回统一结构：（0.8.6 完成：`replace_object_resource`、`set_text_style`、`verify_document`、`set_property`、`insert_object`、`remove_object` 走 `writeVerification`；全部 Transition 写操作走 `transitionWriteVerification`（`<transition>` 名称+公开条目数，`externalReload` 为关闭重开文档）；全部包资源写操作（`create_component`、`create_button`、`import_image`/`import_font`/`import_sound`、`create_movieclip`/`update_movieclip`/`remove_movieclip`）走 `writePackageVerification`（`package.xml` 条目+资源文件，image/sound/font/movieclip 支持 asset `UnloadAsset`/`GetAsset` 重载，组件创建与删除 `strength` 上限 `disk`）；统一返回 `saved`/`persisted`/`strength`/`verification`/`note`，删除类按缺失性验证。）

```json
{
  "ok": true,
  "target": {
    "id": "n7_jfoi",
    "path": "root/n7",
    "type": "text"
  },
  "before": {},
  "after": {},
  "documentModified": true,
  "saved": true,
  "persisted": true,
  "strength": "reload",
  "verification": {
    "editorReadback": true,
    "xmlReadback": true,
    "externalReload": true,
    "reload": {
      "performed": true,
      "url": "ui://qsezbqtwfix01",
      "closeStrategy": "CloseDocuments",
      "values": {}
    }
  }
}
```

`strength` 是 2026-10-15 新增的必需字段，`persisted: true` 的强度必须由它界定，不能再让二者脱钩：

| strength | 含义 | 能否排除「磁盘正确但重载丢值」 |
| --- | --- | --- |
| `reload` | 保存后关闭重开，在从磁盘重新载入的文档上重新定位并比对通过 | 能 |
| `disk` | 仅保存成功且磁盘 XML 匹配 | 不能 |
| `none` | 未验证持久化 | 不能 |

- [x] 增加 `verify_document` Action：（0.8.7 补齐对象树比对：`expected` 支持递归 `children`/`childrenMode`/`index` spec，editor 内存树、磁盘 XML（限活动文档序列化范围）与 external reload 三阶段整树比对；含 `children` 时 `target` 可省略默认根组件。）
  - 重新读取活动文档；✓
  - 对比对象树；✓（exact 按位置全等 / subset 按 id/name/index 定位）
  - 对比关键属性；✓（spec 节点沿用 VERIFIED_KEYS 断言）
  - 检查 XML 是否包含预期值。✓（覆盖根节点 + displayList 直接子节点；嵌套组件内部记入 `xmlSkipped`）
- [x] 保存后支持可选的 external reload 验证。（2026-10-15 完成并真机验证：`externalReload: true` 会在保存后关闭当前文档、重新打开、在新文档上按 target 重新定位并比对 `expected`。关闭方式不硬编码，运行时按 `CloseDocuments` → `CloseDocument` 依次探测并在 `verification.reload.closeStrategy` 回报实测结果；FairyGUI Editor 6.1.4 实测命中 `CloseDocuments`。响应新增 `strength` 字段（`reload` / `disk` / `none`）标明验证强度，使 `persisted: true` 的含义不再有歧义。要求 save、拒绝 `verify:false` 冲突、关闭后不触碰旧句柄均已实现并覆盖。证据见 `tests/reports/external-reload-live.json`。）
- [x] 避免只返回请求队列已写入；必须等待编辑器响应。（Python Bridge client 按请求 ID 等待响应。）
- [ ] 统一错误类型：target not found、ambiguous target、unsupported property、editor rejected、persistence failed、publish failed。（部分完成：结构化错误映射和 Python 透传已实现，缺目标/非文本/非法颜色有 Editor 证据；真实持久化失败检测未完成。）

### 验收标准

- 任一修改 Action 都不再出现“响应成功但 XML 未改变”的静默失败；
- CLI、MCP 和插件返回语义一致；
- 同一请求重复执行不会制造重复资源或重复节点。

---

## Phase 2：资源引用与状态资源管理

**状态：部分完成。** `replace_object_resource` 已贯通插件、Python capability、MCP、CLI；Image 使用 Editor `ReplaceSelection`，Loader 设置 `url`。下述支持矩阵及安全校验仍是目标，不能因为接口存在就视为全部完成。Button 的 `state` 参数尚不构成可靠的逐状态替换实现。

### 目标

消除 UI 拼装中最常见的 Computer Use 依赖：资源引用替换。

### 新增 Action

```text
replace_object_resource
```

### 支持对象

- Image：修改 `src`；
- Loader：修改 `url`；
- Button：修改 `up/down/over/selectedOver/disabled/selectedDisabled`；
- Controller page：修改指定 page 下可见的图片引用；
- Component：修改指定子节点的引用；
- MovieClip：替换已有资源或更新帧；
- Font：替换位图字体图片但保持原字体资源 ID。

### 参数建议

```json
{
  "target": { "id": "n12_ox87" },
  "resourceURL": "ui://b2h3m3n2ap2z95",
  "expectedType": "image",
  "preserveSize": true,
  "verify": true
}
```

### 安全校验

- 校验资源存在；
- 校验 package 和资源类型；
- 校验 Button 状态是否合法；
- 可选检查尺寸变化；
- 记录旧 URL、新 URL；
- 保存后回读组件 XML；
- 如果资源跨 package，明确返回 package 依赖变化。

### 验收标准

- 不再需要通过原生“替换元件”菜单修改普通图片引用；
- Controller 状态图切换可完全脚本化；
- 组件中所有引用 URL 都可被准确列出和验证。

---

## Phase 3：文本样式和排版 API

**状态：部分完成。** `set_text_style` / `get_text_style` 已贯通各入口；文本类型与颜色检查已实现。尚无严格完整字段白名单/样式 schema，描边阴影完整语义及数值范围、批量事务尚待补齐；`lineGap` 写入映射为 `leading`，读取未对称返回。

### 目标

通过一个类型化接口完成蓝湖设计中的文字还原。

### 新增 Action

```text
set_text_style
get_text_style
```

### 建议支持字段

```json
{
  "font": "ui://font-package/font-id",
  "fontSize": 40,
  "color": "#FFFFFF",
  "align": "center",
  "vAlign": "middle",
  "autoSize": "shrink",
  "lineGap": 0,
  "letterSpacing": 0,
  "stroke": {
    "enabled": true,
    "color": "#000000",
    "width": 2
  },
  "shadow": {
    "enabled": true,
    "color": "#00FFBA",
    "offsetX": 1,
    "offsetY": 1
  }
}
```

### 实施要求

- 先读取对象类型，只有 TextField、RichText 等文本对象允许调用；
- 对颜色统一规范为 `#RRGGBB` 或 `#RRGGBBAA`；
- 对字号、描边宽度、行距进行数值范围校验；
- 设置字号后读取 FairyGUI 实际自动调整后的文本框尺寸；
- 明确区分 `font` 资源和 `fontSize`；
- 支持批量设置多个文本节点，保持事务原子性。

### 验收标准

- 暂停标题、按钮文字、得分文本和计时文本可以不打开属性面板完成修改；
- 修改后 XML 的字号、颜色、字体和对齐值可自动回读；
- 批量设置失败时支持整体回滚。

---

## Phase 4：List、Group、Relation 和 Controller

**状态：部分完成（0.8.8）。** 六个专用 Action 已实现，模拟宿主 112 项与 FairyGUI Editor 6.1.4 真机复验均通过。

### 目标

覆盖复杂 UI 布局，避免使用原生编辑器面板修改高级属性。

### 新增 Action（0.8.8 已实现）

```text
set_list_layout
set_group_layout
set_relation
set_controller
set_gear_display
list_controllers   # 附加的只读 Action
```

### 已实现范围（0.8.8）

- List：`layout`（语义名或序列化值，内部经 `FList` 常量解析）、`selectionMode`、`lineGap`/`columnGap`、`defaultItem`（必须是 `ui://` 组件资源）、`autoItemSize`、`align`/`vAlign`、`selectionController`（校验控制器存在）、`foldInvisibleItems`、`clearOnPublish`、`scrollItemToViewOnClick`、`overflow`、`margin`；对象模型未暴露的属性回退 `GetProperty`/`SetProperty`。
- Group：`advanced`、`layout`（`horizontal`/`vertical` 或 `hz`/`vt`）、`lineGap`/`columnGap`、`excludeInvisibles`、`mainGridMinSize`/`mainGridIndex`、`autoSizeDisabled`、`collapsed`；layout 系字段仅对 `advanced=true` 高级组有效。
- Relation：`set_relation` 为整体替换语义，`relations` 每项为 `{target（缺省=父组件）, sidePair}` 或 `{target, pairs:[{source,target,percent?}]}`；sidePair 校验方向合法性；空 sidePair 条目不参与比对。
- gearDisplay：`controller` + `pages`（页面 id 或名称，名称解析为 id）；`controller` 为空清除联动并清空 pages；写入优先 `DocElement.UpdateGears`（保留其他 gear 子元素），读取走 `FObject.WriteGears()`（`GetGear` 返回空接口 `IGear`），回退 `SetGearProperty`/`GetGear` 成员路径。
- Controller：`create`/`remove`、pages 整体替换（重新分配页面 id）、`addPages` 追加、`selectedIndex`/`selectedPage`；XML 阶段比对顶层 `<controller>` 元素的名称、页面集与 `selected`。
- 五个写 Action 统一 `save`/`verify`/`externalReload` 验证梯子；枚举型序列化属性缺省时计入 `verification.xmlSkippedKeys`。

### 尚未实现

- List 的 `numItems` / item placeholder 写入、`repeatX`/`repeatY`/`indent`/`treeViewEnabled`；
- Controller 每个 page 下的批量资源替换（`set_controller_page_resource`）；
- `exported`/`autoRadioGroupDepth`/`homePage` 已可写，但验证层只钉住 `pageCount`/`pageNames`/`selectedIndex`。

### Relation 参数示例

```json
{
  "target": { "id": "n45_jfoi" },
  "relations": [
    { "sidePair": "right-right" },
    { "target": { "id": "n1_xxxx" }, "pairs": [{ "source": "width", "target": "width" }] }
  ]
}
```

### 验收标准

- 拳击 HUD 的左右轨道、拳靶列表、三段进度条可以完全通过 API 对齐；
- Controller 状态切换在编辑器预览和 XML 中一致；
- 修改 Relation 后重新打开组件不会丢失绑定。

---

## Phase 5：Transition 和 MovieClip 工具增强

### 目标

让动画修改具备安全的读取、编辑、预览和验证闭环。

### 工作项

- [x] 增加 transition schema 校验（已有类型、字段、target 和参数校验）；
- [x] 修改关键帧前自动保存 before 快照（内存事务快照及 Agent undo/redo，不等同于磁盘备份）；
- [x] 对 XY、Size、Scale、Alpha、Color、Text、Icon 等轨道提供类型化 API；
- [ ] 支持根据节点属性变化自动更新相关关键帧；
- [ ] 增加 `verify_transition`：检查 target 是否存在、关键帧是否超出对象范围；
- [ ] ~~预览后导出指定帧截图~~（2026-10-19：Bridge 侧离屏渲染不可行，见 P8-4；改由 Unity 侧承担）
- [ ] MovieClip 支持帧尺寸、透明边界、FPS 和循环参数报告（部分完成：已有创建/更新/读取/预览能力，未覆盖完整报告）；
- [ ] 对大图和大帧集给出 atlas/alone 建议。（部分完成：已有发布前大图 alone 处理，未见完整大帧集分析建议。）

### 验收标准

- 修改文本位置后，相关 Transition 不会继续使用旧坐标；
- 预览帧截图可作为 UI 评审证据；
- MovieClip 修改后资源引用和帧序列均可自动验证。

---

## Phase 6：Lanhu 设计到 FairyGUI 的标准映射工作流

**状态：未完成。** 尚未找到下述标准工作流实现及端到端报告。

### 目标

将 Lanhu 的切图和标注转换为可验证的 FairyGUI 变更计划。

### 建议生成的 manifest

```json
{
  "design": "核心HUD",
  "designId": "a7a08486-feae-476e-8e9a-8266c65675e8",
  "canvas": { "width": 2560, "height": 1440 },
  "density": "android_xxxhdpi",
  "assets": [
    {
      "sliceId": 1359,
      "name": "img_node",
      "sourcePath": "/absolute/source.png",
      "sha256": "...",
      "width": 90,
      "height": 90,
      "target": {
        "package": "Common",
        "folder": "Sprite",
        "resourceName": "img_node",
        "resourceId": "ci5i1z"
      },
      "operation": "replace",
      "verified": true
    }
  ]
}
```

### 工作流

1. 读取 Lanhu 设计列表；
2. 读取指定设计的切图；
3. 固定 Android 导出规格；
4. 下载并计算 SHA-256；
5. 按名字、尺寸和用途匹配目标资源；
6. 对同名资源进行人工或规则确认；
7. 通过 Bridge 替换资源；
8. 回读资源 ID、尺寸和引用；
9. 应用组件布局和文本样式；
10. 发布目标包；
11. 输出变更清单和未映射素材清单。

### 验收标准

- 不再将“已下载”误报为“已替换”；
- 不再按文件名盲目覆盖重名箭头、动作图标或多语言素材；
- 每张设计切图都能标记为：已替换、已存在且一致、未使用、待确认。

---

## Phase 7：视觉快照和 Unity 联调

### 目标

减少人工点击，同时保持视觉验收边界清晰。

### Bridge 侧

- [ ] ~~增加组件静态预览截图 Action~~（2026-10-19：随 P8-4 一并放弃，`render_component` 经真机验证只会产出全透明空图）
- [ ] 支持指定组件、指定 Controller page、指定 Transition frame；
- [ ] ~~支持导出透明背景和设计尺寸截图~~（2026-10-19：随 P8-4 一并放弃）
- [ ] 输出节点边界、资源名和字体信息叠加层；
- [ ] 生成 before/after 对比图。

### Unity 侧

- [ ] 发布后自动调用 Unity Codely refresh；
- [ ] 检查 Console 错误和警告；
- [ ] 提供可选的静态场景截图；
- [ ] 提供可选的 Play Mode UI 截图；
- [ ] 报告编辑器刷新、静态预览、Play Mode 和真机验证的不同状态。

### 验收标准

报告必须明确区分：

- Bridge 结构验证；
- FairyGUI 编辑器视觉验证；
- Unity 刷新/编译验证；
- Unity Play Mode 验证；
- Android 真机验证。

---

## Phase 8：编辑器原生能力复用（2026-10-19 逆向分析新增）

**状态：P8-0、P8-1 已落地（0.8.9，模拟宿主 118/118、Python 31/31、tsc 0 error，**并已在 FairyGUI Editor 6.1.4 真机复验**）；P8-2 只读部分已落地（0.8.10，模拟宿主 129/129、Python 33/33、tsc 0 error，**已在 FairyGUI Editor 6.1.4 真机复验**，证据 `tests/reports/p8-2-live.json`）；**P8-2 写侧已落地（0.8.11，模拟宿主 137/137、Python 35/35、tsc 0 error，已在 FairyGUI Editor 6.1.4 真机复验，证据 `tests/reports/p8-2-write-live.json`）**；P8-3 ~ P8-7 规划完成，实现未开始。** 本阶段由 FairyGUI Editor 逆向分析得出，证据、
能力差集与 API 依据见 `docs/fgui-editor-api-capability-map.md`。

### 背景

FairyGUI Editor 通过 Puerts 把内部 C# API 绑定给插件 JS，并把绑定结果**以声明文件明文放在编辑器包内**：

```text
Contents/Resources/Data/StreamingAssets/Scripts/Puerts/editor.d.ts   21708 行
```

其中 FairyEditor 命名空间有 184 个类型 / 2222 个成员。`plugin/main.ts` 目前实际只引用
**21 个**（FairyEditor 根命名空间 150 类中的 21 类），129 个类型完全未触及。这意味着大量"计划里标为未完成"的能力，
编辑器原生就有入口，不需要自造。

能力差集可复现：

```bash
python3 scripts/extract_editor_api.py --list-untouched plugin/main.ts
```

> 声明清单只对 **6.1.4** 有效；升级 FairyGUI Editor 后必须重新提取并 diff。
> 声明 ≠ 运行时可用（`GetGear` 返回空接口 `IGear` 即是反例），新增 Action 仍需真机验收。

### P8-0 写入路径归位（最先做，后续新增能力的前提）

Phase 4 真机已暴露两个同根问题：`FRelations.Reset()+AddItem` 绕过文档模型导致
save 静默失败、`GetGear` 返回空接口。根因是**直接改 F\* 对象模型而不是走文档模型层**。

编辑器自带的文档模型中介层只有 21 个方法，但覆盖全部写入口：

```csharp
DocElement.SetProperty / SetGearProperty / UpdateGears
DocElement.SetRelation / RemoveRelation / UpdateRelations
DocElement.SetExtensionProperty / SetChildProperty
DocElement.SetVertexPosition / SetVertexDistance / SetScriptData
```

工作项：

- [x] 逐个审计现有 Action 的写入路径：属性写入已改为优先走 `DocElement.SetProperty`（与
      `FObject.SetProperty` 签名一致），对象模型保留回退；`opaque` 维持成员写入（文档模型无入口）；
      布局成员、Transition 条目等既有路径经 0.8.8 的 save → XML → external reload 梯子已实证可持久化，
      本轮不改（详见下方「本轮实际发现」）。
- [x] 写入路径回报：所有经 `writeVerification` 的写 Action 返回 `writePath`
      （`document-model` / `object-model`），绕过文档模型成为可观测事实。
- [x] 在 `save:true` 前置断言「内存已变但文档未进入修改状态」，以
      `persistence_failed`（`stage: "modified"`）在 `doc.Save()` **之前**失败关闭；
      幂等写入不触发该检查（目标值与现值相同时文档保持未修改是正确的）。
- [x] 回归测试：模拟宿主新增 6 项（文档模型优先 / 失败回退 / 静默保存 fail-closed / 幂等写入不误报 /
      无 docElement 时的路径回报 / writePath 不得跨 action 继承），总数 112 → **118 全过**。
- [x] **真机复验（2026-10-19，Editor 6.1.4）**：10 条写 Action 的 `writePath` 全部与实际写入层
      一致，`set_property --external-reload` 得 `strength:reload`。证据：
      `tests/reports/p8-0-p8-1-live.json`。复验中发现并修复了本轮引入的两个缺陷：
      ①`writePath` 谎报（未声明的写路径继承上一个 action 的值，详见「本轮实际发现」）；
      ②`replace_object_resource` 漏报（Image 走 `Document.ReplaceSelection` 属文档模型，
      Loader 走 `FLoader.url` 属对象模型，已分别声明）。

#### 本轮实际发现（0.8.9）

审计 49 个 Action 的写入路径后，最重要的结论是：**Bridge 过去对所有写 Action
统一手工调用 `doc.SetModified(true)`**。那不是可选项而是补丁——它只骗过
"要不要保存"这个开关，文档内部状态与序列化结果仍然可能不一致，而这种不一致
往往要到 external reload 才暴露，表现为"内存已改、磁盘没改"。

`DocElement.SetProperty` 与 `FObject.SetProperty` 签名完全一致
（`editor.d.ts` L20114 / L17537），所以属性写入换层是零风险的签名级替换；
但 `opaque` 只存在于 `FComponent` 成员、文档模型没有入口，保留成员写入。

**真机复验暴露的第二个缺陷（已修）：**`writePath` 会**谎报**。`lastWritePath` 原本只在
`setWritableProperty`/`writeObjectProperty` 里赋值，而 `set_text_style`、List/Group 布局成员、
`FController`、`FTransitions` 这些走直接成员赋值的路径从不赋值——它们会报出上一个 action
留下的值。实测 `set_text_style` 紧跟在 `set_property` 之后时，会把成员赋值报成
`document-model`。修复：①每个请求入口 `beginWrite()` 重置为 `null`；②每条写路径显式声明
写入层；③四条验证链（对象 / Controller / Transition / 包资源）统一回报 `writePath`；
④补 mock host 回归用例钉住。**教训：诊断字段一旦靠"上一次的值"兜底，它就会变成谎报——
宁可报 `null`（unknown），也不能给出一个看起来可信的错误答案。**

布局成员（`assignLayoutMember`）与 Transition 条目仍是对象模型写入，本轮**未改**：
它们的持久化已被 0.8.6~0.8.8 的 save → 磁盘 XML → external reload 梯子实证过，
换层属于无证据的改动，风险大于收益。它们现在会通过 `writePath` 字段被显式暴露，
后续若出问题可以据此定位。

### P8-1 编译期类型校验（工程性前置，零运行时成本）

`plugin/types/editor.d.ts` 目前是 1476 字节手写 stub，注释写明"用 any 是为了避免复制
FairyGUI 生成的大体积声明文件"。代价是成员名拼错编译照过、运行时才静默失败。

工作项：

- [x] 扩展 `scripts/extract_editor_api.py --emit-stub`，按 `main.ts` 实际引用的 29 个类型
      生成精简 stub（1039 行），随插件一起版本控制；
- [x] 成员名、静态性、参数个数（含重载与可选参数 `?`）、继承关系均与真实声明一致；
      参数/返回类型除基本类型外擦成 `any` 以避免拖入标准库依赖树；
- [x] 接线到 `plugin/tsconfig.json`（`types/editor.d.ts` 已是唯一声明源），现有 `main.ts`
      对着真实 API **0 error**；已实测能抓出三类此前完全放过的错误：
      成员名拼错（`Did you mean 'SetProperty'?`）、参数个数错误、静态/实例误用。
- [x] 收敛过程中发现的 16 处报错**全部确认是生成器缺陷而非 main.ts 问题**
      （重载折叠、枚举体在下一行、可选参数标记丢失），已修生成器而非放宽 main.ts。

### P8-2 资源引用图与替换语义（解决 §1.1）

Bridge 目前完全没有引用图 API，而编辑器有完整的：

```csharp
DependencyQuery.QueryDependencies / QueryReferences / ReplaceReferences
ReferenceInfo { ownerPkg, pkgId, itemId, content, propKey, arrayIndex, valueType }
```

`propKey` / `arrayIndex` 精确到"哪个对象的哪个属性槽"，正是 §1.1 缺的部分。

- [x] 新增 `query_references`、`query_dependencies`（只读，0.8.10）：走编辑器原生
      `DependencyQuery`，用 `(project, url, seekLevel)` 重载避开从 JS 构造 C# 泛型 List；
      `seek_level` 接受 `selection`/`samePackageButNotExported`/`samePackage`（默认）/`all`，
      分隔符写法不敏感，响应回报实际生效的 seekLevel 与代码值；
- [x] 只读语义在插件、CLI、MCP 三层同时成立（无 `save`/`external_reload` 参数、
      不进 publish 封锁表），回归用例钉住；`max_items` 默认 200/上限 2000，
      截断显式回报 `truncated` + 真实 `totalCount`，取不到的名字与资源一律 `null`，
      单个资源描述失败只退化为最小身份信息，不拖垮整条查询；
- [x] 项目级查询默认先打开未打开的包（否则会得到一个看起来完整、实际少算的结果），
      代价记录在 `packages` 字段，`skip_package_open` 为显式且可见的跳过开关；
- [x] **真机 6.1.4 复验**（证据 `tests/reports/p8-2-live.json`）：实测推翻了第一版的输出假设——
      `ReferenceInfo` 的 `ownerPkg`/`pkgId`/`itemId` 指的是**被引用的资源**而非引用方，
      真正回答「谁引用了它」的是 `content`（`FairyGUI.Utils.XML` 元素节点）的
      `attributes.id/name`。输出结构已据此改为 `referencedItem` / `slot` / `owner` / `attributes`；
      顺带修掉 `XML.attributes`（C# 字典，只能 `GetEnumerator`）、`ToXMLString()` 不可用，
      以及「未找到指定 FairyGUI 资源」被归成 `editor_rejected` 的分类缺陷；
- [ ] **仍未复验**：多包工程中未打开的包是否会被少算（本隔离工程只有一个已打开的包，
      `packages.opened` 恒为 0，真机触发不了该分支）；
- [x] 新增 `replace_references`（全工程替换语义，先出预览再执行）；预览直接复用
      `query_references` 的结果（0.8.11，`mode` 缺省 `preview`，`--execute` 才写）；
- [x] 与既有 `replace_object_resource`（单对象覆盖）并存，参数语义明确区分：前者改
      「某一个对象的某一个属性槽」，走文档模型、可 Agent 撤销、有 save/verify/
      external_reload 梯子；后者改「全工程引用图」，走原生批处理、**立即落盘、
      不可撤销**（响应 `undoable:false` / `strength:disk` / `writePath:native-batch`）；
- [x] **真机 6.1.4 复验**（证据 `tests/reports/p8-2-write-live.json`）：三条边界改变了
      实现与回报口径——① `ReplaceReferences` 只有 new 参数，old 来自同一实例上已查出的
      那批引用，跨请求活不过实例，故**执行时重新查询**而非复用预览列表；② 它
      **立即改包 XML**，文档既不 `isModified`、`HasUnsavedDocuments` 也为 false，文档全关
      时照样能改，打开着的文档内存同步更新、后续保存不会覆盖回去，所以 `save` 对它
      没有意义，验证只能是**引用图口径**（`verification.scope: reference-graph`），
      不得宣称属性级一致；③ 原生批量替换更新 `src`/`url` 但**不更新 image 的
      `fileName`**，落盘即半状态，由 `staleFileNameSlots` / `warnings` 显式上报
      （对照单对象路径 `ReplaceSelection` 两者都更新，且它对同 URL 也会重写该节点，
      故下一次经文档模型保存时自动补齐）；
- [x] 顺带修 0.8.10 遗留：`owner.itemId/itemName` 原先只在被引用资源所在包里按对象 id
      后缀查，跨包引用必然查不到、会把「解析失败」伪装成「宿主为 null」；现在同包快
      路径失败后遍历全工程包兜底，仍查不到即 `null`（真机确实存在 id 后缀与所属 item
      id 不一致的组件，不猜）；
- [ ] 仍未复验：多包工程中的跨包替换，以及「未打开的包是否会被少算」（隔离工程只有
      一个已打开的包，真机触发不了该分支，需多包夹具）。

### P8-3 关键帧与动画（解决 Phase 5 未完成项）

```csharp
Document.SetKeyFrameProperty / SetKeyFrameValue / SetKeyFramePathPos / SetKeyFrameControlPointSmooth
Document.CreateKeyFrame / AddKeyFrames / AddKeyFrame / RemoveKeyFrame(s) / DuplicateTransition
FTransitions.TakeSnapshot / ReadSnapshot / ClearSnapshot   // 编辑器自用的关键帧跟随机制
AniData { fps, speed, repeatDelay, swing, frameList, spriteList }
```

- [ ] 新增 `add_keyframes`、`set_keyframe`、`duplicate_transition`；
- [ ] `verify_transition`：检查 target 存在性、关键帧是否超出对象范围（Phase 5 长期未完成项）；
- [ ] MovieClip 补齐帧尺寸、透明边界、FPS、循环参数报告；
- [ ] 评估用 `FTransitions.TakeSnapshot` 替代 Bridge 自造的 before 快照。

### P8-4 预览与截图 —— 离屏截图路线已证伪（2026-10-19）

原计划基于「编辑器已有离屏渲染与预览运行时，不需要截整个应用窗口」：

```csharp
FairyGUI.CaptureCamera.Capture(target: DisplayObject, texture: RenderTexture, contentHeight, offset)
FairyGUI.CaptureCamera.CreateRenderTexture(width, height, stencilSupport)
TestView { Start, Stop, Reload, PlayTransition, ShowTooltips }
PreviewView { Show }
```

> `UnityEngine.ScreenCapture` **未**在声明中暴露，`CaptureCamera` 才是正确入口。

**该判断经 FairyGUI Editor 6.1.4 真机验证不成立，P8-4 已放弃。** 完整证据见
`tests/reports/p8-4-render-feasibility.json`（11 条发现，含未验证项与边界）。

- `render_component`：**放弃**。编辑器不把工程组件交给 FairyGUI 运行时 stage 渲染——
  `FObject.displayObject` 的 `stage`/`bounds` 均为 null、`layer=0`（捕获相机在 layer 30），
  且它继承 `Container` 而非 `GObject`，挂进 `GRoot` 直接 NRE。
- **最危险的一点是假成功**：`Capture` 不报错、PNG 正常写出，但 57600 像素全透明，
  且五种策略（baseline / 设 layer / 抓 content / 新建 GRoot / forceUpdate）结果字节数完全一致。
  照声明直接实现会交付一个「看起来成功」的截图功能。
- 编辑器自己的 `TestView` 预览也拿不到 stage（115 帧恒为 null），强行挂 `GRoot.inst` 亦然。
- `preview_run`（驱动 `TestView` 做交互预览）**不受影响，仍可实现**——它不依赖离屏渲染。
- before/after 视觉对比：随 `render_component` 一并放弃。

**仍然可用、后续可复用的实测结论：**

- `UnityEngine.ImageConversion.EncodeToPNG` 运行时**存在**但 `editor.d.ts` 声明里**没有**；
  `File.WriteAllBytes` 落盘链路完整。以后要做任何图像产出，直接用它，不必再找替代。
- C# `long` 在 Puerts 返回 **BigInt**，不 `Number()` 会让整条响应崩在 `JSON.stringify`。
- C# 数组在 JS 侧**不可下标**（`raw[0] === undefined`，长度可读）：插件内做不了像素统计，
  像素判读必须在编辑器之外做。注意这会让统计值变成 NaN 并序列化成 `null`，
  极易被误读成「渲染出空图」。
- 插件支持跨帧异步 Action（`processRequestFile` 会 await Promise，Puerts 里 `setTimeout` 可用）。

### P8-5 发布与图集配置

```csharp
PublishSettings { genCode, codePath, branchPath, atlasList, excludedList, useGlobalAtlasSettings }
PackSettings   { pot, mof, padding, rotation, minWidth, minHeight, maxWidth, maxHeight, square, multiPage }
AtlasSettings  { name, compression, extractAlpha, packSettings }
PublishHandler { ExportBinaryDesc, ExportDescZip, ExportResZip, ExportResFiles, ClearOldResFiles, CollectClasses }
```

- [x] `analyze_atlas_fit`：**按真实 `PackSettings` 约束**判断大图能否入图集，
      替换当前硬编码的 `LARGE_IMAGE_LONG_SIDE_MIN` 猜测（Phase 5 未完成项）。
      **0.8.12 只读切片已落地并真机复验**（证据 `tests/reports/p8-5-atlas-fit-live.json`）：
      判定吃包级 `PackSettings`（`padding` 每边 2 份、`minWidth/minHeight` 下限放大、
      `maxWidth/maxHeight`、`square`、`rotation`）与全局 `AtlasSetting`
      （`maxSize`/`forceSquare`/`allowRotation`），逐图给 `fit` 与卡住它的 `binding`；
      约束缺失时报 `unknown` 拒绝下结论。纯只读。
      **真机三条发现（改变了这项的定位）：**
      ①**旧规则在 `import_image` 时就生效，不只在 publish**——只调
      `import_image --save`、未调 publish，`package.xml` 已写入 `atlas="alone"`
      （调用点 `main.ts:630`/`655`）。它改的是真实工程，不只是下次发布。
      ②**`FPackageItem.folderAtlas` 在 6.1.4 上不与 `package.xml` 往返**——属性写入
      磁盘且保存保留，重启后内存读回为空；编辑器自身幂等守卫因此恒不命中，每次
      publish 重复 `SetChanged`。故输出分列 `folderAtlasInMemory`/`folderAtlasOnDisk`，
      归属一律以磁盘为准。
      ③最可执行的指标不是 `disagreements` 而是 `summary.assignedAloneButFits`
      （磁盘已标 alone 但按真实约束装得下）。真机实测 1920x1080 即属此列。
- [x] `set_publish_settings`（按包设置图集、代码生成、分支排除）。**0.8.13 已实现**，
      接完整验证梯子（editor 回读 → save → `package.xml` 的 `<publish>` 节点 → 可选
      `externalReload`），写路径显式声明 `object-model`（包级设置无 `DocElement` 入口，
      `FPackage.publishSettings` 还是只读 getter，只能改字段、换不了对象），
      发布期间封锁。未知字段与 `sizeOption`（读侧投影，非可写字段）在**改动包之前**
      `invalid_argument` 拒绝。`atlasList` 是全量替换语义。
      模拟宿主 170 项、Python 38 项、tsc 0 error，**已在 FairyGUI Editor 6.1.4 真机复验**
      （证据 `tests/reports/p8-5-write-live.json`）。真机推翻三处假设：①`AtlasSettings.packSettings`
      声明为 public 字段但运行时**只读**，只能就地改字段；②`atlasList` 置空保存会抛
      `Index was out of range` 并使该包此后**每次保存都崩**，故空列表在 validate 阶段拒绝；
      ③`<publish>` 只编码部分字段（`maxWidth` 与 `maxHeight` 共用 `maxAtlasSize`、
      `rotation` 有编码、`padding` **无编码**），故新增 `persistenceProfile` 提前披露落盘前景。
      **下面那条真机边界已闭合**：`useGlobalAtlasSettings=false` 的真机实例建成，包级
      `PackSettings` 真正参与判定，padding 与 square 两条分支真机触发。
      **纠正不了既有的错误 `folderAtlas=alone`**：本条当时写的是「应当能纠正」，
      2026-10-19 的活体探针已证伪该设想——包中已存在的 `atlas` 属性不可改，
      `folderAtlas=""` 清不掉。详见下面那条的实测记录。
- [x] 用真实 `PackSettings` 判定替换 `applyLargeImageAtlasRule` 的旧常量判定，并处理发现②的
      「内存不读回」。**0.8.14 已落地**：`import_image`（含同名替换）与 `publish` 前的归属
      施加改用 `decideAtlasAssignment`——与 `analyze_atlas_fit` 同一个判定函数，退役常量
      （`1920`/`1080`/`2048`）只留作 `retiredRuleWouldAssignAlone` 诊断对照。幂等守卫改读
      **磁盘 `package.xml`**，跨重启不再重复 `SetChanged`；判定时主动忽略 `alone` 标记本身，
      包级约束模式下被标过的图因此也判得出来。响应契约同步换血：`largeImageAtlasApplied` →
      `atlasAssignment`（含 `verdict` 五态）、`largeImageAtlasRule` → `atlasAssignment`
      （分 `assigned` / `aloneNotNeeded` / `unknown` 三类计数与明细）。模拟宿主 176 项、
      Python 41 项、tsc 0 error，**已在 FairyGUI Editor 6.1.4 真机复验**（证据
      `tests/reports/p8-5-judgement-live.json`）：1920x1080 不再落盘 alone（同包同尺寸的旧
      夹具仍带 `atlas="alone"`，构成 A/B 对照）、4096x4096 正常标记、**完整重启编辑器后**
      同名替换返回 `already-alone` 不再重复施加（0.8.13 缺陷闭合）、发布三类回报真实触发。
      真机另查出一处模拟宿主查不到的谎报：曾把 `wouldAssignAlone` 定义成「本次是否写入」，
      导致已正确标记的 4096 图误报 `disagrees=true`，已拆出独立的 `shouldBeAlone` 修正。
      **未做**：磁盘上已存在的多余 `folderAtlas=alone` **只上报不自动清除**——
      原因已由 2026-10-19 的活体探针查清，不是「尚未验证」，见下一条。
- [ ] 纠正磁盘上已存在的错误 `folderAtlas=alone`（输入已就位：`analyze_atlas_fit` 与
      `publish` 的 `aloneNotNeeded` 列表）。**前置已闭合且结论为否**（证据
      `tests/reports/p8-5-atlas-marker-clear-probe.json`，2026-10-19 真机探针）：
      `folderAtlas=""` **清不掉**已存在的 `alone` 标记。四组实测——
      ①对照组不碰 `folderAtlas` 只 `Save()`，`package.xml` 确实被重写（mtime 确认）
      而内容逐字不变，标记幸存；②置空 + `SetChanged` + 保存后标记纹丝不动，反而给 4 张
      本无属性的图写进了 `atlas=""`；③赋非空值 `ProbeAtlas` 后 **getter 立刻返回该值**、
      磁盘仍是 `alone`，紧接着再保存一次磁盘依旧 `alone`；④冷启动后全部 6 张图的
      getter 都是空串。**坐实的经验规则**：包中已存在的图片资源一旦带了 `atlas` 属性，
      该属性就是不可改的，对 `FPackageItem.folderAtlas` 赋任何值都不影响落盘；它只在该
      资源**新建时**被写入一次。**所以原计划的实现路径（置空清除）是死胡同**，须换路线：
      带外改 `package.xml`（由 ①② 可知编辑器保存时原样保留该属性、不会改写回来，故带外
      修改能真正留存）或删除后重新导入（会换 item id、须重建引用）。在真正动手前维持
      「只上报不自动改」。另记一个副作用：对无属性的干净资源调 `SetChanged` 会往磁盘塞
      `atlas=""` 噪声属性。
- [ ] 暴露 `PublishHandler` 的分步导出能力，便于"只导描述/只导资源"。

### P8-6 分支（完全空白的能力域）

```csharp
FProject { activeBranch, allBranches, CreateBranch, RenameBranch, RemoveBranch, ScanBranches }
FPackage { GetBranchRootItem, CreateBranch, GetBranchPath }
FPackageItem { branch, isBranchRoot, GetBranch, GetTrunk, GetHighResolution, GetStdResolution }
```

- [ ] 新增 `list_branches`、`create_branch`、`switch_branch`；
- [ ] 让 `list_items` / `get_tree` / 写操作能按分支限定范围。

### P8-7 其他可直接复用域（单点成本低，收益立竿见影）

| 领域 | 编辑器原生入口 | 建议 Action |
| --- | --- | --- |
| 资源审计 | `FindUnusedResource`、`FindDuplicateResource`、`FullSearch`、`ReferenceView`、`AssetSizeUtil` | `find_unused`、`find_duplicate`、`full_text_search` |
| i18n | `ImportStringsHandler.Parse/Import`、`ExportStringsHandler.Parse/Export`、`I18nSettings` | `import_strings`、`export_strings`、`list_langs` |
| 原生撤销栈 | `ActionHistory`、`ObjectSnapshot.Take/Load` | 评估用编辑器原生栈替代 `agentUndoStack`，`ObjectSnapshot` 可复用为 `verify_document` 快照格式 |
| 组件原语 | `Document.CreateGroup/DestroyGroup`、`CopySelection/Paste`、`AdjustDepth` | `create_group`、`duplicate_object`、`adjust_depth` |
| 可见性 | `ConsoleView.Log/LogError/LogWarning` | 把 Agent 操作与错误回显到**用户可见的编辑器控制台** |
| 自定义属性 | `ComExtention`、`ComProperty`、`CustomProps`、`FProject.RegisterComExtension` | 自定义组件属性读写 |
| 事件驱动 | `App.On/Off/Dispatch`、`App.add_onProjectOpened/onValidate` | 评估替代部分轮询 |

> Phase 0 记录的夹具缺口（"Bridge 无创建 List/Group/Controller/Loader 节点的 Action"）
> 由 P8-7 的 `Document.CreateGroup` 与 `FComponent.CreateChild` 直接解决。

### P8-0 ~ P8-7 的执行顺序

| 批次 | 内容 | 理由 |
| --- | --- | --- |
| 1 | P8-0 + P8-1 | 先把写入路径纠正到文档模型层并获得编译期保护，否则新 Action 会复制现有坑 |
| 2 | P8-2 | 直接清偿 §1.1 的技术债，是计划里最明确的一条 |
| 3 | ~~P8-4~~ + P8-5 | **2026-10-19：P8-4 放弃**（见下节），本批只剩 P8-5 解锁 Phase 5 的硬骨头；`preview_run` 并入后续批次。**0.8.12：P8-5 只读切片完成**（`analyze_atlas_fit`），写侧 `set_publish_settings` 与 `PublishHandler` 分步导出仍在本批 |
| 4 | P8-3 + P8-6 | 动画深入与新能力域 |
| 5 | P8-7 批量 | 审计 / i18n / 原生撤销栈 / 可见性 |

---

## 5. 工程实现规范

### 5.1 修改范围

Bridge 改进应在独立仓库完成：

```text
/Users/wilson/fgui-agent-bridge/plugin/main.ts
/Users/wilson/fgui-agent-bridge/plugin/main.js
/Users/wilson/fgui-agent-bridge/src/fairygui_agent/
/Users/wilson/fgui-agent-bridge/README.md
/Users/wilson/fgui-agent-bridge/references/current-capabilities.md
```

业务工程中的：

```text
/Users/wilson/youdoo_boxing_jab/.agents/skills/fgui-agent-bridge/
/Users/wilson/youdoo_boxing_jab/FairyGUI/plugins/agent-bridge/
```

只作为同步后的安装快照，不应直接在业务工程里单独修插件逻辑。

### 5.2 版本同步

修改插件或协议后必须同步：

- `plugin/package.json`；
- `pyproject.toml`；
- `src/fairygui_agent/__init__.py`；
- `plugin/main.ts`；
- `plugin/main.js`；
- README；
- capability 文档；
- Skill 文档；
- 同步脚本。

### 5.3 不允许的实现方式

- 不通过字符串替换 XML 绕过编辑器对象模型；
- 不将 `icon` 返回成功当作资源引用已经替换；
- 不把 `.agent` 队列日志当作业务资源变更；
- 不直接修改 Unity 导出 `.bytes` 代替 FairyGUI 源工程修改；
- 不把静态截图当作 Play Mode 或真机验证；
- 不批量覆盖同名素材而不比较尺寸、哈希和目标用途。

---

## 6. 测试计划

### 6.1 单元测试

- locator 解析；
- 资源 URL 校验；
- Button 状态映射；
- 文本样式 JSON schema；
- List/Group/Relation 参数校验；
- Transition 参数序列化；
- manifest 匹配和哈希比较。

### 6.2 插件集成测试

- Image/Loader/文本/Button/List/Group/Controller/Transition 全部写入；
- 保存后重新打开；
- 修改后撤销/重做；
- 发布后包资源完整；
- 大图 `alone` 规则不破坏已有 atlas。

### 6.3 端到端测试

- Lanhu 切图下载；
- manifest 生成；
- 同名资源比对；
- Bridge 替换；
- 组件布局修改；
- 发布 Common、BoxingInfo、Font；
- Unity refresh；
- Console 读取；
- 静态 UI 截图。

### 6.4 回归工程

应保留一个最小回归项目和一个业务工程验证样本：

- 最小回归项目用于快速测试 Action；
- `youdoo_boxing_jab` 用于真实 FairyGUI 和 Unity 联调；
- 不要直接使用用户当前未提交的业务改动作为唯一测试依据。

---

## 7. 优先级排序

> 下述 P0/P1/P2 为 2026-09-20 规划时按"本次 UI 拼装"的 Computer Use 频次排定。
> 截至 0.8.8，第 1~5 项 P0 与 P1 的 List/Group/Relation 已完成（见上表）。
> **当前实际待办以 §7.1 为准**，它基于 2026-10-19 的编辑器逆向分析，按"能否清偿既有技术债"重排。

### P0：必须优先完成

1. 写入后持久化回读；
2. `replace_object_resource`；
3. `set_text_style`；
4. 统一错误和返回结构；
5. 隔离工程回归测试。

这些能力可以直接减少本次 UI 拼装中最频繁的 Computer Use。

### P1：第二阶段完成

1. List/Group/Relation API；
2. Controller page 和 Button 状态资源 API；
3. Transition 自动同步和验证；
4. Lanhu manifest 和资源映射报告。

### P2：增强体验

1. FairyGUI 组件预览截图；
2. before/after 视觉对比；
3. 一键发布后 Unity refresh；
4. 多设计稿批量导入和差异报告；
5. 资源使用关系图和未引用资源扫描。

### 7.1 当前实际待办（2026-10-19 重排）

| 序 | 事项 | 对应 | 为什么排这个位置 |
| --- | --- | --- | --- |
| 1 | ~~写入路径归位到 `Document`/`DocElement`~~ **0.8.9 已完成** | P8-0 | 正确性前提。不先修，后面每个新 Action 都会复制 Phase 4 踩过的静默 save 失败 |
| 2 | ~~用真实声明生成类型 stub，接入编译期校验~~ **0.8.9 已完成** | P8-1 | 成本极低，且是 1 和后续所有项的安全网 |
| 3 | ~~引用图（只读 + 全工程替换语义）~~ **0.8.10 + 0.8.11 已完成** | P8-2 | 直接清偿 §1.1 这条挂了两轮的技术债；写侧 `replace_references` 默认只预览、立即落盘不可撤销、`fileName` 半状态显式上报 |
| 4 | ~~离屏渲染截图~~ **2026-10-19 已放弃**（`CaptureCamera` 对工程组件只出全透明空图，根因是编辑器不把组件交给 FairyGUI 运行时 stage 渲染）。`preview_run` 从本项剥离，仍待实现 | P8-4 | 解锁 Phase 7 的前提不成立，继续投入没有回报；证据见 `tests/reports/p8-4-render-feasibility.json` |
| 5 | 图集与发布配置（按真实 `PackSettings` 给建议）**0.8.12 只读切片 + 0.8.13 写侧均已真机复验，0.8.14 判定侧已落地** | P8-5 | 解锁 Phase 5；替换当前硬编码的尺寸猜测。**剩余**：`folderAtlas` 清空语义已真机证伪（置空清除走不通，需换带外改 XML 或删除重导入）+ `PublishHandler` 分步导出 |
| 6 | 关键帧 API 与 `verify_transition` | P8-3 | Phase 5 核心缺口，编辑器原生入口齐备 |
| 7 | 分支能力 | P8-6 | 新增域，多端/多版本项目价值高 |
| 8 | 资源审计 / i18n / 原生撤销栈 / 控制台可见性 | P8-7 | 单点成本低，收益立竿见影 |
| 9 | Lanhu manifest 与映射报告 | Phase 6 | 依赖前 8 项提供可靠写能力后再做，否则返工 |

**Phase 6 顺延到第 9 位**是本轮重排的主要变化：Lanhu 工作流的价值取决于 Bridge 写能力
与验证能力的可靠性，在 P8-0 落地前先做映射工作流，等于把不稳定的能力放大到批量场景。

---

## 8. 推荐的首个实现切片

建议不要一次性重写 Bridge，而是先做一个可独立验收的切片：

### 切片 A：可靠资源替换 + 文本样式

**状态：部分完成，不能整体验收。** 四个 Action 的入口已落地；自动持久化验证、完整 Button 状态和批量回滚仍缺失，业务工程与 Unity 验收未确认。

新增：

```text
replace_object_resource
set_text_style
get_text_style
verify_document
```

同时完成：

- [x] 插件 TypeScript 实现（基础入口，完整语义见上述缺口）；
- [x] 编译生成 `plugin/main.js`（仓库已有对应实现，本次未重新编译）；
- [x] Python Bridge client capability；
- [x] MCP 工具；
- [x] CLI 子命令；
- [ ] README、Skill、capability 文档（README/capability 已列出 API；Skill 主文档仍需补齐新接口工作流与实际验证限制）；
- [ ] 隔离工程测试（已有部分 sample 回归报告，完整矩阵未完成）；
- [ ] 业务工程同步（本次未核验安装快照，不标完成）；
- [ ] 用 `ComMenuBtn`、`ComScore`、`Slider2` 做回归样本（现有报告主要使用 `BridgeTextTest`，未见三者完整验收记录）。

### 切片 A 的完成标准

- 不使用 Computer Use 就能替换暂停按钮两个状态图；
- 不使用 Computer Use 就能修改暂停标题、得分、计时文字样式；
- 保存后重新打开文档，资源 URL、字号、颜色、字体仍正确；
- 发布 Common、BoxingInfo 后 Unity refresh 无新增错误；
- 失败时返回明确错误，不允许静默成功。

---

## 9. 最终预期

改进完成后，Lanhu 到 FairyGUI 的典型任务应可以用如下方式完成：

```text
Lanhu MCP 读取设计和切图
  → 生成资源 manifest
  → Bridge 比较尺寸与哈希
  → replace_object_resource 替换引用
  → set_text_style 设置字体与排版
  → set_list_layout / set_group_layout 调整布局
  → upsert_transition 更新动画
  → verify_document 回读验证
  → publish 发布目标包
  → Unity refresh + console 检查
  → 输出静态截图和验证边界
```

核心目标不是完全消除人工界面操作，而是让人工操作从“完成基础 UI 编辑”降级为“最终视觉确认和异常处理”。
