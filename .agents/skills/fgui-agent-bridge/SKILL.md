---
name: fgui-agent-bridge
description: 当通过 MCP、CLI 或源码使用和维护独立 FGUI Agent Bridge 仓库时使用；包括连接 FairyGUI Editor、选择工程、读取/修改组件文档、保存/撤销、发布资源，以及新增或变更 Bridge Action、MCP 工具、CLI 参数、协议、安全边界、同步脚本和文档。
---

# FGUI Agent Bridge

## 目标与真源

本 Skill 面向独立 `fgui-agent-bridge` 仓库。该仓库是 Bridge、MCP、CLI 和 Skill 的唯一开发真源，业务工程中的插件与 Skill 仅是同步快照。

- FairyGUI 插件源码：`plugin/main.ts`
- FairyGUI 运行文件：`plugin/main.js`；修改源码后必须重新编译并一起提交
- 插件包与最小宿主类型：`plugin/package.json`、`plugin/types/`
- Python/MCP/CLI 真源：`src/fairygui_agent/`
- 版本必须同步：`plugin/package.json`、`pyproject.toml`、`src/fairygui_agent/__init__.py`、`plugin/main.ts`、`plugin/main.js`
- 工程文档真源：`README.md`
- 当前能力参考：[references/current-capabilities.md](references/current-capabilities.md)
- 业务工程同步入口：`scripts/sync_to_project.py`

若实现、README 和 Skill 不一致，先以代码和实际桥接响应核对，再在同一个改动中修正 README 与 Skill；不要凭旧摘要猜测 Action 或参数。

## 何时使用

- 使用 `fgui_*` MCP 工具或 `fgui-agent` CLI 操作 FairyGUI 组件。
- 查看包、资源、活动文档、对象树、对象 ID/路径、属性或撤销状态。
- 修改组件属性、插入/删除已有 `ui://` 资源、替换 Image/Loader 资源引用、读取或修改文本样式、验证文档结构与持久化、保存、放弃、撤销或重做。
- 发布当前包、指定包或全部包，或检查发布设置。
- 检查 Bridge/插件版本一致性，或从源仓库拉取最新代码并同步到目标工程。
- 修改插件、MCP、CLI、版本、协议、白名单、队列语义、同步脚本或 README。

## 使用工作流

### 0. 检查更新与同步（按需）

- 当用户要求“检查更新”、“拉取最新 Bridge 版本”，或 `fgui_status` 返回 `versionMatch: false` / 协议不兼容提示时：
  1. 运行 `uv run python scripts/sync_to_project.py --pull --project PATH --skill-root PATH --apply`（或 `uv run fgui-agent update --pull --apply`）；
  2. 若插件更新，提醒用户在 FairyGUI Editor 中重新打开工程生效。

### 1. 连接与定位

1. 使用 `fgui_status` 查看当前会话是否已选择工程、编辑器是否在线、插件版本是否匹配以及心跳年龄；它不会唤醒编辑器。
2. 工程未选择时调用 `fgui_use_project`，参数可为 `.fairy` 文件、FairyGUI 工程目录或包含 `FairyGUI/FairyGUI.fairy` 的仓库目录。
3. 需要唤醒或验证编辑器时调用 `fgui_ping`。不要把“请求已写入队列”当作 FairyGUI 已完成。
4. 不知道包名时先 `fgui_list_packages`；不知道资源时用 `fgui_list_items`。
5. 打开组件后先确认活动文档，再读取对象树。修改优先使用稳定对象 ID，其次对象路径；只有名称唯一时才使用名称。

### 2. 创建、修改和保存

- 新建组件使用 `fgui_create_component`，明确包、目录、名称、宽高、导出状态和冲突策略。
- 创建文本对象用 `fgui_insert_text`（0.8.20+）：FGUI 的文本是 displayList 里的裸节点、不是包资源，`fgui_insert_object` 插不进来。传 `text`/`x`/`y`/`name` 与 `style`（font、fontSize、color、align、vAlign、autoSize、letterSpacing、lineGap、width、height、bold、italic、underline、strokeSize、strokeColor、shadowX、shadowY、shadowColor）。**三个编辑器侧约束由 Bridge 自动兜住**：① 给 `width`/`height` 会先写 `autoSize=none`，否则编辑器在保存时按文字自然尺寸重算；② 没给 `font` 但给了 `fontSize` 时自动补编辑器默认字体 `UIDefault`（否则编辑器抛 NullReferenceException）；③ 给描边/投影参数会自动打开对应开关（编辑器只在开关打开时序列化这些属性）。文本的 `id` 由编辑器生成且只读，只能回读；同名时编辑器可能自行改名，响应里的 `inserted.nameAdjusted` 会显式回报。
- 图片、字体与声音导入使用绝对本地路径（`fgui_import_image` / `fgui_import_font` / `fgui_import_sound`）；`replace` 是磁盘覆盖，不能由文档放弃回滚。
- 分支（0.8.18+）：`fgui_list_branches` 列分支，`fgui_create_branch` 创建（`switch_to=true` 顺便切换），`fgui_switch_branch` 切换（空名称回主干）。创建与切换走工程原生 API，**立即落盘、不可撤销**，默认不保存打开文档，需要时传 `save_open_documents=true`。读写都用 `branch` 寻址，省略时跟随当前活跃分支（`get_tree` 读当前文档），`branch=""` 明确表示主干；显式传分支名可跨分支只读。包资源写入要求 `branch` 与活跃分支一致；分支资源落在 `assets_<branch>/<pkg>/`，清单是 `package_branch.xml`，写验证比对这份清单。6.1.4 上 `activeBranch` **不会重定向文档保存**：分支文档要求该分支活跃，主干文档在分支活跃时也拒绝保存，先切回主干。`fgui_replace_references` / `fgui_clear_atlas_markers` 是主干专用，分支活跃时拒绝。`activeBranch` 重启后回主干，但分支磁盘内容保留。
- 动画编辑先用 `fgui_list_transitions` / `fgui_get_transition` 读取，再用 `fgui_upsert_transition` 进行整段声明式更新，或用关键帧原子工具局部修改；时间单位是 frame。全部原生 Transition 轨道均使用类型化 JSON。
- Transition 只读校验（0.8.15+）：`fgui_verify_transition` 检查目标对象与轨道兼容性、关键帧值范围、嵌套 Transition / Sound 引用、Tween 端点配对，以及 XY 是否越出画布。**它不修改文档、不保存、不置脏**，默认校验全部 Transition，可用 `name` 限定单个、`check_bounds=False` 跳过范围检查。`errors` 是确定缺陷（目标被删、值越界、引用缺失），`warnings` 可能合法（`position_outside_canvas` 对滑入/滑出动画是设计意图，`empty_transition` 等）；`summary.valid` 只统计 error，`summary.clean` 才要求无 warning。校验器不会因损坏的 Tween 抛错，而是把它作为 finding 返回。
- Transition 关键帧写入（0.8.16+）：`fgui_add_keyframes` 一次创建多个关键帧（**帧号必须显式给出**，批次内与既有轨道先做冲突预检），`fgui_set_keyframe` 按 `item_index` 或 `target_id`+`track_type`+`frame` 定位并改 `frame`/`label`/`tween`/`ease`/`repeat`/`yoyo`/`value`/`endValue`，`fgui_duplicate_transition` 复制整条 Transition（`new_name?`）。三者都走时间轴与文档模型、进入 Agent 动画撤销栈，并在结束时恢复用户原来的播放头与时间轴模式。真机事实：`CreateKeyFrame` 按播放头采样目标当前状态；`AddKeyFrames(jsArray)` 与 `SetKeyFrameValue` 在 6.1.4 上不可用；`tween=true` 只能用于已处于 Tween 关系中的关键帧，普通关键帧之间建 Tween 请用 `upsert_transition`；插入已有 Tween 的关键帧会成为隐藏的合成端点，可用 `target_id`+`track_type`+`frame` 定位并在结果里看 `syntheticEndpoint`，可改 `label`/`value`，但**不能对端点再开 `tween=true` 续轨**（6.1.4 上端点 `nextItem` 为 null，报错并回滚），延长 Tween 用 `upsert_transition` 重建；`endValue` 写的是 Tween 端点；`DuplicateTransition` 会忽略新名称参数，由 `SetTransitionProperty` 补改名。能力校验最低版本为 0.8.16，与 0.8.1 条目级写操作、0.8.15 只读校验分开提示。**已在 6.1.4 真机验收**（证据 `tests/reports/p8-3-keyframes-live.json`）：新增/改帧/复制均经关闭重开与完整重启保持，负路径拒绝且回滚，写后 `verify_transition` valid/clean。
- MovieClip 用 `fgui_create_movieclip` 的有序绝对图片路径创建，或通过 `fgui_update_movieclip` 更新帧与播放参数；帧由 FairyGUI 嵌入 `.jta`，不会自动生成逐帧图片 `ui://` 资源。已有 MovieClip 更新/替换可 Agent undo/redo，全新创建和删除不可逆。
- 用 `fgui_preview_animation` 播放、暂停、停止、跳帧或查询 Transition/MovieClip 预览状态。预览不保存，不能把预览状态描述为资源默认属性。
- 按钮状态图顺序固定为 `up/down/over/selectedOver/disabled/selectedDisabled`，非空值必须是工程内图片 `ui://` URL。
- 资源替换：替换显示对象引用的资源使用 `fgui_replace_object_resource`（当前仅支持 Image 与 Loader，不支持 Button 状态资源切换），支持传入 `expected_type` 校验并在 `--save` 时验证 Editor/XML 持久化。
- 资源引用图（0.8.10+）：改资源引用**之前**先用只读的 `fgui_query_references`（谁引用了它）与 `fgui_query_dependencies`（它依赖了谁）确定影响面——返回分 `referencedItem`（被引用的资源）/`slot`（属性槽：`element.propKey`+`valueType`）/`owner`（宿主对象 `objectId`/`objectName`）/`attributes` 四段——注意编辑器原生 `ReferenceInfo` 的 `itemId` 指的是**被引用方**，「谁引用了它」要看 `owner` 段。两者不写文档、不标记 modified；返回 `totalCount` 与 `truncated`，取不到的名称为 `null`。`fgui_query_dependencies` 的 `seek_level` 默认 `samePackage`，需要跨包全量影响面时传 `all`。
- 资源审计（0.8.19+）：`fgui_find_unused` 按引用图列出工程内零引用资源，`fgui_find_duplicate` 按文件内容 MD5 + 字节数找出重复资源。两者都**只读**（`readOnly:true`，不保存、不置脏），可用 `packages` / `types` / `include_branches` 缩小范围；`find_unused` 的 `skip_exported=true` 排除导出资源。注意「未使用」是当前工程引用图口径，运行时按 URL 动态加载的导出资源也会显示为未使用，删除前必须确认；图片尺寸来自 `AssetSizeUtil.GetSize`，重复分组按 `wastedBytes` 降序。编辑器原生的查找未使用/重复资源是 Pro 功能，非 Pro 调用会弹授权框并挂起，Bridge 不使用这些入口。
- 全工程引用替换（0.8.11+）：`fgui_replace_references` 把某个资源在全工程的所有引用一次性换成另一个资源。**默认只预览**，确认 `totalCount` 与引用明细后再传 `execute=True`——它走编辑器原生批处理，**立即落盘、不进 Agent 撤销栈、没有 `save` 兜底**（响应 `undoable:false` / `strength:disk` / `writePath:native-batch`）。替换后按引用图回读验证（源资源残留必须为 0），原生路径不更新 image 的 `fileName`，响应以 `staleFileNameSlots` / `warnings` 显式报出该半状态，这些节点下次经编辑器保存时自动补齐。单对象覆盖仍用 `fgui_replace_object_resource`（走文档模型、可撤销、有 save/verify/external_reload 梯子），两者不要互相替代。
- 图集约束分析（0.8.12+）：`fgui_analyze_atlas_fit` **只读**地按图集打包器的真实约束判断每张图能否入图集，别再凭像素大小猜大图。判定吃包级 `PackSettings`（`padding` 每边 2 份、`minWidth/minHeight` 会把小图放大到下限、`maxWidth/maxHeight` 上限、`square` 方形区域、`rotation` 允许 90° 打包）和全局 `AtlasSetting`（`maxSize` / `forceSquare` / `allowRotation`）。看 `fit`：`fits` / `exceeds` / `unknown`；卡在哪看 `binding`（`maxWidth` / `maxHeight` / `squareSide`）。**`unknown` 不是失败也不是放行**，是「约束没告诉我们页有多大」——约束缺失时它拒绝下结论，别把它当 fits。**最该看的数是 `summary.assignedAloneButFits`**：磁盘上已标成 `alone`、但按真实约束其实装得下的图有几张。三个必知的坑：①旧的大图常量**不只在 publish 生效**，`import_image` 成功后就写 `folderAtlas=alone` 并落盘，它影响的是真实工程而不只是下次发布——**0.8.14 起导入与发布都已改判为真实约束**（见下条），这段只作为它当初成因的记录；②FairyGUI 6.1.4 的 `folderAtlas` **不与 `package.xml` 往返**——属性写进磁盘且保存保留，但重启后内存读回为空，所以每张图分列 `folderAtlasInMemory` / `folderAtlasOnDisk`，**归属一律以磁盘为准**，别拿内存值下结论；③它自身只读，不写 `folderAtlas`、不置脏。改归属用下面的 `fgui_set_publish_settings`。
- 图集归属写入判定（0.8.14+）：`import_image`（含同名替换）与 `publish` 前的 `alone` 施加与 `fgui_analyze_atlas_fit` **共用同一个判定函数**，所以「分析说装得下、导入却标 alone」这种事不会再发生。看 `atlasAssignment.verdict`：`assign-alone`（本次写盘）/ `already-alone`（幂等，未写）/ `alone-not-needed`（**磁盘已标但装得下，只报不改**）/ `leave-as-is`（无需动）/ `unknown`（**约束不足，拒绝下结论且不写盘**，别当放行）。归属判据一律取磁盘 `package.xml`，`alone` 标记本身在解析约束时被忽略——它是编辑器内建名、不在用户 `atlasList` 里，拿它解析只会得到「图集未配置」。
- 图集标记纠正（0.8.17+）：编辑器没有清除既有资源 `atlas="alone"` 的 API（`folderAtlas=""` 保存后原样保留，活体探针已证伪），所以 `fgui_clear_atlas_markers` **带外修改 `package.xml`**。默认只预览：返回 `candidates`（磁盘标 alone 且真实约束判定装得下）与 `held`（其余原因，含 `already-alone`/`not-marked-alone`/`different-atlas`/`branch-scope-unsupported`），不写盘。确认后传 `execute=True`：先 `pkg.Save()`，备份到 `.agent/backups/`，只删除目标 `<image>` 的 `atlas` 属性，回读全文，再 `Dispose()` + `EnsureOpen()` 重开包，最后读盘统计剩余 alone。**它不可撤销、不进 Agent 撤销栈**（`writePath:"out-of-band-xml"`、`undoable:false`），回退只能把 `backupPath` 覆盖回去；包内有打开文档时默认拒绝，显式 `close_open_documents=True` 才关闭已保存文档，**未保存文档永远拒绝**。`item_names` 忽略扩展名（`hd` 与 `hd.png` 等价），一个名称匹配多张图或显式目标不存在都会在执行前拒绝。跨完整重启的持久化不由该 Action 自身声明（`persistence.crossRestartVerified:false`）。
- 包级发布设置写入（0.8.13+）：`fgui_set_publish_settings` 按包写 `path`/`genCode`/`codePath`/`branchPath`/`useGlobalAtlasSettings`、`atlasList`（每条含 `name`/`compression`/`extractAlpha`/`packSettings`）与 `excludedList`。**只写显式提供的字段**，其余保持当前值；`atlasList` 是**全量替换**语义（传进来的数组就是落盘的最终列表，不做增量合并），省略该字段则完全不碰图集设置。`packSettings` 可写 `padding`/`minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`pot`/`mof`/`rotation`/`square`/`fast`/`edgePadding`/`duplicatePadding`/`multiPage`。
  **四个必须知道的点**：①它走**对象模型**（包级设置没有 DocElement 入口，`FPackage.publishSettings` 还是只读 getter），响应 `writePath` 恒为 `object-model`，**不进组件文档的撤销栈**，发布期间被封锁；②未知字段和 `sizeOption`（读侧投影，不是可写字段）一律在**改动包之前** `invalid_argument` 拒绝，不会留半写入；③`external_reload` 是 `Dispose`+`Open` 的**同进程重开包**，证明不了跨重启持久化——考虑到 `folderAtlas` 已实测「内存写盘但重启不读回」，别把它当成重启验证；④响应带 `persistenceProfile`，在写之前就告诉你哪些字段留得住（`persisted` / `losesValue` / `unverified`）——`package.xml` 的 `<publish>` **只编码部分字段**：`maxWidth` 与 `maxHeight` 共用 `maxAtlasSize`（写 2048/4096，重开后 maxHeight 回落成 2048）、`rotation` 有编码、**`padding` 根本没有编码**（写 20，重开后回默认 2）。磁盘层仍只回报原始结构与全部键值、不做等值断言。**别用 Bridge 写要跨重启保留的 `padding`/`square` 等字段**，去编辑器设置界面改。
  **三个只有真机才暴露的坑（6.1.4 已复验，模拟宿主全都测不出来）**：①`AtlasSettings.packSettings` 声明是 public 字段，**运行时却是只读属性**，赋值抛 `Cannot assign to read only property`——只能取现有实例就地改字段，换不了整个对象；②**`atlasList` 不能传空数组**：`FPackage.SavePublishSettings` 会抛 `Index was out of range`，且该包**此后每次保存都崩**，一次失败就把工程留在坏状态里，所以写入前就拒绝，清空图集设置只能用编辑器界面；③`new PackSettings()` 的真实默认是 `minWidth=16`/`minHeight=16`/`padding=2`/`pot=true`/`mof=true`/`multiPage=false`。
  用法上它是 `fgui_analyze_atlas_fit` 的写侧配套：把 `useGlobalAtlasSettings` 置 `false` 并配好 `atlasList`，包级 `PackSettings` 才真正生效。注意它改的是图集配置，不碰资源级 `atlas` 属性；纠正已经落盘的错误 `folderAtlas=alone` 用上面的 `fgui_clear_atlas_markers`。
- 文本样式：文本对象的样式读取与修改优先使用 `fgui_get_text_style` 和 `fgui_set_text_style`。白名单属性：`font`、`fontSize`、`color`、`align`、`vAlign`、`autoSize`、`lineGap`、`letterSpacing`、`width`、`height`、`x`、`y`，以及 0.8.20 新增的 `bold`/`italic`/`underline`（布尔）、`strokeSize`（描边宽度）、`strokeColor`、`shadowX`/`shadowY`（投影偏移）、`shadowColor`。**属性名按真机 6.1.4 实测，不要按 FGUI 惯例猜**：描边宽度是 `strokeSize`（不是 `stroke`），投影偏移落盘是 `shadowOffset="x,y"`（Bridge 侧拆成 shadowX/shadowY）。描边与投影都是「开关 + 参数」结构，只给参数不给开关不会落盘，Bridge 会自动开开关；`shadow=false` 与偏移同时给会被拒绝（关开关会把偏移清零）。`set_text_style` 支持 `save`/`verify`/`external_reload` 写验证梯子，证据见 `tests/reports/p9-1-text-style-live.json`。
- 属性修改（如 `text`、`icon`、`font` 等白名单属性）进入 Agent 属性事务栈；结构创建、插入和删除没有完整结构快照撤销。
- `set_property`、`insert_object`、`remove_object`、`replace_object_resource`、`set_text_style` 与全部 Transition 写操作统一走写验证：支持 `save` / `verify` / `external_reload`，返回 `persisted` + `strength`（`reload`/`disk`/`none`）；`external_reload` 需 `save=true`，为关闭重开文档后重新比对。`remove_object` 与 `remove_transition` 按缺失性验证（磁盘 XML 与重载后均不再解析到节点）。
- 包资源写操作（`create_component`、`create_button`、`import_image`/`import_font`/`import_sound`、`create_movieclip`/`update_movieclip`/`remove_movieclip`）支持 `save` / `verify`，验证 `package.xml` 条目；image/sound/font/movieclip 的 `external_reload` 为 asset 重载（`UnloadAsset` + `GetAsset`），组件创建与删除不支持 `external_reload`，`strength` 上限 `disk`。
- List/Group 布局、Relation、gearDisplay 与 Controller（0.8.8+）：`fgui_set_list_layout` / `fgui_set_group_layout` 接收扁平 `fields` 字段集（不支持字段报 `unsupported_property`，不留半写入）；`fgui_set_relation` 整体替换对象的 `<relation>` 绑定（`target` 缺省为父组件，`sidePair` 校验方向合法性）；`fgui_set_gear_display` 绑定 gear 0 的控制器与页面（`controller` 传 null/空字符串清除）；`fgui_list_controllers` 与 `fgui_set_controller` 读取或创建/修改/删除组件 Controller（`pages` 整体替换会重新分配页面 id）。五个写 Action 同样走 `save`/`verify`/`external_reload` 验证梯子；枚举型序列化属性缺省时计入 `verification.xmlSkippedKeys`。
- 文档与持久化验证：使用 `fgui_verify_document` 重新读取活动文档对象树并可传入 `target + expected` 比对组件 XML 磁盘持久化内容；`expected` 含 `children` 时执行递归对象树比对（`childrenMode` 默认 `exact` 按位置全等，`subset` 按 id/name/index 定位且允许多余节点；含 `children` 时 `target` 可省略，默认根组件）；无 `expected` 时仅作为对象树快照。XML 阶段仅覆盖活动文档序列化范围（根节点 + displayList 直接子节点），嵌套组件内部计入 `verification.xmlSkipped`。
- 保存使用 `fgui_save_document` 或 `fgui_save_all`；放弃全部未保存修改使用 `fgui_discard_document`。

### 3. 发布

1. 先调用 `fgui_get_publish_settings` 确认输出目录、格式、图集、代码生成和包级覆盖。
2. 明确发布范围：`active`、`packages` 或 `all`。
3. 再调用 `fgui_publish`，按需设置保存、描述文件、分支和超时。
4. 发布前会自动扫描目标包：按图集打包器的**真实约束**判断每张图能否入图集，装不下的才设置 FairyGUI `alone` 纹理集（0.8.14 起，不再用 `1920×1080`/`2048` 硬编码阈值）；发布响应的 `atlasAssignment` 分三类回报：`assigned`（本次写入 alone 的）、`aloneNotNeeded`（磁盘上已有 alone 但真实约束装得下，**只报不改**）、`unknown`（约束不足以判定，未写盘）。约束来自包级 `PackSettings`（`useGlobalAtlasSettings=false` 时）否则全局 `AtlasSetting`，阈值随工程设置变化，别假设仍是 2048。
5. 读取实际输出目录、扩展名、耗时和文件变更清单；文件清单不等于 Git 内容一定变化。
6. 发布期间部分读写 Action 会被阻塞；遇到超时先检查状态和 `.agent/bridge.log`，不要并发重复发布。

## CLI 约定

在独立仓库根目录使用：

```bash
uv sync --frozen
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT status
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT ping
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT packages
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT tree
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT replace-object-resource --id n12_ox87 ui://package/resource --expected-type image --save
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT get-text-style --path root/title
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT set-text-style --path root/title '{"fontSize":40,"color":"#FFFFFF","align":"center"}' --save
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT verify-document --max-depth 12 --path root/title --expected '{"fontSize":40}'
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT verify-document --expected '{"children":[{"name":"title","type":"text","fontSize":40},{"id":"n12_ox87"}]}'
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT analyze-atlas-fit Package1
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT clear-atlas-markers Package1
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT clear-atlas-markers Package1 --item-name AtlasFixture_HD --execute --close-open-documents
```

全局参数 `--project`、`--editor`、`--timeout` 必须位于子命令前。`call` 只用于调试原始 Action，不替代正式 MCP 工具。

## 安装位置与安装方式

面向使用者的 `README.md` 同时提供“AI 快速安装（提示词安装）”和“人类安装”。AI 安装必须实际执行并验证下述同一套安装步骤，不能只返回命令说明。

安装边界必须明确区分：

- FairyGUI Editor 插件安装到每个目标 FairyGUI 工程的 `plugins/agent-bridge/`。
- MCP/CLI 始终从独立 Bridge 仓库或已安装的 Python 工具环境运行，不放入 FairyGUI 工程。
- Skill 可选安装到 Codex 操作的目标代码仓库 `.agents/skills/fgui-agent-bridge/`。
- `.agent/` 是目标 FairyGUI 工程生成的运行时队列，不是安装文件，也不纳入 Git。

普通使用者优先通过同步脚本选择 FairyGUI 工程并安装插件：

```bash
uv run python scripts/sync_to_project.py --choose-project --apply
```

脚本会先校验所选目录，再写入目标工程的 `plugins/agent-bridge/`；无效目录或取消选择时不得写入。自动化环境可改用 `--project PATH --apply`。

在独立 Bridge 仓库准备 Python 环境：

```bash
uv sync --frozen
```

注册 Codex MCP 时同时保留 Bridge 仓库路径与目标 FairyGUI 工程路径：

```bash
codex mcp add fgui -- \
  uv run \
  --project /ABSOLUTE/PATH/TO/FGUI-AGENT-BRIDGE \
  fgui-agent-mcp \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT/FairyGUI.fairy
```

Skill 按需复制到目标代码仓库：

```bash
mkdir -p /ABSOLUTE/PATH/TO/TARGET-REPOSITORY/.agents/skills
cp -R .agents/skills/fgui-agent-bridge \
  /ABSOLUTE/PATH/TO/TARGET-REPOSITORY/.agents/skills/
```

完成安装后先执行低风险读取：`status → ping → project → packages`，不要以创建、导入、保存或发布作为首次连接测试。

### 同步与更新脚本

`scripts/sync_to_project.py` 支持目录选择和显式路径，两种方式都默认 dry-run，必须传入 `--apply` 才写入；支持 `--pull` 自动从源仓库拉取最新代码并同步 Python 环境：

```bash
# 打开目录选择器并安装插件
uv run python scripts/sync_to_project.py --choose-project --apply

# 从源仓库拉取更新并同步插件与 Skill
uv run python scripts/sync_to_project.py \
  --pull \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --skill-root /ABSOLUTE/PATH/TO/TARGET-REPOSITORY \
  --apply

# 或通过 CLI update 命令执行
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT update --pull --apply
```

`--project` 与 `--choose-project` 互斥。脚本不创建 Git 元数据、不复制缓存、不删除目标目录中的其他文件。若更新了插件文件，需重新打开 FairyGUI Editor 工程加载。

## 开发与变更同步

任何功能变动都必须在同一变更中完成：

1. 更新实现；修改 `plugin/main.ts` 后重新编译 `plugin/main.js`。
2. 同步 `plugin/package.json`、`pyproject.toml`、`__init__.py` 和 Bridge 常量版本。
3. 更新 README、当前能力参考和本 Skill。
4. 核对插件 capability、Action 分发、Python MCP 装饰器、CLI parser 与文档。
5. 检查同步脚本仍只写入受管理文件，默认保持 dry-run。
6. 确认没有提交 `.agent/`、`.venv/`、`__pycache__/`、`node_modules/`、`main.js.map` 或个人绝对路径。

推荐静态检查：

```bash
uv lock
uv sync --frozen
uv run python -m compileall -q src scripts
uv run fgui-agent --help
uv run fgui-agent-mcp --help
npx -y -p typescript@5.4.5 tsc -p plugin/tsconfig.json --pretty false
git diff --check
```

若 FairyGUI Editor 在线，再使用隔离工程副本验证 `fgui_status → fgui_ping → fgui_get_project`。创建、导入或发布 API 变更应在隔离副本中验证写操作；未做真实 Windows 验证时必须明确标注。

## 安全边界

- `.agent/` 是目标 FairyGUI 工程的运行时队列与日志，不纳入 Git。
- `replace_references` 是立即落盘且不可撤销的原生批处理，不进 Agent 撤销栈；执行前必须先跑预览，执行期间被发布封锁。
- `create_branch` / `switch_branch` 同样是立即落盘、不可撤销的工程原生操作；分支创建后只能用编辑器删除。切换前确认没有未保存文档，或用 `save_open_documents=true` 显式保存。
- `clear_atlas_markers` 同样立即落盘且不可撤销，但它是带外改 `package.xml` 并重开包；执行前会把原文件备份到 `.agent/backups/`，包内有打开的已保存文档必须显式允许关闭，未保存文档一律拒绝。回退方式是用备份覆盖后重新打开工程。
- 同一请求不要重复写入；响应必须按请求 ID 匹配。
- 插件会拒绝执行超过 60 秒未被认领的过期请求，并在 Bridge 初始化时清理残留队列文件；客户端命令超时不代表操作未执行，重试前先检查状态（如 `fgui_status` / `fgui_get_active_document`），避免写操作重复执行。
- 图片、声音、MovieClip 图片序列导入和发布是磁盘写入，执行前确认目标和冲突策略。Transition 声明式/关键帧修改与已有 MovieClip 更新/替换可由 Agent undo/redo 回退；全新资源创建、声音/图片导入和删除不能。
- MovieClip 删除即使传 `force=true` 也会执行引用检查；仍被组件使用时必须先移除引用。
- `replace_object_resource` 本轮仅允许 Image 与 Loader，拒绝 Button `state` 替换，避免误将整个按钮组件替换为单一资源。
- 文本样式修改支持类型与枚举检查，暂不支持自动 external reload。
- `verify_document` 可传入 `target + expected` 执行磁盘 XML 持久化比对，`expected.children` 递归比对对象树；失败响应保留结构化 `error.details`（包含 `stage`、`node`（spec 路径）、expected、actual、differences）。
- Transition 持久化验证只覆盖 `<transition>` 名称与公开条目数；`upsert_transition` 等操作可在保存前用 `fgui_verify_document` 之外的方式读取 `list_transitions` 做内存级确认，但不要据此声称属性级磁盘持久化。
- `set_property` 的持久化验证只覆盖已钉住序列化含义的属性（`x`/`y`/`width`/`height`/`scale`/`rotation`/`alpha`/`visible`/`touchable`/`grayed`/`text`/`icon` 及文本样式字段）；其余白名单属性可写入但不进入 `expected`。
- 不允许删除根组件；不要把 `discard`、`undo` 和 `save` 混为同一语义。
- 根组件点击穿透使用可序列化的 `opaque=false`；不要把无法持久化的根 `touchable` 宣称成功。
- 不在代码、配置、文档或示例中提交个人绝对路径、密钥或真实 MCP 配置。

## 输出要求

完成操作或维护任务时报告：

- 涉及的包、文档、对象或文件；
- 是否保存、发布、放弃或同步，以及作用范围；
- 执行了哪些静态检查、MCP 握手和编辑器验证；
- 哪些真实平台或环境仍未验证。
