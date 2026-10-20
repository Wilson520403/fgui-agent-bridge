# Agent Bridge 当前能力参考

> 这是独立 `fgui-agent-bridge` 仓库的能力快照。功能变动时必须同步本文件，并以源码实际签名为最终依据。

## 版本与通道

- Bridge 版本：`0.8.19`
- FairyGUI 插件 ID：`com.fgui.agent-bridge`
- 代码真源：独立公开仓库；业务工程只安装插件与 Skill 快照
- 队列协议：`1.0`
- FairyGUI Editor 基线：`6.1.4`
- MCP 工具数：63，其中新增 List/Group 布局、Relation、gearDisplay、Controller、资源引用图、全工程引用替换、图集约束分析、包级发布设置写入、带外图集标记纠正、Transition 只读校验与关键帧写入、分支列举/创建/切换，以及未使用/重复资源审计工具；`fgui_status` 和 `fgui_use_project` 为 Python 本地能力
- 传输：MCP stdio；底层为目标工程 `.agent/` 下的本地 JSON 文件队列
- 运行时目录：`.agent/requests`、`.agent/processing`、`.agent/responses`、`.agent/status.json`、`.agent/bridge.log`
- `.agent/` 是运行时数据，不纳入 Git

## MCP 工具签名

以下签名以 `src/fairygui_agent/mcp_server.py` 为准；工具参数使用 Python snake_case，桥接请求内部映射为 camelCase。

| 工具 | 主要参数 | 用途 |
| --- | --- | --- |
| `fgui_status` / `fgui_ping` / `fgui_use_project` | — / — / `project_path` | 读取状态、握手或选择工程 |
| `fgui_get_project` / `fgui_list_packages` | 无 | 读取工程或包 |
| `fgui_list_branches` | `refresh?`、`include_packages?`、`include_items?` | 列出工程分支；可选附带每个分支的包与资源 |
| `fgui_create_branch` / `fgui_switch_branch` | `name`、`switch_to?`、`save_open_documents?`、`verify?` / `name`、`save_open_documents?` | 创建或切换工程分支（工程原生 Action，立即落盘、不可撤销） |
| `fgui_list_items` | `package_name`, `item_type?`, `branch?` | 列出包内资源；传 `branch` 时读取该分支视图 |
| `fgui_open_document` | `package_name`, `item_name`, `branch?` | 打开已有组件文档 |
| `fgui_create_component` | 包、名称、尺寸、目录、扩展、导出、重名策略、`branch?`、`save?`、`verify?` | 新建组件资源 |
| `fgui_import_image` / `fgui_import_font` / `fgui_import_sound` | 包、绝对路径、目录、名称、冲突策略、导出、`branch?`、`save?`、`verify?`、`external_reload?` | 导入或替换本地资源 |
| `fgui_create_button` | 包、名称、尺寸、模式、状态图片、目录、`branch?`、`save?`、`verify?` | 创建 Common/Check/Radio 标准 Button |
| `fgui_create_movieclip` | 包、名称、有序 `frame_paths`、FPS、延迟、Swing、目录、`branch?`、`save?`、`verify?`、`external_reload?` | 从本地图片序列创建/替换 MovieClip |
| `fgui_get_movieclip` / `fgui_update_movieclip` / `fgui_remove_movieclip` | MovieClip 资源定位；更新可传帧、FPS、Speed、延迟、Swing、`save?`、`verify?`、`external_reload?`（删除不支持 external_reload） | 读取、更新或显式强制删除 MovieClip |
| `fgui_get_active_document` / `fgui_get_tree` | 无 / `max_depth`、`branch?` | 读取活动文档或对象树 |
| `fgui_select_object` / `fgui_set_property` | ID、路径或唯一名称；后者加 `property`、`value`、`save?`、`verify?`、`external_reload?` | 选择对象或修改白名单属性 |
| `fgui_replace_object_resource` | target、resource_url、expected_type、save?、external_reload? | 通过 Editor API 替换 Image/Loader 资源引用（Button 状态显式拒绝） |
| `fgui_query_references` / `fgui_query_dependencies` | `resource_url`、`max_items?`、`skip_package_open?` / 另加 `seek_level?` | 只读引用图：谁引用了这个资源 / 这个资源依赖了谁，精确到 packageId/itemId/propKey/arrayIndex/valueType；`seek_level` 取 `selection`/`samePackageButNotExported`/`samePackage`（默认）/`all`，`max_items` 默认 200、上限 2000 |
| `fgui_find_unused` | `packages?`、`types?`、`include_branches?`、`skip_exported?`、`max_items?` | 只读资源审计：按引用图找出零引用资源，返回包、路径、文件大小与图片尺寸；导出资源默认列出并标记 `exported`，`skip_exported=true` 可排除；`max_items` 默认 500、上限 5000 |
| `fgui_find_duplicate` | `packages?`、`types?`、`include_branches?`、`max_groups?`、`max_items_per_group?` | 只读资源审计：按文件内容 MD5 + 字节数分组，返回每组条目、浪费字节数；`max_groups` 默认 100、上限 1000，`max_items_per_group` 默认 50、上限 500 |
| `fgui_get_text_style` / `fgui_set_text_style` | target、style、save?、external_reload? | 读取或设置文本对象样式并回读 |
| `fgui_verify_document` | max_depth、target?、expected?、external_reload? | 重新读取活动文档对象树和 Editor 状态；expected 含 children 时执行递归对象树比对 |
| `fgui_set_list_layout` | target、`fields`（布局字段集）、save?、verify?、external_reload? | 修改 List 布局：`layout`/`selectionMode`/`lineGap`/`columnGap`/`defaultItem`/`autoItemSize`/`align`/`vAlign`/`selectionController`/`foldInvisibleItems`/`clearOnPublish`/`scrollItemToViewOnClick`/`overflow`/`margin` |
| `fgui_set_group_layout` | target、`fields`、save?、verify?、external_reload? | 修改 Group 布局：`advanced`/`layout`/`lineGap`/`columnGap`/`excludeInvisibles`/`mainGridMinSize`/`mainGridIndex`/`autoSizeDisabled`/`collapsed` |
| `fgui_set_relation` | target、`relations` 数组、save?、verify?、external_reload? | 整体替换对象 Relation 绑定（sidePair 或 pairs 两种写法） |
| `fgui_set_gear_display` | target、`controller`（null/空清除）、`pages?`、save?、verify?、external_reload? | 设置 gearDisplay 联动的控制器与可见页面 |
| `fgui_list_controllers` / `fgui_set_controller` | 无 / `name`、pages/add_pages/selected_index/selected_page/exported/auto_radio_group_depth/home_page、create?、remove?、save?、verify?、external_reload? | 列出或创建/修改/删除当前组件 Controller |
| `fgui_insert_object` / `fgui_remove_object` | 资源 URL、坐标 / 目标；均支持 `save?`、`verify?`、`external_reload?` | 插入已有资源或删除非根对象；删除按缺失性验证处理 |
| `fgui_list_transitions` / `fgui_get_transition` | 无 / `name` | 读取当前组件的 Transition |
| `fgui_verify_transition` | `name?`、`check_bounds?` | 只读校验 Transition 的目标、关键帧值、嵌套引用与 XY 范围；不保存、不置脏 |
| `fgui_upsert_transition` / `fgui_remove_transition` | 类型化 `transition` / `name`，均支持 `save?`、`verify?`、`external_reload?` | 声明式创建、完整替换或删除 Transition |
| `fgui_add_transition_item` / `fgui_update_transition_item` / `fgui_remove_transition_item` | `name`、类型化 `item`、`item_index`、`save?`、`verify?`、`external_reload?` | 原子增删改 Transition 关键帧（条目级 API） |
| `fgui_add_keyframes` | `name`、`keyframes`（`target_id`/`type`/`frame`/`label?`/`value?` 数组）、`save?`、`verify?`、`external_reload?` | 在时间轴上一次创建多个关键帧；帧号显式指定，批次内与既有轨道均做冲突预检 |
| `fgui_set_keyframe` | `name`、`changes`、`item_index` 或 `target_id`+`track_type`+`frame`、`save?`、`verify?`、`external_reload?` | 修改单个关键帧：`frame`/`label`/`tween`/`ease`/`repeat`/`yoyo`/`value`/`endValue` |
| `fgui_duplicate_transition` | `name`、`new_name?`、`save?`、`verify?`、`external_reload?` | 复制整条 Transition；6.1.4 原生复制忽略新名称，由文档模型改名 |
| `fgui_preview_animation` | `kind`, `operation`, Transition 名称或 MovieClip 目标 | 播放、暂停、停止、跳帧或查询状态，不保存 |
| `fgui_undo` / `fgui_redo` / `fgui_get_history` | 无 | Agent 事务优先的回退和历史读取 |
| `fgui_save_document` / `fgui_save_all` / `fgui_discard_document` | 无 | 保存、全部保存或放弃当前文档修改 |
| `fgui_get_publish_settings` / `fgui_publish` | 包名? / 范围、包、分支、保存策略 | 读取或执行现有发布配置；发布前按 `fgui_analyze_atlas_fit` 的真实约束判定 `alone` 纹理集归属，装不下的才标记 |
| `fgui_clear_atlas_markers` | `package_name`、`execute?`、`item_ids?`、`item_names?`、`close_open_documents?` | 带外清除磁盘上错误写入的 `atlas="alone"`；默认只预览，执行前保存并备份 `package.xml`，写入后回读并重开包 |

## 动画语义

### Transition

- 使用类型化 JSON；时间单位为 FairyGUI frame，`frameRate` 决定实际播放速度。
- 支持全部 FairyGUI 原生轨道：`XY`、`Size`、`Pivot`、`Scale`、`Skew`、`Alpha`、`Rotation`、`Color`、`Animation`、`Visible`、`Sound`、`Transition`、`Shake`、`ColorFilter`、`Text`、`Icon`。
- Tween 支持持续帧数、缓动、重复、Yoyo、路径和自定义缓动数据；路径读取为 `{encoded, points}`，再次写入应优先复用 `encoded`，避免丢失 Editor 自动生成的端点或控制点。
- `fgui_upsert_transition`、关键帧原子编辑和删除均为一次 Agent 动画事务，可用 `fgui_undo` / `fgui_redo` 整步回退；若文档动画已被外部操作改写，回退会拒绝覆盖。
- `Sound` 轨道只接受工程内声音类型的 `ui://` URL；可先使用 `fgui_import_sound` 导入。嵌套 `Transition` 必须已存在于同一组件。
- `playTimes` 是 Editor 运行态信息，不序列化到组件 XML；持久播放次数应使用 `autoPlayRepeat` 或轨道自身的播放次数字段。
- `fgui_preview_animation(kind="transition")` 只操作 Editor 预览。播放状态、暂停和 Timeline 跳帧不写入资源文件。
- `fgui_verify_transition` 是**只读**校验，不修改文档、不保存、不置脏。检查目标对象是否存在、`FTransition.GetAllowType` 是否支持该轨道、Alpha/Color/Volume 的 0..1 范围、Size 非负、Rotation/Animation 帧值、嵌套 Transition 与 Sound 资源是否存在、Tween 是否有配对端点且时长合法，并可选检查 XY 是否落在画布内。
- 结果分两级：`errors` 是确定缺陷（如目标已删除、值越界、嵌套引用缺失），`warnings` 是可能合法的情况（如 `position_outside_canvas`——滑入/滑出动画的越界坐标本身就是设计意图；Pivot 超出 0..1 等）。`summary.valid` 只由 error 决定，`summary.clean` 才要求 error 与 warning 均为 0。
- `checkBounds=False`（CLI `--no-bounds`）跳过 XY 画布范围检查；省略 `name` 时校验当前组件的全部 Transition。校验器不调用 `describeTransition`，损坏的 Tween 不会让整个校验抛错。

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
- `publish` 是唯一安全的发布入口，`--desc-only` 只导描述文件。`PublishHandler` 的
  `Export*` 分步方法依赖 `Run()` 的私有流水线，不能独立调用；不要用 `call` 直接驱动
  分步导出（2026-10-20 真机探针：`Run()` 前会崩，完整 `Run()` 后再导资源会挂死编辑器）。
- 分支（0.8.18）：`fgui_list_branches` / `fgui_create_branch` / `fgui_switch_branch` 管理工程分支；
  `fgui_list_items`、`fgui_open_document`、`fgui_get_tree` 与全部包资源创建/导入 Action 接受
  `branch` 参数。分支资源落在 `assets_<branch>/<pkg>/`，清单是 `package_branch.xml`；
  写验证比对的是这份清单，而不是主干 `package.xml`。

## CLI 映射

正式子命令包括：

- 基础：`status`、`ping`、`project`、`packages`、`items`、`open`、`active`、`tree`、`select`；`set`、`insert`、`remove` 支持 `--save` / `--no-verify` / `--external-reload`
- 分支（0.8.18）：`branches`（`--refresh` / `--packages` / `--items`）、`create-branch`（`--switch` / `--save-open-documents` / `--no-verify`）、`switch-branch`（`--save-open-documents`，空名称切回主干）；`items`、`open`、`tree` 与包资源创建/导入命令支持 `--branch`
- 资源：`create-component`、`create-button`、`import-image`、`import-font`、`import-sound`、`create-movieclip`、`get-movieclip`、`update-movieclip`、`remove-movieclip`；均支持 `--save` / `--no-verify`，image/font/sound/movieclip 另支持 `--external-reload`（asset 重载）
- Transition：`transitions`、`get-transition`、`verify-transition`（可选 `--no-bounds`）、`upsert-transition`、`remove-transition`、`add-transition-item`、`update-transition-item`、`remove-transition-item`、`add-keyframes`、`set-keyframe`（`--item-index` 或 `--target-id`+`--type`+`--frame`）、`duplicate-transition`（`--new-name`）；写命令支持 `--save` / `--no-verify` / `--external-reload`（文档关闭重开）
- P0 验证：`replace-object-resource`、`get-text-style`、`set-text-style`、`verify-document`
- 布局与控制器（0.8.8）：`set-list-layout`、`set-group-layout`、`set-relation`、`set-gear-display`、`controllers`、`set-controller`；写命令支持 `--save` / `--no-verify` / `--external-reload`
- 预览：`preview-transition`、`preview-movieclip`
- 保存发布：`save`、`discard`、`save-all`、`history`、`undo`、`redo`、`publish-settings`、`publish`
- `call` 仅调试原始 Action，不替代正式命令。

全局参数 `--project`、`--editor`、`--timeout` 必须置于子命令前。

## 关键限制

- 兼容基线是 FairyGUI Editor `6.1.4`；其他 6.x 尚未完成真实环境矩阵验证。
- 发布只有 `publish` 与 `publish --desc-only`；`PublishHandler` 的分步导出方法不可独立调用
  （证据 `tests/reports/p8-5-publish-steps-probe.json`）。
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

## 0.8.12：图集约束分析（P8-5 只读切片）

### 行为

- `fgui_analyze_atlas_fit`（`analyze_atlas_fit`）：**纯只读**，按图集打包器的真实约束
  判断每张图能否入图集，取代原先只看像素大小的大图硬编码猜测
  （`LARGE_IMAGE_LONG_SIDE_MIN=1920` / `SHORT_SIDE_MIN=1080` / `2K_SIDE_MIN=2048`）。
- 约束有两个来源，形状不同但都必须归一化：包级 `PublishSettings.atlasList` 里每条
  `AtlasSettings.packSettings`（`padding` 每边 2 份、`minWidth/minHeight` 会把小图放大到
  下限、`maxWidth/maxHeight`、`square`、`rotation`、`pot`、`multiPage`），与全局
  `GlobalPublishSettings.atlasSetting`（`maxSize` / `forceSquare` / `allowRotation` /
  `sizeOption` / `paging`，无 padding 概念）。`useGlobalAtlasSettings` 决定用哪套；
  全局只有一条约束，与资源挂在哪张图集无关。
- 判定：`padding` 后足迹取 `max(实际+padding, 下限)`；`rotation` 允许 90° 打包，
  **任一朝向成立即算装得下**；`square` 下每张图占正方形区域，边长在旋转下不变，
  所以**旋转对方形图集没有帮助**。
- `fit` 三态：`fits` / `exceeds` / `unknown`。`unknown` 用于约束缺失时**拒绝下结论**
  （`reason` 为 `no-dimensions` / `no-constraints` / `atlas-not-configured` /
  `limits-unspecified`），不猜、不当 fits 放行。资源已钉到没配置的图集（如 `alone`
  这类编辑器内建名）同样报 `unknown` 而不是猜一套约束。
- `supportAtlas=false` 的资源计入 `skippedNotAtlasable`，不参与判定。
- **图集归属以磁盘为准**：真机实测 6.1.4 的 `FPackageItem.folderAtlas` **不与 `package.xml`
  往返**——`<image atlas="alone">` 写入磁盘且后续保存原样保留，但编辑器重启后内存读回
  为空串。因此每张图分列 `folderAtlasInMemory` / `folderAtlasOnDisk`，归属解析与
  `assignedAloneOnDisk` 一律读磁盘 `package.xml`，响应 `folderAtlasRoundTrip`
  显式声明该行为。只报内存值会对使用者说谎（真实标了 alone 却显示为空）。
- **旧规则在 import 时就生效，不只在 publish**（真机实证）：只调
  `import_image --save`、全程未调 publish，`package.xml` 已写入 `atlas="alone"`。
  调用点为 `import_image`（首次导入与同名替换）。因此 `disagreements` 统计的是
  **已经写进工程的**图集归属，不只是下次发布会发生什么。响应
  `legacyRule.appliedAt` 列出全部三个调用点。附带后果：因内存值不读回，
  `applyLargeImageAtlasRule` 的幂等守卫在重启后恒不命中，每次 publish 都会重复
  `SetChanged`。
- **主产出是 `summary.assignedAloneButFits`**：磁盘上已标 `alone`、但按真实约束
  装得下的图有几张——这是最直接可执行的数。逐图 `legacyAlone` 与 `disagrees`
  （恒为布尔，不靠缺字段表示 false）。
- **不改任何东西**：不写 `folderAtlas`、不置脏。要改归属得等写侧 `set_publish_settings`。

### 验证边界

模拟宿主 153 项、Python 35 项全过（含 16 项新增用例：真实上限、padding、rotation、
方形图集、下限放大、unknown 三态、按磁盘归属分派、内存/磁盘不一致、只读性、错误路径）。
**已在 FairyGUI Editor 6.1.4 真机复验**：全局约束路径、真实大图（1920x1080 / 4096x4096 /
256x256）触发 `exceeds` 与 `disagreements`、以及 `folderAtlas` 不往返这一发现
（证据 `tests/reports/p8-5-atlas-fit-live.json`）。活体回归 `phase0_fixture verify --live`
21/21 通过。

**未复验**：①包级 `PackSettings` 路径真机没有可跑实例（隔离工程只有 Package1 且
`useGlobalAtlasSettings=true`），仅过编译期声明校验与模拟宿主；②`padding` / `rotation` /
`square` 三条分支真机未被触发——真机没有非全局图集设置的包。声明存在≠运行时可用
（`GetGear` 返回空接口 `IGear` 即反例），闭掉①需要一次把 `useGlobalAtlasSettings`
置 false 的真机操作，即写侧 `set_publish_settings`。

**夹具与基线注意**：sample 包新增 4 张图集夹具（`AtlasFixture_Small/HD/Huge/Probe`），
`tests/fixtures/phase0/initial-resources.json` 已随之更新（差异仅为新增）。
**不要盲目重跑 `phase0_fixture.py capture`**：它会把会话级值（`savedVersion`、
按会话分配的运行时节点 id 如 `n0_dftm`→`n0_ujgr`）固化进 `initial-tree.json`，
让基线随会话漂移。`AtlasFixture_Probe` 仅为验证 `folderAtlas` 往返而建，本可删除，
但 `FPackage.DeleteItem` 只接在 `remove_movieclip` 上、没有通用包资源删除 Action，
而手改 `package.xml` 被工程规范 §5.3 禁止，故保留。

## 0.8.13：包级发布设置写入（P8-5 写侧）

### 行为

- `fgui_set_publish_settings`（`set_publish_settings`）：按包写入发布与图集设置——
  标量 `path` / `genCode` / `codePath` / `branchPath` / `useGlobalAtlasSettings`，
  外加 `atlasList`（每条含 `name` / `compression` / `extractAlpha` / `packSettings`）
  与 `excludedList`。**只写显式提供的字段**，未提供的保持编辑器当前值。
- `atlasList` 是**全量替换**语义：传进来的数组就是落盘的最终列表，不做增量合并。
  理由是增量合并会留下「调用方以为删掉了、实际还挂在 List 里」的条目。
  省略该字段则完全不碰图集设置。
- `packSettings` 可写 `padding` / `minWidth` / `minHeight` / `maxWidth` / `maxHeight`
  （数值）与 `pot` / `mof` / `rotation` / `square` / `fast` / `edgePadding` /
  `duplicatePadding` / `multiPage`（布尔）。
- **`sizeOption` 被显式拒绝**：它是 `readPackSettings` 的读侧投影（把 `pot` 归一化成
  的输出别名），不是 `PackSettings` 的可写字段，写回它会静默丢失。未知字段同理——
  任何未列入白名单的键都在**改动包之前** `invalid_argument` 拒绝。

### 三条必须知道的写路径事实（6.1.4 声明 + 真机）

- `FPackage.publishSettings` 是**只读 getter**（`public get publishSettings()`），
  换不了对象，只能改它暴露的字段；`atlasList` / `excludedList` 是 public `List<T>`
  字段，就地 `Clear` + `Add` 重建。
- 包级设置**没有 `DocElement` 入口**，天然走对象模型。响应显式声明
  `writePath: object-model`，**不进组件文档的撤销栈**。这不是缺陷披露而是路径声明——
  与 0.8.8 修的「绕过文档模型导致文档卡在 modified 且 save 静默失败」是同一件事的
  正确做法：明说走哪条路。
- `externalReload` 的实现是 `pkg.Dispose()` + `Open()`，属于**同进程重开包**。
  它证明「内存设置经过一次重建后仍与磁盘一致」，**不等于跨编辑器重启的持久化**。
  考虑到 `folderAtlas` 已经实测过「内存写盘但重启不读回」，响应 `note` 明写这条边界。

### 验证梯子

editor 内存回读 → `pkg.Save()` + `App.project.Save()` → `package.xml` 的 `<publish>`
节点回读 → 可选 `externalReload`。**只断言调用方显式给过的字段**：新建的
`AtlasSettings` / `PackSettings` 其余字段取什么默认值真机未确认，替调用方补默认值
再去断言，就是断言一批没人知道真值的数字——真机上必炸，模拟宿主上反而假通过。
列表类字段（`atlasList` / `excludedList`）逐项比对：通用 `compareVerification` 走
`===`，数组按引用比，放进去必然不等。

`<publish>` 节点的属性编码**尚未在真机上钉死**（6.1.4 的 `package.xml` 里它默认是空的
`<publish name=""/>`），所以磁盘层**只回报原始结构与全部属性键值，不做等值断言**，
把事实原样交出来；真机确认真实编码后再收紧成断言。

### 与 0.8.12 的关系

这是 `analyze_atlas_fit` 的写侧配套。把 `useGlobalAtlasSettings` 置 `false` 并配好
`atlasList`，包级 `PackSettings` 才真正生效——0.8.12 之所以「包级路径真机无实例」，
就是因为隔离工程只有一个包且用的是全局设置。另外它是纠正既有错误归属的前提：
0.8.12 实测发现旧的大图常量在 `import_image` 时就把 `folderAtlas=alone` 写进了真实
工程的磁盘，只读分析能指出「谁该改」，改却要靠这个 Action。

### 验证边界

模拟宿主 170 项、Python 38 项、tsc 0 error 全过。**已在 FairyGUI Editor 6.1.4 真机复验**
（证据 `tests/reports/p8-5-write-live.json`），真机推翻了三处「看起来对」的实现假设：

1. **`AtlasSettings.packSettings` 是只读属性。** 声明写的是 `public packSettings : PackSettings`，
   运行时赋值抛 `Cannot assign to read only property`。只能取现有实例**就地改字段**，
   换不了整个对象。模拟宿主把它建模成普通可写字段，整条替换写法一路绿灯。
2. **`atlasList` 置空会让包此后每次保存都崩溃。** `FPackage.SavePublishSettings` 抛
   `Index was out of range`；写入阶段不报错，崩在 Save，所以**空列表在 validate 阶段就被
   拒绝**。清空图集设置只能用编辑器设置界面。
3. **`package.xml` 的 `<publish>` 只编码一部分字段。** 真实编码：
   `<publish name="" maxAtlasSize="2048" rotation="true" multiPage="false" maxAtlasIndex="0">
   <atlas name="Main" compression="true" index="0"/></publish>`。`maxWidth` 有编码但与
   `maxHeight` **共用同一个值**（写 2048/4096，重开后 maxHeight 回落成 2048）；`rotation`
   有编码；**`padding` 没有任何编码**——写 20，`Dispose`+`Open` 后回到默认值 2。
   为此响应新增 `persistenceProfile`（全表 `fieldProfiles` + 本次请求字段的落盘前景），
   `note` 直接点名留不住的字段，不让调用方只能靠 externalReload 失败才发现。

`new PackSettings()` 的真实默认值（真机读数，模拟宿主原先是假定的）：
`minWidth=16`、`minHeight=16`、`padding=2`、`pot=true`、`mof=true`、`multiPage=false`。
这正是「验证只断言调用方显式给过的键」这个设计决定的直接回报——当初若替用户补齐默认值
去断言，真机上必炸。

**0.8.12 的遗留空白已闭合**：写入 `useGlobalAtlasSettings=false` + `atlasList` 后，包级
`PackSettings` 在真机上真正参与判定（资源级 `atlas="alone"` 这类编辑器内建名正确报
`unknown` 而非猜测）。padding 与 square 两条分支真机触发，required 足迹精确体现
padding 每边 2 份的换算。

**仍未验证**：rotation「救回非正方形长条图」——sample 夹具图全为正方形，物理上无法体现
旋转收益（真机只验证到「旋转对正方形无效」这一面）；`minWidth`/`square`/`pot` 等字段非默认值
是否跨重开保留；跨编辑器**完整重启**的持久化（本轮以 `Dispose`+`Open` 覆盖）。

### 落盘前景（真机实测）

| 字段 | 状态 | 编码 |
| --- | --- | --- |
| `maxWidth` | persisted | `publish@maxAtlasSize`（与 maxHeight 共用） |
| `rotation` | persisted | `publish@rotation` |
| `multiPage` | persisted | `publish@multiPage` |
| `maxHeight` | losesValue | 无独立编码，重开回落到 maxWidth |
| `padding` | losesValue | 磁盘无对应属性，重开回默认 2 |
| `minWidth`/`minHeight`/`square`/`pot`/`mof`/`fast`/`edgePadding`/`duplicatePadding` | unverified | `<publish>` 无对应属性 |

要跨重启保留这些字段，只能在编辑器设置界面里改；Bridge 写了留不住。

## 0.8.15：Transition 只读校验（P8-3 首个切片）

### 行为

`fgui_verify_transition` 读取当前组件的全部或指定 Transition，逐条检查并返回结构化发现，
**不修改文档、不保存、不置脏**（`readOnly: true`，无 `save` / `verify` / `external_reload`）。
这是 P8-3 的只读切片；关键帧写侧 API 在 0.8.16 补齐（见下节）。

检查范围：

- **目标**：空 `targetId` 视为根组件；非空时按 ID 解析，找不到报 `target_missing`；
  用 `FTransition.GetAllowType` 校验轨道是否被该目标支持，不支持报 `target_type_unsupported`。
- **关键帧值**：Alpha / Color 分量 / Sound volume 必须在 `0..1`；Size 不得为负；
  Rotation 必须有限；Animation 帧必须是非负整数；Pivot 超出 `0..1` 记为 warning。
- **引用**：嵌套 Transition 名称必须存在（`nested_transition_missing`）；
  Sound URL 必须非空且解析到 `SOUND` 类型资源（`resource_missing`）。
- **Tween**：公共关键帧背后的合成端点缺失报 `tween_missing_endpoint`，
  端点配对异常报 `tween_endpoint_mismatch`，持续帧数非法报 `tween_invalid_duration`。
- **范围**（默认开启）：非百分比 XY 关键帧若落在 `[0, width] × [0, height]` 之外，
  报 **warning** `position_outside_canvas`——滑入/滑出动画本来就会把对象放到画布外。
  根组件与 `percent` 坐标跳过；`checkBounds:false` 整体跳过。
- **空 Transition** 报 warning `empty_transition`；`frameRate` 必须是 `1..255`。

`errors` 表示确定缺陷，`warnings` 表示可能合法、需要人工确认。汇总中
`summary.valid` 只由 error 决定，`summary.clean` 要求两者都为 0。校验器不调用
`describeTransition`，因此端点缺失的损坏 Tween 不会让整个校验抛错，而是作为 finding 返回。

### 验证状态

模拟宿主 189 项、Python 44 项、tsc 0 error。**已在 FairyGUI Editor 6.1.4 真机复验**
（证据 `tests/reports/p8-3-verify-transition-live.json`）：

- 夹具 `transFade` 校验 `valid=true` / `clean=true`，检查 2 个目标、4 个关键帧值、
  2 个 XY 范围，文档 `modified` 全程为 `false`。
- `--no-bounds` 生效：`checkBounds=false`，`bounds.checked=0`。
- 不存在的名称返回结构化 `target_not_found`（stage `editor`，退出码 1）。
- 临时未保存探针：Alpha `1.5` 报 `value_out_of_range` error，
  XY `(-100,-100)` 报 `position_outside_canvas` warning，`valid=false` / `clean=false`；
  随后 `undo` 恢复 `modified=false`、`transitionCount=1`。
- 全程未保存文档、未写 `package.xml`、未发布；探针的 `modified=true` 由 upsert 造成，
  不是 `verify_transition`。

## 0.8.14：图集归属改判（P8-5 判定侧）

### 行为

0.8.12 只把图集判定做成了只读分析，**写入路径仍在用硬编码尺寸常量**。本版本把
`import_image`（含同名替换）与 `publish` 前的归属施加换成与 `analyze_atlas_fit`
**同一个判定函数** `decideAtlasAssignment`，退役常量只留作诊断对照。

- 退役常量 `1920` / `1080` / `2048` 不再参与任何判定。响应里保留
  `retiredRuleWouldAssignAlone`，只为解释「磁盘上这个 alone 标记当初是怎么来的」。
- `import_image` 响应字段 `largeImageAtlasApplied`（布尔）改为 `atlasAssignment`
  （对象）：`verdict` / `applied` / `reason` / `fit` / `binding` / `constraintsSource` /
  `requiredWidth` / `requiredHeight` / `limitWidth` / `limitHeight` / `padding` /
  `square` / `rotation` / `folderAtlasOnDisk` / `folderAtlasInMemory`。
  **消费方需要同步改**：旧字段不会保留，免得两套字段各说各话。
- `publish` 响应字段 `largeImageAtlasRule` 改为 `atlasAssignment`，分三类回报：
  `assigned`（本次写入 alone 的）/ `aloneNotNeeded`（磁盘上已有 alone 但真实约束装得下，
  **只报不改**）/ `unknown`（约束不足以判定，不写盘），各带 `*Count`。

### 五条判定结论（`verdict`）

| verdict | 含义 | 是否写盘 |
| --- | --- | --- |
| `assign-alone` | 装不下，需要单独成图集 | 是 |
| `already-alone` | 装不下且磁盘上已是 alone | 否（幂等） |
| `alone-not-needed` | 装得下但磁盘上已标 alone | 否（**上报，待显式纠正**） |
| `leave-as-is` | 装得下且无标记，或不参与图集 | 否 |
| `unknown` | 无尺寸 / 无约束 / 上限未指定 / 图集未配置 | 否（拒绝下结论） |

### 三条必须知道的判定事实

- **归属一律以磁盘 `package.xml` 为准**。真机 6.1.4 实测：`folderAtlas` 写盘保留、
  重启后内存回到空串。旧实现的幂等守卫读内存值，所以重启后每次 `publish` 都会重复
  `SetChanged`；本版本改读磁盘，跨重启幂等。
- **判定时主动忽略 `alone` 标记本身**。`alone` 是编辑器内建名，不在用户配置的
  `atlasList` 里；拿它去解析约束只会得到「图集未配置」→ `unknown`，于是被标过的图
  在包级约束模式下永远判不出来，也就永远看不到可纠正的候选。
- **历史的多余标记无法自动清除，这条路已被真机证伪**。2026-10-19 活体探针实测
  （证据 `tests/reports/p8-5-atlas-marker-clear-probe.json`）：包中已存在的图片资源一旦
  带了 `atlas` 属性就**不可改**——对 `FPackageItem.folderAtlas` 赋空串、赋非空值都不影响
  落盘（getter 会立刻返回新值，磁盘纹丝不动），该属性只在资源**新建时**被写入一次。
  连带查出两个事实：不碰属性只 `Save()` 时标记原样幸存（说明它不是残留脏数据）；对本来
  没有属性的干净资源调 `SetChanged` 反而会往磁盘写进 `atlas=""` 噪声属性。
  纠正只剩两条路，都不适合放进默认路径：带外改 `package.xml`（编辑器保存时原样保留该属性，
  故带外修改能留存），或删除后重新导入（会换 item id、须重建引用）。故维持只上报。

### 验证状态

模拟宿主 176 项、Python 41 项、tsc 0 error。**已在 FairyGUI Editor 6.1.4 真机复验**
（证据 `tests/reports/p8-5-judgement-live.json`）：

- 导入 1920x1080 → `verdict=leave-as-is` / `applied=false`，磁盘**没有** `atlas` 属性；
  同一工程里同尺寸的 `AtlasFixture_HD` 却带着 `atlas="alone"` —— 同包同约束下的 A/B 对照。
- 导入 4096x4096 → `verdict=assign-alone` / `applied=true` / `binding=maxWidth`，
  磁盘真落 `atlas="alone"`。
- **完整重启编辑器**后同名替换 → `already-alone` / `applied=false`。重启后内存
  `folderAtlas` 确实回到空串（真机事实再次复现），幂等守卫生效，0.8.13 的重复施加缺陷闭合。
- publish → `assigned=0` / `aloneNotNeeded=1`（就是那张 1920x1080）/ `unknown=0`；
  产物里**没有** `Package1_atlas_pw9e9.png`，即未标 alone 的 1920x1080 进了共享图集。

真机还查出一处模拟宿主查不到的谎报：首版把 `wouldAssignAlone` 定义成
「本次是否写入」，导致**已正确标记**的 4096 图报 `disagrees=true`。已拆出独立的
`shouldBeAlone` 字段修正（`assign-alone` 与 `already-alone` 都为真）。

**未验证**：publish 路径的归属施加无模拟宿主覆盖（宿主未建模
`PublishHandler`），仅由真机证据支撑。

## 0.8.16：Transition 关键帧写入（P8-3 写侧）

### 行为

三个 Action 走编辑器时间轴与文档模型，均沿用 `save` → 磁盘 XML → `external_reload`
验证梯子，并进入 Agent 动画撤销栈（`fgui_undo` / `fgui_redo` 整步回退）：

- `fgui_add_keyframes`（`add_keyframes`）：一次创建多个关键帧。每个条目给
  `target_id` / `type` / `frame`，可选 `label` 与 `value`。**帧号必须由调用方显式给出**
  ——`CreateKeyFrame` 按播放头采样目标当前状态，自动推帧会让结果依赖采样时刻。
  批次内与既有轨道都在第一次写入前做冲突预检，重复帧直接拒绝。
- `fgui_set_keyframe`（`set_keyframe`）：按 `item_index`（公开关键帧序号）或
  `target_id`+`track_type`+`frame` 定位，修改 `frame` / `label` / `tween` / `ease` /
  `repeat` / `yoyo` / `value` / `endValue`。**按 `target_id/type/frame` 还能定位
  `get_transition` 隐藏的 Tween 合成端点**（返回 `item_index=null`、
  `syntheticEndpoint=true`）。`tween=true` 只能用于已处于 Tween 关系中的关键帧
  （Tween 起点，或插入已有 Tween 后形成的端点）；普通关键帧之间建立 Tween 请用
  `upsert_transition`。`endValue` 写的是 Tween 端点（下一个关键帧）的值。
  `tween=false` 与 `endValue` 互斥。
- `fgui_duplicate_transition`（`duplicate_transition`）：复制整条 Transition，
  可选 `new_name`。返回 `source` / `duplicate` 定义，`structureNormalized` 表示复制后
  的公开条目与源是否发生结构等价性差异（通常只在端点折叠上有差异）。

### 六条 6.1.4 运行时事实（活体探针，2026-10-20）

1. **`CreateKeyFrame(target,type)` 会采样目标在 `doc.head` 处的当前状态**并直接加入
   Transition；它之后**不能再调 `AddKeyFrame`**，否则同一轨道会多出重复条目。
2. **`AddKeyFrames(jsArray)` 不可用**（`invalid arguments ... striped by unity`），
   所以批量创建必须逐条 `CreateKeyFrame`。
3. **`SetKeyFrameValue` 不可用**：单参数/双参数/数组形式分别抛
   `Index was outside the bounds of the array` 与 `Double → String` 转换错误。
   值写入改用文档模型的类型化属性路径（与 `upsert_transition` 共用 `applyTransitionValue`）。
4. **`SetKeyFrameProperty(item,"tween",true)` 只对已处于 Tween 关系中的关键帧生效**：
   它能续接已有 Tween（把轨道重新链接为 `prev → item → next`），但对新轨道上两个
   普通关键帧不生效——编辑器不会凭空创建端点对象。Action 在写入前拒绝这类请求并
   提示改用 `upsert_transition`。`frame` / `label` / `easeType` / `easeInOutType` /
   `repeat` / `yoyo` 均可写。
   把关键帧插入已有 Tween 后，新帧会成为该 Tween 的**合成端点**并从 `get_transition`
   的公开列表消失（原端点变成普通关键帧）；用 `target_id/type/frame` 显式定位后可以
   改 `label` / `value`（写的是 Tween 端点值），但**不能靠 `tween=true` 把它续到下一个
   关键帧**：6.1.4 上 `SetKeyFrameProperty` 后该端点 `nextItem` 仍为 null，Action 报
   「没有可用的 Tween 端点」并整步回滚。要延长 Tween，用 `upsert_transition` 重建。
5. **`DuplicateTransition(name,newName)` 忽略第二个参数**：复制体名称为 `null`，
   必须再用 `SetTransitionProperty(copy,"name",...)` 改名；新名称与现有 Transition
   重名时在写入前拒绝。
6. **`encodedValue` 只对部分轨道安全**（XY 用 `"x,y"`、Color 用 `#RRGGBB`）；
   Text / Icon / Sound 轨道的编码值不保证可往返，写侧应使用类型化 `value`。
   读侧仍返回 `encoded` 供路径复用。

### 时间轴与播放头

三个 Action 都通过 `withTransitionTimeline` 执行：若当前未在目标 Transition 的时间轴，
临时进入；结束后**恢复用户原来的播放头与时间轴模式**（包括原本正在编辑另一条
Transition 的情况）。`add_keyframes` 会逐帧设置 `doc.head` 再创建，正是为了采样语义。

### 能力边界

- `TRANSITION_KEYFRAME_CAPABILITIES` 与 0.8.1 的条目级写操作、0.8.15 的只读校验
  分成三个独立集合：旧插件缺能力时能准确提示最低版本 `0.8.16`，不会误报成 0.8.1。
- 发布期间封锁：三个 Action 都列在 `actionsBlockedDuringPublish`。
- 验证范围仍只覆盖 `<transition>` 名称与公开条目数（与既有 Transition 写操作一致），
  不宣称属性级磁盘持久化；属性级确认用 `fgui_get_transition` 回读。
- 目标对象必须已存在且支持该轨道；`targetId` 为空表示根组件。值范围与引用合法性
  由 `fgui_verify_transition` 事后校验，写侧只做类型与结构校验。

### 验证状态

模拟宿主 212 项、Python 50 项、tsc 0 error。**已在 FairyGUI Editor 6.1.4 真机验收**
（证据 `tests/reports/p8-3-keyframes-live.json`，16 项检查全部通过）：

- `add_keyframes` 新建 Rotation@10（`strength:reload`）；`set_keyframe` 把同一帧
  10→12 并改标签/值，重开后保持。
- 向已有 Tween 插入 Alpha@10 后，该帧成为隐藏合成端点；按
  `targetId/type/frame` 定位返回 `itemIndex:null`、`syntheticEndpoint:true`，
  写 `label`/`value` 后 XML 为
  `<item tween="true" startValue="0" endValue="0.4" duration="10" label2="split2"/>`，
  `strength:reload`。
- `duplicate_transition` 复制 transFade→transCopy，`structureNormalized:false`，
  重开后两份都在（`strength:reload`）。
- 对合成端点 `tween=true` 被 6.1.4 拒绝（`editor_rejected`）并回滚；回滚重建
  Transition 后再次 `add_keyframes` 仍成功（真机复验 stale `editingTransition` 修复，
  itemCount 4→5），修复前该序列会「返回成功但条目不变」。
- 负路径全部按预期拒绝且不改文档：同轨同帧冲突、复制重名、普通轨道开 Tween、
  定位不存在的关键帧。
- 写后 `verify_transition` 两份均 `valid:true`、`clean:true`（error 0、warning 0）；
  完整退出并重启编辑器后从磁盘读回全部值与标签。
- 仓库 `sample/` 夹具 md5 验收前后未变，所有写入只发生在隔离副本。

## 0.8.17：图集 alone 标记带外纠正（P8-5 收尾）

### 为什么必须改 package.xml

0.8.14 起导入与发布已按真实约束判定归属，但**此前已经写进磁盘**的
`<image atlas="alone">` 仍然存在。6.1.4 活体探针
（`tests/reports/p8-5-atlas-marker-clear-probe.json`）证明编辑器没有可用的清除路径：

- `item.folderAtlas = ""` 在对象上看似生效，`Save()` 后 `package.xml` 的 `atlas`
  属性原样保留；`Dispose()` + 重开后又读回 `alone`。
- `set_publish_settings` 改的是图集配置，不碰资源级 `atlas` 属性。

所以唯一可行的路线是**带外编辑 `package.xml`**：删掉目标 `<image>` 节点上的
`atlas` 属性，再 `Dispose()` + `GetPackage().EnsureOpen()` 让编辑器从磁盘重建包对象。
若只改文件不重开，内存里的旧 XML 节点会在下一次保存时把属性写回来。

### 行为

`fgui_clear_atlas_markers`（`clear_atlas_markers`）：

- **默认只预览**：返回 `mode:"preview"`、逐项 `candidates` / `held` 与
  `summary.wouldClear`，`writePath:null`、`strength:"none"`，不写文档也不落盘。
- **只清 `alone-not-needed`**：目标必须同时满足「磁盘 `atlas="alone"`」与
  「`decideAtlasAssignment` 判定装得下」。`already-alone`（真实装不下）、
  `not-marked-alone`、`different-atlas`、`branch-scope-unsupported`、
  `not-atlasable` 都进 `held`，附带原因与约束来源，不改写。
- **可限定目标**：`item_ids` / `item_names` 支持按 id 或名称过滤；名称比较忽略扩展名
  （`hd` 与 `hd.png` 等价）。显式目标不存在报 `target_not_found`；一个名称匹配到多张图
  报 `invalid_argument`（附 `matches`），不会「顺手清掉两张」。
- **执行顺序**：预检打开文档 → `pkg.Save()`（先固定内存状态，备份才有意义）→
  重新读磁盘 XML 并复核目标仍是 `alone` → 备份到 `.agent/backups/` → 正则只删目标
  `<image>` 节点的 `atlas` 属性 → 回读全文比对 → 确认目标属性消失 → `Dispose` 重开包 →
  再次读盘统计剩余 `alone`。
- **打开文档策略**：包内只要有文档打开就拒绝执行；传 `close_open_documents=true`
  才由 Action 调 `docView.CloseDocuments(pkg)`，并在 `closedDocuments` 交代关了哪些。
  **未保存的文档永远拒绝**，即使传了该开关——带外改文件 + 重开包会丢改动。
  关闭后仍能查到打开文档、或编辑器未暴露 `FindDocument`，都按预检失败处理。
- **失败即停**：保存失败、备份失败、XML 预检发现重复 id / 节点缺失 / 属性值不是
  `alone`、写入失败、回读不一致，都返回结构化错误；除写入阶段外不会留下半修改。
  写入阶段失败时响应显式带 `mutationMayHaveOccurred:true` 与 `backupPath`。

### 语义边界

- 响应 `writePath: "out-of-band-xml"`、`undoable:false`、`strength:"disk"`。
  **不进 Agent 撤销栈，不能靠 undo 回退**；回退方式是把 `backupPath` 指回的备份覆盖回去
  后重开包。
- `persistence.crossRestartVerified:false` 是固定声明：本 Action 只证明磁盘回读与同进程
  重开包；跨完整重启的持久化由真机报告单独验证。
- 只处理 `IMAGE` 类型且 `supportAtlas !== false` 的资源；分支资源（`item.branch` 非空）
  一律不改，避免在分支语义不明时写错节点。
- 写入保留文件原有 BOM（用 `UTF8Encoding(true)` 写回），避免整文件因编码变化产生无意义 diff。
- 执行期间与其他写操作一样受发布封锁（`actionsBlockedDuringPublish`）。

### 验证状态

模拟宿主 224 项、Python 50 项、tsc 0 error。模拟宿主覆盖：只预览不写盘、只删目标属性并
保留装不下的标记、备份内容等于执行前、按名称/id 过滤、未知目标拒绝、同名多图拒绝、
打开文档拒绝与显式关闭、未保存文档始终拒绝、保存失败不落盘、无候选项空操作、
分支资源 held、无 BOM 文件不新增 BOM、有 BOM 文件不产生双 BOM。

**已在 FairyGUI Editor 6.1.4 真机验收**（证据 `tests/reports/p8-5-atlas-marker-clear-live.json`）：
预览仅列出 1920x1080 的 HD、Huge 保持 `already-alone`；文档打开时执行被拒且磁盘未变；
显式关闭文档后执行，`package.xml` 只少一个 `atlas` 属性、Huge 标记保留、备份与执行前
逐字节相同；`save-all` 后标记未被写回；完整退出并重启编辑器后 HD 仍无标记，
再预览 `wouldClear:0`。验收后仓库 `sample` 已恢复基线。

**未在真机触发**：分支资源、同名多图歧义、未保存文档拒绝、已有 BOM 的保留
（均由模拟宿主覆盖）；跨机/跨版本重启不在本轮范围。

## 0.8.18：分支能力（P8-6）

### 行为

- `fgui_list_branches`：`refresh` 重新扫描磁盘分支，`include_packages` / `include_items`
  附带分支内的包与资源。只读，不切换分支、不唤醒编辑器文档。
- 只读视图允许跨分支：`list_items` / `open_document` / `get_tree` 的 `branch` 可以指向
  非活跃分支，不必先切换。包资源写入仍要求 `branch` 与活跃分支一致。
- 6.1.4 的 `pkg.items` 会包含分支根与分支资源；`list_items` 的主干视图必须把它们滤掉，
  否则主干列表会混入另外两个分支的条目（真机实测 18 项 vs 真实主干 10 项）。
- `fgui_create_branch`：工程原生创建分支，默认留在当前分支，`switch_to=true` 创建后立即切换。
- `fgui_switch_branch`：切换 `FProject.activeBranch`；空名称表示切回主干。
- 读写都接受 `branch` 参数，省略时跟随当前活跃分支（`get_tree` 读取当前文档），
  `branch=""` 明确表示主干。只读视图（`list_items` / `open_document` / `get_tree`）
  可以显式读取非活跃分支，不必先切换；包资源写入要求 `branch` 与活跃分支一致，否则拒绝。
- 分支清单为 `assets_<branch>/<pkg>/package_branch.xml`，写验证比对这份清单；
  分支资源不会出现在主干 `package.xml`。

### 6.1.4 运行时事实（活体探针 + 真机）

- 创建分支资源时，`CreateComponentItem` / `CreateFolder` / `ImportResource` /
  `CreateMovieClipItem` 的路径必须是 `/:branch/` 或 `/:branch/Sub/`，
  末尾斜杠不可省略；`GetItemByPath` 无法解析分支路径，分支内资源要用
  `GetBranchRootItem` + `GetItemListing` / `GetItemByName` 定位。
- `activeBranch` 决定分支地址下的默认写入目标，但**不会重定向主干文档的保存**：
  分支内文档要求该分支是活跃分支，否则 `branch_mismatch` 拒绝；主干文档在分支活跃时
  也拒绝保存，必须显式切回主干。
- 分支资源落在 `assets_<branch>/<pkg>/`，分支清单是 `package_branch.xml`；
  同名资源在两个分支中互不覆盖，分支视图会遮蔽同名的主干资源。
- `FindItemByName` 在活跃分支下会命中分支资源。显式 `branch=""` 必须绕过该解析、
  按 `item.branch` 过滤回主干，否则「明确要求主干」会静默打开另一分支的同名文档
  （0.8.18 已改为 `resolveTrunkItem`，真机负路径验证）。
- `activeBranch` 不跨编辑器重启保留：重启后回到主干，但分支目录、资源与清单仍在磁盘上。
- `replace_references` 与 `clear_atlas_markers` 是主干专用；分支活跃时调用直接拒绝，
  避免把跨包引用或带外 XML 批量写到错误的分支视图。

### 语义边界

- `create_branch` / `switch_branch` 走工程原生 API，响应 `writePath:"project-native"`、
  `undoable:false`、`strength:"disk"`；不进 Agent 撤销栈，创建的分支只能用编辑器删除。
- `create_branch` 与 `switch_branch` 在 `save_open_documents=true` 时会先保存全部打开文档；
  默认不保存。切换前若存在未保存文档，切换会拒绝而不是静默丢弃。
- 分支内文档的持久化验证与主干一致，支持 `save` / `verify` / `external_reload`；
  `external_reload` 为关闭重开文档，能证明分支 XML 的真实落盘。
- 资源导入、组件创建等包资源写操作的分支寻址与图集归属判定（0.8.14）共用同一套
  磁盘清单读取逻辑；分支里的图片同样按真实 `PackSettings` 判定 `alone`。

### 验证状态

模拟宿主 230 项、Python 54 项、tsc 0 error。模拟宿主覆盖：分支根目录与清单创建、
分支组件写入只进 `package_branch.xml`、分支视图遮蔽同名主干资源、主干视图不混入分支条目、
跨分支只读、分支/主干文档作用域不匹配拒绝、切回主干后写入恢复。

**已在 FairyGUI Editor 6.1.4 真机验收**（证据 `tests/reports/p8-6-branches-live.json`）：
在隔离工程副本中创建分支 `de` 与 `qa`，分别导入图片、创建分支组件并写入分支文档；
`de/BranchComp` 根宽度 421、`qa/BranchCompQA` 根宽度 360，均在 `external_reload` 级别验证通过，
落盘到各自 `assets_<branch>/Package1/` 与 `package_branch.xml`。完整退出并重启编辑器后
两个分支的目录、资源、清单与宽度均保持，`activeBranch` 回到主干；主干 `items` 只含 10 项主干资源，
在 `qa` 活跃时仍可只读主干视图（10 项），分支视图为 12 项。省略 `branch` 时读取跟随活跃分支
（de 视图 14 项 / qa 视图 12 项），`branch=""` 明确返回主干（10 项）；de 活跃时
`open(BranchComp, branch="")` 按预期 `target_not_found`，不会误开 de 文档；文档有未保存修改时
`switch_branch` 返回 `invalid_argument`（`unsavedDocuments:true`），`discard` 后才允许切换。
仓库 `sample/` 验收前后未变。

## 0.8.19：只读资源审计（P8-7 首个切片）

### 行为

- `fgui_find_unused`（`find_unused`）：遍历工程内的资源，对每个资源调用
  `DependencyQuery.QueryReferences`，引用数为 0 即视为「当前工程内未使用」。
  返回 `unusedCount`、`exportedUnusedCount`、`candidateCount`、`scannedCount`、
  `errorCount` 与逐项明细；图片附带真实尺寸（`AssetSizeUtil.GetSize`）。
- `fgui_find_duplicate`（`find_duplicate`）：用 `BuilderUtil.GetMD5HashFromFile`
  计算每个资源文件的 MD5，以 `MD5 + 字节数` 为键分组，组内至少 2 项才算重复。
  返回 `duplicateGroupCount`、`duplicateItemCount`、`wastedBytes`，组按浪费体积降序；
  每组的 `wastedBytes = fileBytes × (itemCount - 1)`。
- 范围：`packages` 接受包名或包 ID，省略时扫描全工程；`types` 可按 `image` /
  `font` / `sound` / `movieclip` / `component` 过滤，大小写不敏感，也接受逗号分隔字符串。
- 分支：`includeBranches` 默认 `true`。6.1.4 的 `pkg.items` 本身就会列出分支资源，
  分支根的 `GetItemListing` 也会返回同一批条目；枚举时按 URL 去重，所以不会重复计数。
  `include_branches=false` 会显式过滤 `item.branch` 非空的条目，只看主干。
- 截断：`find_unused` 的 `maxItems` 与 `find_duplicate` 的 `maxGroups` /
  `maxItemsPerGroup` 只限制返回明细，`unusedCount` / `duplicateGroupCount` /
  `wastedBytes` 等计数始终是完整统计；截断时对应 `truncated:true`。
- 只读：两个 Action 都返回 `readOnly:true`，不保存、不置脏、不修改引用图或磁盘，
  也没有 `save` / `external_reload` 参数，不进入发布期间的写操作封锁表。

### 6.1.4 运行时事实（活体探针 + 真机）

- 编辑器原生的 `FindUnusedResource.Start`、`FindDuplicateResource.Start`、
  `FullSearch.Start` 都需要 Pro 授权。非 Pro 环境会弹出模态授权框，插件请求会一直等不到
  返回（真机上表现为心跳继续但请求超时）。因此 Bridge **不暴露**这些原生入口。
- 免授权替代路径已实测可用：`DependencyQuery.QueryReferences` 提供引用计数；
  `BuilderUtil.GetMD5HashFromFile` 读取文件内容哈希；`AssetSizeUtil.GetSize` 返回图片
  宽高、类型、位深与颜色类型。三者组合出的结果与原生审计语义一致，但不会触发授权框。
- `BuilderUtil.GetMD5HashFromFile` 对不可读文件会抛错，单条失败计入 `errors` 与
  `unreadableCount`，不会让整次审计失败；`errorCount` 是真实总数，`errors` 最多保留
  20 条样本。
- 未使用是「当前工程引用图」口径：运行时按 URL 动态加载、或通过字符串拼接访问的资源
  不会被引用图统计。因此导出资源默认仍列出并标记 `exported`，删除前必须人工确认。

### 语义边界

- 两个 Action 只做分析，不提供删除、移动或自动清理；也不会替你判断某个导出资源是否
  真的安全。它们回答的是「现在有没有引用」和「文件内容是否重复」。
- 重复判定按文件内容，不按资源名或尺寸；同名不同内容不会误报，不同名相同内容会被找出。
- MD5 用于工程内查重足够，但不作为密码学强度承诺；分组同时要求字节数一致。

### 验证状态

模拟宿主 239 项、Python 58 项、tsc 0 error。模拟宿主覆盖：零引用判定、引用图不被改写、
`skipExported`、包/类型过滤、分支枚举与 `--no-branches` 过滤、明细截断、重复分组与
`wastedBytes`、不可读文件错误上报、非法上限拒绝。

**已在 FairyGUI Editor 6.1.4 真机验收**（证据 `tests/reports/p8-7-audit-live.json`）：
在隔离副本中导入两张与 `Red` 完全相同的图片、创建一个空组件后，
`find_unused` 扫描 13 项、列出 10 个零引用资源（其中 7 个导出资源）；
`find_duplicate` 得到 2 组、5 项重复、可回收 434 字节——`Red` / `AuditDupA` / `AuditDupB`
按 184 字节成组，`Component1` / `AuditOrphanComp` 按 66 字节成组。5 次审计调用前后
`package.xml` 的 SHA-256 完全一致，响应 `readOnly:true`。

**未在真机触发**：分支资源审计（示例工程没有分支，由模拟宿主覆盖）、大工程耗时上限、
运行时动态加载导致的「假未使用」（属于口径边界，不宣称能消除）。
