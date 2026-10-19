# Agent Bridge 当前能力参考

> 这是独立 `fgui-agent-bridge` 仓库的能力快照。功能变动时必须同步本文件，并以源码实际签名为最终依据。

## 版本与通道

- Bridge 版本：`0.8.10`
- FairyGUI 插件 ID：`com.fgui.agent-bridge`
- 代码真源：独立公开仓库；业务工程只安装插件与 Skill 快照
- 队列协议：`1.0`
- FairyGUI Editor 基线：`6.1.4`
- MCP 工具数：51，其中新增 List/Group 布局、Relation、gearDisplay、Controller、资源引用图与全工程引用替换工具；`fgui_status` 和 `fgui_use_project` 为 Python 本地能力
- 传输：MCP stdio；底层为目标工程 `.agent/` 下的本地 JSON 文件队列
- 运行时目录：`.agent/requests`、`.agent/processing`、`.agent/responses`、`.agent/status.json`、`.agent/bridge.log`
- `.agent/` 是运行时数据，不纳入 Git

## MCP 工具签名

以下签名以 `src/fairygui_agent/mcp_server.py` 为准；工具参数使用 Python snake_case，桥接请求内部映射为 camelCase。

| 工具 | 主要参数 | 用途 |
| --- | --- | --- |
| `fgui_status` / `fgui_ping` / `fgui_use_project` | — / — / `project_path` | 读取状态、握手或选择工程 |
| `fgui_get_project` / `fgui_list_packages` | 无 | 读取工程或包 |
| `fgui_list_items` | `package_name`, `item_type?` | 列出包内资源 |
| `fgui_open_document` | `package_name`, `item_name` | 打开已有组件文档 |
| `fgui_create_component` | 包、名称、尺寸、目录、扩展、导出、重名策略、`save?`、`verify?` | 新建组件资源 |
| `fgui_import_image` / `fgui_import_font` / `fgui_import_sound` | 包、绝对路径、目录、名称、冲突策略、导出、`save?`、`verify?`、`external_reload?` | 导入或替换本地资源 |
| `fgui_create_button` | 包、名称、尺寸、模式、状态图片、目录、`save?`、`verify?` | 创建 Common/Check/Radio 标准 Button |
| `fgui_create_movieclip` | 包、名称、有序 `frame_paths`、FPS、延迟、Swing、目录、`save?`、`verify?`、`external_reload?` | 从本地图片序列创建/替换 MovieClip |
| `fgui_get_movieclip` / `fgui_update_movieclip` / `fgui_remove_movieclip` | MovieClip 资源定位；更新可传帧、FPS、Speed、延迟、Swing、`save?`、`verify?`、`external_reload?`（删除不支持 external_reload） | 读取、更新或显式强制删除 MovieClip |
| `fgui_get_active_document` / `fgui_get_tree` | 无 / `max_depth` | 读取活动文档或对象树 |
| `fgui_select_object` / `fgui_set_property` | ID、路径或唯一名称；后者加 `property`、`value`、`save?`、`verify?`、`external_reload?` | 选择对象或修改白名单属性 |
| `fgui_replace_object_resource` | target、resource_url、expected_type、save?、external_reload? | 通过 Editor API 替换 Image/Loader 资源引用（Button 状态显式拒绝） |
| `fgui_query_references` / `fgui_query_dependencies` | `resource_url`、`max_items?`、`skip_package_open?` / 另加 `seek_level?` | 只读引用图：谁引用了这个资源 / 这个资源依赖了谁，精确到 packageId/itemId/propKey/arrayIndex/valueType；`seek_level` 取 `selection`/`samePackageButNotExported`/`samePackage`（默认）/`all`，`max_items` 默认 200、上限 2000 |
| `fgui_get_text_style` / `fgui_set_text_style` | target、style、save?、external_reload? | 读取或设置文本对象样式并回读 |
| `fgui_verify_document` | max_depth、target?、expected?、external_reload? | 重新读取活动文档对象树和 Editor 状态；expected 含 children 时执行递归对象树比对 |
| `fgui_set_list_layout` | target、`fields`（布局字段集）、save?、verify?、external_reload? | 修改 List 布局：`layout`/`selectionMode`/`lineGap`/`columnGap`/`defaultItem`/`autoItemSize`/`align`/`vAlign`/`selectionController`/`foldInvisibleItems`/`clearOnPublish`/`scrollItemToViewOnClick`/`overflow`/`margin` |
| `fgui_set_group_layout` | target、`fields`、save?、verify?、external_reload? | 修改 Group 布局：`advanced`/`layout`/`lineGap`/`columnGap`/`excludeInvisibles`/`mainGridMinSize`/`mainGridIndex`/`autoSizeDisabled`/`collapsed` |
| `fgui_set_relation` | target、`relations` 数组、save?、verify?、external_reload? | 整体替换对象 Relation 绑定（sidePair 或 pairs 两种写法） |
| `fgui_set_gear_display` | target、`controller`（null/空清除）、`pages?`、save?、verify?、external_reload? | 设置 gearDisplay 联动的控制器与可见页面 |
| `fgui_list_controllers` / `fgui_set_controller` | 无 / `name`、pages/add_pages/selected_index/selected_page/exported/auto_radio_group_depth/home_page、create?、remove?、save?、verify?、external_reload? | 列出或创建/修改/删除当前组件 Controller |
| `fgui_insert_object` / `fgui_remove_object` | 资源 URL、坐标 / 目标；均支持 `save?`、`verify?`、`external_reload?` | 插入已有资源或删除非根对象；删除按缺失性验证处理 |
| `fgui_list_transitions` / `fgui_get_transition` | 无 / `name` | 读取当前组件的 Transition |
| `fgui_upsert_transition` / `fgui_remove_transition` | 类型化 `transition` / `name`，均支持 `save?`、`verify?`、`external_reload?` | 声明式创建、完整替换或删除 Transition |
| `fgui_add_transition_item` / `fgui_update_transition_item` / `fgui_remove_transition_item` | `name`、类型化 `item`、`item_index`、`save?`、`verify?`、`external_reload?` | 原子增删改 Transition 关键帧 |
| `fgui_preview_animation` | `kind`, `operation`, Transition 名称或 MovieClip 目标 | 播放、暂停、停止、跳帧或查询状态，不保存 |
| `fgui_undo` / `fgui_redo` / `fgui_get_history` | 无 | Agent 事务优先的回退和历史读取 |
| `fgui_save_document` / `fgui_save_all` / `fgui_discard_document` | 无 | 保存、全部保存或放弃当前文档修改 |
| `fgui_get_publish_settings` / `fgui_publish` | 包名? / 范围、包、分支、保存策略 | 读取或执行现有发布配置；发布前自动将 1920×1080/2K 级大图设置为 FairyGUI `alone` 纹理集，避免与小图混排 |

## 动画语义

### Transition

- 使用类型化 JSON；时间单位为 FairyGUI frame，`frameRate` 决定实际播放速度。
- 支持全部 FairyGUI 原生轨道：`XY`、`Size`、`Pivot`、`Scale`、`Skew`、`Alpha`、`Rotation`、`Color`、`Animation`、`Visible`、`Sound`、`Transition`、`Shake`、`ColorFilter`、`Text`、`Icon`。
- Tween 支持持续帧数、缓动、重复、Yoyo、路径和自定义缓动数据；路径读取为 `{encoded, points}`，再次写入应优先复用 `encoded`，避免丢失 Editor 自动生成的端点或控制点。
- `fgui_upsert_transition`、关键帧原子编辑和删除均为一次 Agent 动画事务，可用 `fgui_undo` / `fgui_redo` 整步回退；若文档动画已被外部操作改写，回退会拒绝覆盖。
- `Sound` 轨道只接受工程内声音类型的 `ui://` URL；可先使用 `fgui_import_sound` 导入。嵌套 `Transition` 必须已存在于同一组件。
- `playTimes` 是 Editor 运行态信息，不序列化到组件 XML；持久播放次数应使用 `autoPlayRepeat` 或轨道自身的播放次数字段。
- `fgui_preview_animation(kind="transition")` 只操作 Editor 预览。播放状态、暂停和 Timeline 跳帧不写入资源文件。

### MovieClip

- `fgui_create_movieclip` 接收有序绝对图片路径；FairyGUI 原生 `AniData.ImportImages` 将帧嵌入 `.jta`。不会为各帧额外创建包内图片 `ui://` 资源。
- 可设置 `fps` (`1..255`)、`speed`、`repeat_delay` (`0..255` 额外延迟帧)、`swing` 和每帧 `frame_delays` (`0..255`)。
- 创建/更新响应包含本次 `frameSources` 与 `resourceChanges`；重新读取 `.jta` 时只返回可持久读取的帧索引、矩形和延迟，不返回原始本地路径。
- `fgui_update_movieclip` 传入 `frame_paths` 时替换完整帧序列；所有图片必须存在且为 FairyGUI 支持的图片格式。失败时恢复原 `.jta`、尺寸和导出设置；全新创建失败会清理本次新建资源。
- 已有 MovieClip 的 `update` 与冲突策略 `replace` 记录文件快照，可用 Agent undo/redo 回退；全新创建和删除不进入可逆资源生命周期历史。
- `fgui_preview_animation(kind="movieclip")` 支持 `play`、`pause`、`stop`、`seek`、`next`、`previous`、`status`；仅改变编辑器内对象预览状态，不保存。
- MovieClip 创建/更新、图片序列处理和声音导入均可能写磁盘；它们不由 `fgui_discard_document` 自动回滚。删除 MovieClip 必须显式 `force=True`，且存在组件引用时拒绝删除。

## 创建、导入、保存与发布

- 包内目录输入可写 `Folder/SubFolder`，桥接统一为 `/Folder/SubFolder/`；缺失目录可按参数创建。
- 图片、字体和声音导入支持 `error`、`auto_rename`、`replace`。`replace` 只允许相同资源类型。
- 所有本地导入路径均必须是绝对路径；导入和替换是磁盘写入。
- `fgui_save_document` / `fgui_save_all` 保存文档和包改动；`fgui_discard_document` 只放弃当前文档未保存改动。
- 发布前先用 `fgui_get_publish_settings`。发布期间桥接会阻止资源、动画及文档写操作。

## CLI 映射

正式子命令包括：

- 基础：`status`、`ping`、`project`、`packages`、`items`、`open`、`active`、`tree`、`select`；`set`、`insert`、`remove` 支持 `--save` / `--no-verify` / `--external-reload`
- 资源：`create-component`、`create-button`、`import-image`、`import-font`、`import-sound`、`create-movieclip`、`get-movieclip`、`update-movieclip`、`remove-movieclip`；均支持 `--save` / `--no-verify`，image/font/sound/movieclip 另支持 `--external-reload`（asset 重载）
- Transition：`transitions`、`get-transition`、`upsert-transition`、`remove-transition`、`add-transition-item`、`update-transition-item`、`remove-transition-item`；写命令支持 `--save` / `--no-verify` / `--external-reload`（文档关闭重开）
- P0 验证：`replace-object-resource`、`get-text-style`、`set-text-style`、`verify-document`
- 布局与控制器（0.8.8）：`set-list-layout`、`set-group-layout`、`set-relation`、`set-gear-display`、`controllers`、`set-controller`；写命令支持 `--save` / `--no-verify` / `--external-reload`
- 预览：`preview-transition`、`preview-movieclip`
- 保存发布：`save`、`discard`、`save-all`、`history`、`undo`、`redo`、`publish-settings`、`publish`
- `call` 仅调试原始 Action，不替代正式命令。

全局参数 `--project`、`--editor`、`--timeout` 必须置于子命令前。

## 关键限制

- 兼容基线是 FairyGUI Editor `6.1.4`；其他 6.x 尚未完成真实环境矩阵验证。
- 本版本不包含 Spine、DragonBones、Loader3D、SWF 或运行时游戏代码层动画控制。
- 通用包资源的删除、移动、重命名仍未开放；只提供带 `force` 和引用检查的 MovieClip 删除。
- Windows 尚未完成真实环境端到端验证。

## 文件变动同步矩阵与对照检查

| 变动文件/区域 | 需要同步 |
| --- | --- |
| `plugin/main.ts` Action、参数、返回值、动画序列化、阻塞策略、协议或版本 | `plugin/main.js`、三处版本、README、本 Skill 与本文件 |
| `src/fairygui_agent/mcp_server.py` MCP 工具或参数 | `src/fairygui_agent/bridge_client.py` capability、README、CLI/Skill 映射、本文件 |
| `src/fairygui_agent/cli.py` 子命令、参数或退出码 | README CLI、本 Skill、本文件 |
| `src/fairygui_agent/bridge_client.py` 队列、能力校验、超时或响应语义 | README 安装/协议、本 Skill、本文件 |

1. `plugin/package.json`、`pyproject.toml`、`src/fairygui_agent/__init__.py`、`plugin/main.ts` 和 `plugin/main.js` 版本一致。
2. 插件 capability、Action 分发、Python 动画 capability 检查、MCP 工具、CLI parser 和文档清单一致。
3. `plugin/main.ts` 与重新编译的 `plugin/main.js` 一致。
4. 创建/导入/预览变更应在 FairyGUI Editor `6.1.4` 隔离工程副本中验证，避免污染正式工程。

### P0 可信持久化验证（0.8.3）

- `replace_object_resource` 本轮仅允许 Image/Loader，拒绝 Button `state`，避免把整个 Button 替换误报为状态资源替换。
- 保存时检查 Editor 文档变为未修改；`save=false` 或 `verify=false` 不会声称磁盘已持久化。
- `verify_document` 可传 `target + expected`，默认读取组件 XML 比对目标字段；无 `expected` 时只是快照；`expected` 含 `children` 时执行递归对象树比对（见下文 0.8.7）。
- 失败响应保留 `error.details`，包含 `stage`、expected、actual 和 differences（如有）。
- **external reload（2026-10-15 实现并在 FairyGUI Editor 6.1.4 真机验证）**：`replace_object_resource`、`set_text_style`、`verify_document` 支持 `external_reload`，保存后关闭当前文档、重新打开、在新文档上按 target 重新定位并比对 `expected`。关闭方式不硬编码，运行时按 `CloseDocuments` → `CloseDocument` 探测并在 `verification.reload.closeStrategy` 回报，实测命中 `CloseDocuments`。
- 响应的 `strength` 字段标明验证强度：`reload`（关闭重开比对通过，可确认持久化）/ `disk`（仅保存成功且磁盘 XML 匹配）/ `none`（未验证）。读 `persisted` 时必须同时看 `strength`，否则会把 `disk` 误当作已排除「重载丢值」。
- `external_reload` 要求 `save=true`，且与 `verify=false` 冲突，两种组合都在**任何变更之前**拒绝，不会留下半写入的文档；`verify_document` 不保存，文档有未保存改动时同样拒绝执行重载。
- 真实 FairyGUI Editor 端到端的 external reload 已完成（`tests/reports/external-reload-live.json`）；Unity/真机验收仍未完成。

### 写 Action 统一验证（0.8.5，2026-10-16 真机验证）

- `set_property`、`insert_object`、`remove_object` 迁入与 `replace_object_resource` / `set_text_style` 相同的 `writeVerification` 语义：统一返回 `{ok, target, before/after, documentModified, saved, persisted, strength, verification, note}`，支持 `save` / `verify` / `externalReload` 参数。
- `set_property` 保留 Agent 属性 undo/redo 事务栈；非白名单属性报 `unsupported_property`，数值/布尔/字符串属性先做类型归一化再写入，`font` 传入 `ui://` URL 时解析为字体资源 canonical URL。
- 验证层新增已钉住序列化含义的通用属性：`scaleX`、`scaleY`（`scale`）、`rotation`、`alpha`、`visible`（仅 `false` 序列化）、`touchable`（仅 `false` 序列化）、`grayed`（仅 `true` 序列化）、`text`（`text`/`title`）、`icon`；其余白名单属性可以写入但不进 `expected`。
- `remove_object` 按缺失性验证：保存后要求磁盘 XML 不再包含目标节点，`external_reload` 关闭重开后要求目标仍不可解析；`verify:false` 时跳过磁盘比对，不报 `persisted`。
- `insert_object` 验证新节点的 `id`、`name`、`type`、`x`、`y`（有引用时含 `resourceURL`）已写入磁盘 XML。
- 模拟宿主 `tests/p0_host_harness.cjs` 扩到 51 项；真机 6.1.4 已验证 `x`/`visible`/`scaleX` 写+存+重载、insert 磁盘回读和 remove 关闭重开后仍缺失。Transition/MovieClip/创建导入类 Action 尚未接入统一写验证。

### 动画与包资源统一写验证（0.8.6）

- Transition 写操作（`upsert_transition`、`remove_transition`、`add_transition_item`、`update_transition_item`、`remove_transition_item`）迁入同一 `save` → 磁盘 XML 回读 → `externalReload` 梯子：验证组件 XML 中 `<transition>` 节点的存在性与公开条目数（tween 合成端点不重复计数）；`externalReload` 为关闭重开文档后在新文档上重新读取 Transition 集合。动画快照 undo/redo 语义保持不变；验证失败不回滚已落笔的编辑器变更。
- 包资源写操作（`create_component`、`create_button`、`import_image`、`import_font`、`import_sound`、`create_movieclip`、`update_movieclip`、`remove_movieclip`）验证 `package.xml` 资源条目：保存包与工程后回读清单，并要求 image/sound/font/movieclip 的资源文件存在；`externalReload` 仅这些资产类型可用（`UnloadAsset` + `GetAsset` 重载），组件创建与删除拒绝该参数，`strength` 上限 `disk`。
- 全部写 Action 的响应统一带 `saved`、`persisted`、`strength`、`verification`、`note`；`requiresSave` 改为按实际保存结果返回。
- 包资源名称比对按去扩展名归一化：`item.name` 注册归一化时机不一致（MovieClip 创建时可不带扩展名），`package.xml` 的 `name` 属性总是文件名；真机 6.1.4 实测确认。
- 模拟宿主新增 Transition 与包资源验证用例，总数 71；**真机 6.1.4 已验证**：`upsert_transition`/`add_transition_item` 磁盘回读（itemCount 折叠正确）、`remove_transition` 关闭重开后仍缺失（`CloseDocuments`）、`create_movieclip` 清单+`.jta`+asset reload（`strength:reload`）、`remove_movieclip` 包清单缺失、`create_component` 清单回读（`strength:disk`）。

### verify_document 对象树比对（0.8.7）

- `expected` 扩展为可递归的树结构 spec：`children` 为子节点 spec 数组，节点其余字段仍为 `VERIFIED_KEYS` 属性断言（`id`/`name`/`type` 同时充当定位与断言）；保留结构字段 `childrenMode` 与 `index`。
- `childrenMode` 默认 `exact`：子节点按位置全等，数量必须一致，spec 中的 `index` 若提供必须等于实际位置；`subset` 模式下每个 spec 按 `id`/`name`/`index` 定位一个互不重复的子节点，允许多余节点，未定位到报 `target_not_found`（editor）或 `persistence_failed`（xml/reload）。
- 含 `children` 时 `target` 可省略（默认文档根组件）；纯属性 `expected` 仍必须提供 `target`。
- 三阶段验证沿用同一梯子：editor 内存树比对 → 磁盘 XML 比对（仅活动文档序列化范围：根节点 + displayList 直接子节点；嵌套组件内部计入 `verification.xmlSkipped`，不比对其他文件的 XML）→ `external_reload` 关闭重开后在重新载入的文档上整树重走。
- 响应 `verification` 新增 `mode:"tree"`、`checked`（比对节点数）、`xmlChecked`/`xmlSkipped`（XML 阶段覆盖/跳过数）；失败 `error.details` 带 `node`（如 `expected.children[2]`）定位到具体 spec 路径。
- 模拟宿主新增 16 项树比对用例（总数 87）；**已在 FairyGUI Editor 6.1.4 真机验证**：exact 全树 10 节点（XML 覆盖 9、嵌套组件内部跳过 1）、subset 容忍多余节点、`editor_rejected`/`target_not_found`/`persistence_failed`(stage xml)/`invalid_argument` 各类失败路径、非根 target 子树的 xmlSkipped 记账，以及 `external_reload` 经 `CloseDocuments` 关闭重开后整树 10 节点重走（`strength:reload`）。

### List/Group 布局、Relation、gearDisplay、Controller（0.8.8）

- `set_list_layout` / `set_group_layout` 走 `fields` 扁平字段集；字段经类型化校验后优先写对象模型成员（编辑器中 List/Group 的布局成员本身就是序列化字符串），对象模型未暴露的属性（如 `overflow`、`autoClearItems`、`margin`）回退到 `GetProperty`/`SetProperty`。不支持的字段报 `unsupported_property`，不产生半写入。
- `set_list_layout` 的 `layout` 接受语义名 `single_column`/`single_row`/`flow_horizontal`/`flow_vertical`/`pagination`（内部解析为 `FList` 常量的序列化值）或原始序列化值 `column`/`row`/`flow_hz`/`flow_vt`/`pagination`；`defaultItem` 必须是 `ui://` 组件资源 URL；`selectionController` 校验控制器存在。
- `set_group_layout` 的 `layout`/`lineGap`/`columnGap`/`excludeInvisibles` 仅对 `advanced=true` 的高级组有效；普通组提交这些字段会在写入前报 `invalid_argument`。
- `set_relation` 是**整体替换**语义：`relations` 数组每项给 `target`（对象定位，缺省/null 表示父组件）+ `sidePair`（如 `"right-right"`）或 `pairs`（`[{source,target,percent?}]`）。sidePair 校验方向合法性（水平↔水平、垂直↔垂直），空 sidePair 的关系条目不参与比对（编辑器对未触碰对象也会序列化空 `<relation target="" sidePair=""/>`）。写入走 `DocElement.UpdateRelations`（真机 6.1.4 实测：直接 `FRelations.Reset()+AddItem` 会把文档卡在 modified 且 save 静默失败），回退 `SetRelation`/`RemoveRelation`。
- `set_gear_display` 绑定 gear 0（Display）：`controller` 必须已存在；`pages` 接受页面 id 或名称（名称解析为 id 后写入）；`controller` 传 null/空字符串清除联动并同时清空 pages。写入走 `DocElement.UpdateGears`（保留其他 gear 子元素），读取走 `FObject.WriteGears()` 序列化 XML——`GetGear` 返回的 `IGear` 是空接口，无法读成员。
- `set_controller`：`create:true` 创建；`remove:true` 按缺失性验证删除；`pages` 整体替换页面集（**会重新分配页面 id**，依赖页面 id 的 gearDisplay 引用需重新核对）；`add_pages` 追加；`selected_index`/`selected_page` 设置选中页。`exported`/`auto_radio_group_depth`/`home_page` 可写但当前验证层只钉住 `pageCount`/`pageNames`/`selectedIndex`。
- 五个写 Action 沿用统一验证梯子（editor → save → 磁盘 XML → external reload）；Controller/Relation/gearDisplay 的 XML 阶段分别比对顶层 `<controller>` 元素和对象节点下的 `<relation>`/`<gearDisplay>` 子元素；枚举型序列化属性缺省（未写出）时计入 `verification.xmlSkippedKeys`，不当作失败也不声称已验证。
- 真机 6.1.4 已确认的序列化行为：`GetPageNames()` 返回 `id:name` 混合串（读取页面名须用 `GetPages().name`）；`scrollItemToViewOnClick` 序列化默认值为 `true`（缺省不写出）；`selectionMode` 仅在非默认时序列化；`FList` 的 `clearOnPublish`/`foldInvisibleItems`/`scrollItemToViewOnClick` 是公开字段，`overflow`/`marginStr` 在 `FComponent` 基类。
- 模拟宿主新增 25 项用例（总数 112）；**真机 6.1.4 已验证**（证据：`tests/reports/phase4-live-0.8.8.json`）：list/group 布局写+存+重载、relation 整组替换（含 external reload）、gearDisplay 绑定/名称页面解析/清除、controller 创建/页面/选中页/删除与 external reload、全部错误路径按结构化 code+stage 失败。

## 0.8.9：写入路径归位到编辑器文档模型

背景：Phase 4 真机已暴露 `FRelations.Reset()+AddItem` 绕过文档模型会让文档卡在 modified
且 save 静默失败；`GetGear` 返回空接口 `IGear`。0.8.9 把同类风险从"事后靠验证发现"
前移到"写入路径本身就正确 + 绕过时可见且 fail-closed"。

### 行为变化

- **写入优先走文档模型**：`set_property` 一类属性写入改为优先调用
  `FairyEditor.View.DocElement.SetProperty`（与 `FObject.SetProperty` 签名一致），
  对象模型保留为回退（未打开文档的资源没有 `docElement`）。`opaque` 是 `FComponent`
  成员属性、文档模型无对应入口，维持成员写入。
- **写入路径回报**：所有经 `writeVerification` 的写 Action 返回新增 `writePath` 字段，
  取值 `document-model`（走了编辑器文档模型）或 `object-model`（绕过文档模型，
  持久化仅依赖显式 `SetModified` + 磁盘回读）。
- **静默保存 fail-closed**：请求 `save:true` 时，若写入确实改变了内存值、但文档
  未进入修改状态，直接报 `persistence_failed`（`details.stage = "modified"`），
  **在调用 `doc.Save()` 之前**失败关闭——而不是让 Save 静默成功却什么都没写。
  幂等写入（目标值与现值相同，如重复替换同一资源）不算绕过，不触发该检查。

### 编译期类型校验（构建工具）

`plugin/types/editor.d.ts` 不再是手写 `any` stub，改为由
`scripts/extract_editor_api.py --emit-stub` 从 FairyGUI Editor 包内真实声明生成：
成员名、静态性、参数个数（含重载与可选参数 `?`）、继承关系均与真实 API 一致。
参数与返回类型除基本类型外统一擦成 `any` 以避免拖入标准库依赖树。

它能挡住此前编译期完全放过的错误，例如：

```text
main.ts(3955,9): error TS2551: Property 'SetPropertty' does not exist on type 'FObject'. Did you mean 'SetProperty'?
main.ts(147,69):  error TS2554: Expected 1-3 arguments, but got 5.
main.ts(98,14):   error TS2576: Property 'project' does not exist on type 'App'. Did you mean to access the static member 'App.project' instead?
```

重新生成（需本机已装 FairyGUI Editor，清单只对 6.1.4 有效）：

```bash
python3 scripts/extract_editor_api.py --emit-stub plugin/main.ts --out plugin/types/editor.d.ts
```

### 验证边界

模拟宿主 118 项、Python 31 项全过。**已在 FairyGUI Editor 6.1.4 真机复验**
（证据：`tests/reports/p8-0-p8-1-live.json`）：10 条写 Action 的 `writePath` 全部与实际写入层
一致——`set_property`/`set_relation`/`set_gear_display`/`replace_object_resource`（Image）
为 `document-model`，`set_text_style`/`set_list_layout`/`set_group_layout`/`set_controller`/
`upsert_transition`/`replace_object_resource`（Loader）为 `object-model`；
`set_property --external-reload` 得 `strength:reload`。

**真机复验中发现并修复了两个本轮引入的缺陷：**

1. `writePath` 谎报——`lastWritePath` 原本只在 `setWritableProperty` 里赋值，
   `set_text_style` 等走成员赋值的路径从不赋值，会报出上一个 action 留下的值。
   改为每个请求入口重置为 `null`、每条写路径显式声明；新增回归用例
   `writePath is declared per action and never inherited from the previous one`。
2. `replace_object_resource` 最初漏报（Image 走 `Document.ReplaceSelection` 属文档模型，
   Loader 走 `FLoader.url` 属对象模型），已分别声明。

未在真机上验证的部分：持久化守卫主动触发 `persistence_failed` 的路径需要人为制造
「写入生效但文档未标记修改」，本次只由 mock host 覆盖。

## 0.8.10：资源引用图（只读，P8-2 的一半）

背景：§1.1 的「图片资源替换语义不完整」缺的不是替换能力，而是**替换前的影响面**——
过去无法回答「改这张图会波及哪些节点」。编辑器原生 `DependencyQuery` 正好提供
`propKey` / `arrayIndex` 这种「哪个对象的哪个属性槽」的精度。

### 行为

- `fgui_query_references`（`query_references`）：全工程范围内，列出所有引用目标资源的
  位置。**每条分四段**（真机实测后定稿，勿按 `ReferenceInfo` 的字段名想当然）：
  - `referencedItem`：被引用的资源（`packageId` / `packageName` / `itemId` / `itemName`）。
    `ReferenceInfo` 自身的 `ownerPkg`/`pkgId`/`itemId` 指的就是它，**不是引用方**；
  - `slot`：引用发生的属性槽（`element` 元素标签 / `propKey` / `arrayIndex` /
    `valueTypeCode` / `valueType`：`id`/`url`/`urlComplex`/`charImage`/`assetProperty`）；
  - `owner`：持有该槽的宿主对象（`objectId` / `objectName`，以及按对象 id 后缀解析出的
    `itemId` / `itemName`，解析不到即 `null`）；
  - `attributes`：该 XML 元素的完整属性表，便于调用方自行复核。
- `fgui_query_dependencies`（`query_dependencies`）：目标资源依赖了哪些资源。
  `seek_level` 取 `selection` / `samePackageButNotExported` / `samePackage`（默认）/
  `all`，分隔符写法不敏感（`same_package` 等价）；响应回报实际生效的 `seekLevel` 与
  `seekLevelCode`。
- 两条都返回 `readOnly: true`、`totalCount`、`truncated`。`max_items` 默认 200、上限 2000；
  **截断必须显式上报**，`totalCount` 始终是真实总数，不静默丢弃。
- **先打开未打开的包**：项目级引用查询若只扫已打开的包，会返回一个看起来完整、
  实际少算的结果。默认先 `EnsureOpen` 全部包，代价记录在 `packages` 字段
  （`{skipped, opened, packageCount}`）；`skip_package_open=true` 可跳过，但漏算风险
  由调用方自行承担，且响应会标 `skipped:true`。
- 取不到的名字报 `null`：引用方所在包可能没打开，不会为了展示一个名字去 `EnsureOpen`
  把一堆包装起来。资源描述失败时退回最小身份信息（`id`/`name`/`url`），不让单个
  未加载资源拖垮整条只读查询。
- 两条都是只读：不写文档、不标记 modified、不参与 publish 期间的写操作封锁表，
  也没有 `save` / `external_reload` 参数（MCP、CLI、插件三层同时约束，回归用例钉住）。
- 与 `replace_object_resource`（单对象覆盖）并存，语义不同：全工程替换走
  `replace_references`（0.8.11，见下节），不要用只读查询代替它。

### 真机实测要点（Editor 6.1.4，证据 `tests/reports/p8-2-live.json`）

- `ReferenceInfo.content` 是 `FairyGUI.Utils.XML` 元素节点；`attributes` 是 C# 字典，
  `JSON.stringify` 得 `{}`、`Keys.get_Item` 不存在，只能 `GetEnumerator()` + `MoveNext()`；
- `XML.ToXMLString()` 在 Puerts 下抛「overload is striped by unity」，不可用；
- `seekLevel` 语义实测：非选中查询只有 `samePackage` / `all` 有产出，`selection` 与
  `samePackageButNotExported` 在本工程返回 0 条；
- 只读性已验证：打开文档后连续查询，文档 `modified` 仍为 false，磁盘 XML 哈希不变；
- 顺带修复：`resolveItem` 的「未找到指定 FairyGUI 资源」此前被归成 `editor_rejected`，
  现为 `target_not_found`。

### 验证边界

模拟宿主 129 项、Python 33 项全过（含 11 项新增引用图用例）。**已在 FairyGUI Editor
6.1.4 真机复验**读侧全部能力与错误路径。**未复验**：多包工程中未打开的包是否会被少算
（隔离工程只有一个已打开的包，`packages.opened` 恒为 0，真机触发不了该分支）。

## 0.8.11：全工程引用替换（P8-2 写侧，P8-2 至此完成）

### 行为

- `fgui_replace_references`（`replace_references`）：把全工程对某个资源的所有引用
  替换成另一个资源。`mode` 缺省 `preview`，**只出预览**；`--execute` / `execute=true`
  才真正写入。这是硬要求：编辑器原生 `ReplaceReferences` 直接改包 XML，**立即落盘**、
  不产生脏文档、不进 Agent 撤销栈、没有 `save` 兜底——响应里 `undoable: false`、
  `strength: "disk"`、`writePath: "native-batch"` 就是在说这件事。
- 原生签名只有 `ReplaceReferences(newItem)`，没有 old 参数：它改的是同一个
  `DependencyQuery` 实例上 `QueryReferences` 查出来的那批引用。跨请求活不过实例，
  所以**执行时重新查询一次**，绝不拿预览时的列表去改全工程。
- 验证口径是**引用图**（`verification.scope: "reference-graph"`）：源资源残留引用必须
  为 0，目标资源引用数回报在 `verification.targetReferences`。这不是属性级一致性证明，
  响应里不宣称。
- `staleFileNameSlots` + `warnings`：原生批量替换会更新 `src`/`url`，但**不更新**
  image 元素的 `fileName`，于是落盘那一刻是一处半状态。这些节点下次经文档模型保存时
  由编辑器自己补齐（实测 `Document.ReplaceSelection` 对同 URL 也会重写该节点）。
  数量按引用图判定并显式上报，不静默。
- `typeChange`：源与目标资源类型不同（图替成组件等）时显式回报，不静默执行。
- 发布期间封锁（`actionsBlockedDuringPublish`）：立即落盘且不可撤销的动作不能与发布并发。
- 与 `replace_object_resource` 的分工：后者改「某一个对象的某一个属性槽」，走文档模型、
  可 Agent 撤销、有 `save`/`verify`/`external_reload` 梯子；前者改「全工程引用图」，
  走原生批处理、不可撤销。两者不互相替代。
- 顺带修复（0.8.10 遗留）：`owner.itemId/itemName` 原先只在**被引用资源所在包**里按对象
  id 后缀查，跨包引用（Package2 的组件引用 Package1 的图）必然查不到，会把「解析失败」
  伪装成「宿主为 null」。现在同包快路径失败后遍历全工程包兜底；仍查不到即 `null`
  （真机确实存在对象 id 后缀与所属 item id 不一致的组件，不猜）。

### 真机实测要点（Editor 6.1.4，证据 `tests/reports/p8-2-write-live.json`）

- `ReplaceReferences` 在**所有文档关闭**时也能改（不必逐个打开），打开着的文档内存状态
  会同步更新，之后普通保存不会把替换覆盖回去；
- 执行后包 XML 已是新值，但文档 `isModified` 与 `HasUnsavedDocuments` 都仍为 false
  ——它是即时落盘，不是脏文档，因此 `save` 对它没有意义；
- `src` 更新而 `fileName` 不更新（与单对象路径 `ReplaceSelection` 对照，后者两者都更新）；
  下一次经文档模型保存该节点时自动补齐；
- 无引用时执行是幂等空操作（staged 0）。

### 验证边界

模拟宿主 137 项、Python 35 项全过（含 8 项新增写侧用例）。**已在 FairyGUI Editor
6.1.4 真机复验**预览、执行、错误路径与幂等性。**未复验**：多包工程中的跨包替换与
「未打开的包是否会被少算」（隔离工程仍只有一个已打开的包）。
