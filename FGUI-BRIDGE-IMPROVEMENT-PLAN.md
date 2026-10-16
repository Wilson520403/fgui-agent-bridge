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
| Phase 4 | 未完成 | 未找到计划中的 List/Group/Relation/Controller/gearDisplay 专用 Action。 |
| Phase 5 | 部分完成 | Transition 类型校验、修改前快照、类型化轨道 API 已实现；自动同步关键帧、专用验证及截图未完成。 |
| Phase 6 | 未完成 | 未找到标准 Lanhu manifest 生成、匹配和映射报告工作流。 |
| Phase 7 | 未完成 | 未找到组件截图、视觉差分或发布后 Unity 自动联调实现。 |

### 核查证据与验收边界

- 本次执行 `uv run python -m unittest discover -s tests -q`：**29 项通过**（含 2026-10-15 新增的 5 项 Phase 0 夹具离线校验；模拟宿主内部另有 36 项回归）；这是 Python/协议与静态接口测试，不是真实 Editor 全流程验收。
- 既有 Editor 记录：`tests/reports/sample-p0-validation.json`、`sample-p0-retest.json`、`sample-p0-color-errors-retest.json`。较新的报告修复了早期颜色和错误码失败，但仍列出 Button 状态、自动 XML 回读、自动重载、批量原子性、lineGap 响应等缺口。
- **2026-10-15 已真机验证 external reload（本次唯一一次重新操作 Editor 的部分）：** 在 FairyGUI Editor 6.1.4 上对 `BridgeFixture.txtLabel` 执行「写入 + 保存 + 关闭重开 + 重新定位比对」，`strength` 为 `reload`，`verification.reload.performed` 为 true，重载后 `fontSize/color/lineGap` 与 `expected` 一致；关闭方式由运行时探测实测为 `CloseDocuments`，非假设。完整用例与环境记录见 `tests/reports/external-reload-live.json`。**仍未做：** 发布资源、刷新 Unity、Play Mode 或真机测试。
- **本轮已处理：** `writeVerification` 检查保存状态、读取组件 XML 与 expected 比对；`verifyDocument` 支持 expected 校验；external reload 与 `strength` 验证强度分级。**0.8.7 已补齐** `verify_document` 对象树比对：`expected` 支持递归 `children` spec（`childrenMode`：`exact` 默认按位置全等 / `subset` 按 id/name/index 定位），三阶段验证沿用同一梯子（editor 内存树 → 磁盘 XML 限活动文档序列化范围 → external reload 整树重走），模拟宿主 87 项全过；**已于 2026-10-16 在 FairyGUI Editor 6.1.4 真机复验**：BridgeFixture 根组件 exact 全树 10 节点通过（XML 覆盖 9、嵌套组件内部跳过 1）、subset 容忍多余节点、属性不符报 `editor_rejected`（details.node 定位到 `expected.children[i]`）、未定位子节点报 `target_not_found`、磁盘 XML 人为改坏报 `persistence_failed`(stage xml)、非根 target 子树的嵌套节点记入 `xmlSkipped`、`external_reload` 经 `CloseDocuments` 关闭重开后整树重走得 `strength:reload`。
- **2026-10-15 已补齐 Phase 0 夹具：** `tests/fixtures/phase0/initial-*.{json,xml}` 已由 FairyGUI Editor 6.1.4 回读并重新序列化生成（不再是空数组与占位注释），覆盖 Image/Loader/Button/Text/List/Group/Controller/Transition 八类对象；`scripts/phase0_fixture.py` 提供 `capture` / `verify [--live]` 两种模式并输出统一 JSON 报告。离线 12 项、实况 21 项校验全通过。**仍缺：** Bridge 无创建 List/Group/Controller/Loader 节点的 Action（`insert_object` 只能插入已有包资源），这 4 类节点只能由工程文件承载，并已验证编辑器可加载与重写它们。
- **2026-10-15 修复「XML 缺省属性导致假失败」：** FairyGUI 序列化时会省略仍为默认值的属性，而 `persistedObjectValues` 把缺失属性读成 `null`，导致断言任何默认值属性（典型如默认色 `#FFFFFF`、默认对齐 `left`）时抛出**虚假的** `persistence_failed`——表现像严重的持久化故障，足以诱发对正确改动的错误回滚。修复把缺失属性解析为 FairyGUI 默认值，使「期望默认值」通过、「期望非默认值而 XML 缺失」仍然失败关闭。原有测试 `Read-only verify compares expected Editor and disk` 此前是因为夹具把默认属性也写进 XML 才通过，属于因错因通过，已随夹具改为真实序列化行为而转为因对因通过。**已于 2026-10-16 在 FairyGUI Editor 6.1.4 真机复验**：`verify_document` 断言 XML 缺失的默认属性 `align:"left"` 通过（`persisted:true`、`strength:disk`）；断言 `align:"center"` 在「内存已改、磁盘未存」时仍以 `persistence_failed`（stage `xml`）失败关闭；`set_text_style fontSize:36 --save --external-reload` 经 `CloseDocuments` 关闭重开后回读一致（`strength:reload`），随后已还原 fontSize:32。同时修复夹具脚本一个跨会话假失败：`get_tree` 中 List item 实例等运行时节点的 id 由编辑器按会话分配（如 `n0_dftm`→`n0_jrnu`），`snapshot.tree.match` 现只严格比对持久化到组件 XML 的 id，运行时节点仅比对 name/type/结构。证据见 `tests/reports/phase0-live-recheck.json`。
- **2026-10-16 `set_property`/`insert_object`/`remove_object` 迁入统一写验证（0.8.5）：** 三个 Action 复用 `writeVerification`/`validateReloadOptions`，返回统一的 `{ok,target,before/after,documentModified,saved,persisted,strength,verification,note}` 并支持 `save`/`verify`/`externalReload`。`set_property` 保留 Agent 属性事务栈，新增类型归一化（数值/布尔/字符串在写入前校验）与 `font` 的 `ui://` 解析；验证层 `VERIFIED_KEYS` 扩展 `scaleX/scaleY/rotation/alpha/visible/touchable/grayed/text/icon` 通用属性（序列化名与默认值已按 6.1.4 实测钉住，如 `visible` 仅在 `false` 时序列化）。`remove_object` 改为缺失性验证：编辑器回读确认不可解析、保存后磁盘 XML 不含节点 id、external reload 重开后仍缺失才报 `persisted`；`insert_object` 验证新节点 `id/name/type/x/y`（含引用时 `resourceURL`）。模拟宿主 51 项全过；真机 6.1.4 已验证 `x`、`visible` 双向、`scaleX` 关闭重开、insert 磁盘回读与 remove 重载后仍缺失。Transition/MovieClip/创建导入类 Action 未在本轮接入。
- **2026-10-16 剩余写 Action 迁入统一写验证（0.8.6）：** `mutateTransitions` 拆分 mutation 与验证：验证失败（如保存失败）不再触发快照回滚，与对象级写一致；新增 `transitionWriteVerification`/`writePackageVerification` 两条等效梯子。Transition 验证 `<transition>` 名称与公开条目数（tween 合成端点按磁盘序列化折叠），`externalReload` 关闭重开文档后在新文档上重读 Transition 集合并回报 `closeStrategy`；包资源验证 `package.xml` 条目 + `checkFile` 资源文件，image/sound/font/movieclip 的 `externalReload` 为 `UnloadAsset` + `GetAsset` asset 重载，组件创建与删除按 `invalid_argument` 在任何变更前拒绝该参数。`mutateTransitions` 变更前统一走 `validateReloadOptions`，不允许 `externalReload` 缺 `save` 或配 `verify:false`。响应统一带 `saved`/`persisted`/`strength`/`verification`/`note`，`requiresSave` 改为按实际保存结果返回。MCP/CLI 同步暴露 `save`/`verify`/`external_reload`。模拟宿主扩到 71 项全过（含 Transition 三态、stale XML、reload 丢值、包清单回读与缺失性验证）。**真机 6.1.4 已复验**：`upsert_transition`/`add_transition_item` 磁盘回读正确（tween 折叠 itemCount）、`remove_transition` external reload 经 `CloseDocuments` 关闭重开后仍缺失、`create_movieclip --save --external-reload` 走 asset 重载得 `strength:reload`、`remove_movieclip` 保存后包清单缺失、`create_component` 清单回读 `strength:disk`。真机还抓到一个名称归一化时序问题：`item.name` 在 MovieClip 创建时不带扩展名而 `package.xml` `name` 为文件名，已改为按去扩展名归一化比对。
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

**状态：未完成。** 以下专用 Action 尚未实现；已有通用属性或按钮状态能力不等于本阶段完成。

### 目标

覆盖复杂 UI 布局，避免使用原生编辑器面板修改高级属性。

### 新增 Action

```text
set_list_layout
set_group_layout
set_relation
set_controller
set_gear_display
```

### List 支持

- layout：flow horizontal、flow vertical、single column、single row；
- lineGap、colGap；
- itemSize、autoItemSize；
- defaultItem；
- align、vAlign；
- overflow；
- numItems 和 item placeholders；
- foldInvisibleItems。

### Group 支持

- layout；
- rowGap、colGap；
- excludeInvisibles；
- advanced group；
- 自动计算尺寸。

### Relation 支持

参数应使用结构化表达，而不是逗号字符串：

```json
{
  "target": "n45_jfoi",
  "relations": [
    { "source": "right", "target": "right" },
    { "source": "top", "target": "top" }
  ]
}
```

### Controller 支持

- 创建、读取、设置 page；
- 修改 selected page；
- 修改节点的 gearDisplay；
- 批量替换每个 page 下的资源；
- 验证 page 数量与资源状态一致。

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
- [ ] 预览后导出指定帧截图；
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

- [ ] 增加组件静态预览截图 Action；
- [ ] 支持指定组件、指定 Controller page、指定 Transition frame；
- [ ] 支持导出透明背景和设计尺寸截图；
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
