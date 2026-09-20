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
| Phase 0 | 部分完成 | 有夹具目录、版本基线声明、sample 回归报告和单测命令；八类对象完整隔离夹具、初始快照及自动 JSON 报告未完成。 |
| Phase 1 | 部分完成 | locator、等待 Editor 响应、结构化错误、expected 比对和组件 XML 回读已实现；external reload、所有写 Action 统一语义仍未完成。 |
| Phase 2 | 部分完成 | Image/Loader 替换已加入资源类型检查、稳定 ID 回定位、保存后 XML 回读；Button 状态、Controller page、字体及完整资源校验尚不能验收。 |
| Phase 3 | 部分完成 | 文本读写 API、字段校验、颜色规范化、字号/颜色/行距 XML 回读已实现；完整样式 schema、批量原子回滚未完成。 |
| Phase 4 | 未完成 | 未找到计划中的 List/Group/Relation/Controller/gearDisplay 专用 Action。 |
| Phase 5 | 部分完成 | Transition 类型校验、修改前快照、类型化轨道 API 已实现；自动同步关键帧、专用验证及截图未完成。 |
| Phase 6 | 未完成 | 未找到标准 Lanhu manifest 生成、匹配和映射报告工作流。 |
| Phase 7 | 未完成 | 未找到组件截图、视觉差分或发布后 Unity 自动联调实现。 |

### 核查证据与验收边界

- 本次执行 `uv run python -m unittest discover -s tests -q`：**23 项通过**（含新增 4 项 Python/模拟宿主入口测试；模拟宿主内部另有 24 项回归）；这是 Python/协议与静态接口测试，不是真实 Editor 全流程验收。
- 既有 Editor 记录：`tests/reports/sample-p0-validation.json`、`sample-p0-retest.json`、`sample-p0-color-errors-retest.json`。较新的报告修复了早期颜色和错误码失败，但仍列出 Button 状态、自动 XML 回读、自动重载、批量原子性、lineGap 响应等缺口。
- 最后一次报告的重载证据来自用户报告及 `savedVersion` 重置，**没有自动关闭/重开测试**。本次未重新操作 Editor、发布资源、刷新 Unity 或执行 Play Mode/真机测试。
- **本轮已处理：** `writeVerification` 现在检查保存状态并可读取组件 XML 与 expected 比对；`verifyDocument` 支持 expected 校验。**仍未完成：** external reload、完整 XML 对象矩阵和所有写 Action 的统一语义，因此 P0/切片 A 仍只能标为部分完成。
- `tests/fixtures/phase0/initial-tree.json`、`initial-resources.json` 仍为空数组，`initial-xml.xml` 仍为占位注释，不能按完整夹具验收。
- capability 文档实际路径为 `.agents/skills/fgui-agent-bridge/references/current-capabilities.md`，而非仓库根目录 `references/`。

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

- [ ] 固定 FairyGUI Editor 版本和 Bridge 插件版本。（部分完成：manifest 声明 Editor 6.1.4，仓库 Bridge 为 0.8.3；夹具尚未锁定完整版本组合。）
- [ ] 创建隔离测试工程，包含：（部分完成：有 sample 实测报告和夹具定义，未见以下八类对象完整覆盖。）
  - 一个普通 Image；
  - 一个 Loader；
  - 一个 Button；
  - 一个 Text；
  - 一个 List；
  - 一个 Group；
  - 一个 Controller；
  - 一个 Transition。
- [ ] 为每个对象记录初始 XML、对象树和资源 URL。（快照文件仍为占位。）
- [ ] 补充 Action 的“请求成功但未持久化”回归测试。（部分完成：已有人工 Editor 回归报告，未形成自动持久化断言。）
- [x] 将测试夹具放在独立 Bridge 仓库，不污染业务工程。（目录 `tests/fixtures/phase0/` 已建立；内容完整性见上。）
- [ ] 建立统一的测试命令和 JSON 报告格式。（部分完成：有 unittest 命令和 JSON 报告，但没有统一报告生成器/schema。）

### 验收标准

- 可以在隔离工程中稳定复现 `icon` 修改不落盘问题；
- 可以区分内存修改、保存成功和重新加载成功；
- 测试失败时能输出对象 ID、路径、before、after 和 XML 片段。

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
- [ ] 所有写 Action 返回统一结构：（部分完成：新增 P0 写接口使用 `writeVerification`，旧接口未全面统一，持久化标记仍不可靠。）

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
  "verification": {
    "editorReadback": true,
    "xmlReadback": true
  }
}
```

- [ ] 增加 `verify_document` Action：（部分完成：插件/MCP/CLI 入口已存在，仅返回当前文档快照，以下比对尚未完整实现。）
  - 重新读取活动文档；
  - 对比对象树；
  - 对比关键属性；
  - 检查 XML 是否包含预期值。
- [ ] 保存后支持可选的 external reload 验证。（当前明确返回 `externalReload: false`。）
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
