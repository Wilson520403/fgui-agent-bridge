# 使用参考

返回 [README](../README.md)。CLI 完整参数见 `uv run fgui-agent --help`；MCP 参数以客户端工具 schema 为准。

## MCP 工具一览

共 74 个工具，按用途分组：

| 类别 | 工具名称 | 功能描述 |
| :--- | :--- | :--- |
| **连接与定位** | `fgui_status`、`fgui_ping`、`fgui_use_project`、`fgui_get_project`、`fgui_list_packages`、`fgui_list_items` | 检查连接状态、切换工程、查看包列表与包内资源（`fgui_list_items` 可指定 `branch`） |
| **分支** | `fgui_list_branches`、`fgui_create_branch`、`fgui_switch_branch` | 列出、创建和切换工程分支，切换后读写都会落在对应分支 |
| **文档与对象** | `fgui_open_document`、`fgui_get_active_document`、`fgui_get_tree`、`fgui_select_object`、`fgui_insert_object`、`fgui_insert_text`、`fgui_insert_loader`、`fgui_insert_list`、`fgui_set_property`、`fgui_set_instance_override`、`fgui_remove_object` | 打开组件、查看对象树、选中元件、修改属性及增删显示对象；`fgui_insert_text` 创建文本对象（0.8.20+）；`fgui_set_instance_override` 写实例的扩展级 override（0.8.21+） |
| **分组、复制与层级** | `fgui_create_group`、`fgui_duplicate_object`、`fgui_adjust_depth` | 将对象组成组、复制显示对象、调整绝对层级（0.8.24+） |
| **资源创建/导入** | `fgui_create_component`、`fgui_create_button`、`fgui_import_image`、`fgui_import_font`、`fgui_import_sound` | 新建组件/按钮，从本地绝对路径导入图片、字体与声音；`fgui_import_image` 支持 `max_size` 按长边等比缩放后入库（0.8.23+） |
| **包资源管理** | `fgui_delete_package_item`、`fgui_rename_package_item`、`fgui_move_package_item`、`fgui_duplicate_package_item` | 删除/改名/移动/复制包内资源（0.8.22+），删除前会检查引用 |
| **MovieClip 序列帧** | `fgui_create_movieclip`、`fgui_get_movieclip`、`fgui_update_movieclip`、`fgui_remove_movieclip` | 从本地图片序列创建或更新序列帧动画（帧直接嵌入 `.jta`） |
| **Transition 动效** | `fgui_list_transitions`、`fgui_get_transition`、`fgui_verify_transition`、`fgui_upsert_transition`、`fgui_remove_transition`、`fgui_add_transition_item`、`fgui_update_transition_item`、`fgui_remove_transition_item`、`fgui_add_keyframes`、`fgui_set_keyframe`、`fgui_duplicate_transition` | 读取与校验动效，声明式增改整段动效，原子化修改条目或关键帧，复制整条 Transition |
| **动画预览** | `fgui_preview_animation` | 在编辑器中实时播放、暂停、停止、跳帧预览 Transition 或 MovieClip |
| **保存与事务** | `fgui_get_history`、`fgui_undo`、`fgui_redo`、`fgui_save_document`、`fgui_save_all`、`fgui_discard_document` | 撤销/重做、保存文档或放弃未保存修改 |
| **验证与资源引用** | `fgui_verify_document`、`fgui_replace_object_resource`（0.8.21+ 也可换组件实例的源组件）、`fgui_replace_references`、`fgui_query_references`、`fgui_query_dependencies`、`fgui_get_text_style`、`fgui_set_text_style` | 比对预期属性或整个对象树、替换资源引用、查询引用图、读写文本样式（0.8.20+ 支持 `bold`/`italic`/`underline`/`strokeSize`/`strokeColor`/`shadowX`/`shadowY`/`shadowColor`） |
| **冗余资源** | `fgui_find_unused`、`fgui_find_duplicate` | 找出没有被引用的资源，以及内容完全重复的文件（只读） |
| **布局与控制器** | `fgui_set_list_layout`、`fgui_set_group_layout`、`fgui_set_relation`、`fgui_set_gear_display`、`fgui_list_controllers`、`fgui_set_controller` | 修改 List/Group 布局、替换 Relation 绑定、设置 gearDisplay 联动、增删改 Controller |
| **图集与发布** | `fgui_get_publish_settings`、`fgui_set_publish_settings`、`fgui_analyze_atlas_fit`、`fgui_clear_atlas_markers`、`fgui_publish` | 查询或修改发布设置、判断图片能否放进图集、修正图集标记、执行资源发布 |

---

## 使用说明与注意事项

### 写入、验证与撤销

大多数写操作支持 `save`、`verify` 和 `external_reload` 三个选项（新建组件、删除组件等少数操作不支持 `external_reload`）：

- `save`：执行后立即保存文档。
- `verify`：重新读取对象树，并按需比对磁盘 XML。
- `external_reload`：重新加载文档或资源后再比对，是最强的持久化验证（需要同时设置 `save=true`）。

响应里的 `persisted` 和 `strength`（`reload` / `disk` / `none`）会告诉你验证到了哪一层。

属性修改和 Transition 编辑会进入 Agent 撤销栈，可以用 `fgui_undo` / `fgui_redo` 回退。结构创建、删除和资源导入不属于可逆操作；`discard` 只放弃当前文档未保存的修改，不能替代 `undo` 或 `save`。

### 创建 List 和 Loader（0.8.25+）

`fgui_insert_loader` 和 `fgui_insert_list` 在当前文档根组件下创建对象。创建前须退出时间轴与组内编辑模式。

- Loader 的 `url` 可留空，或使用工程内图片/MovieClip 的 `ui://` URL。支持位置、尺寸、对齐、`shrink_only` 和六种填充：`none`、`scale`、`scaleMatchHeight`、`scaleMatchWidth`、`scaleFree`、`scaleNoBorder`。固定 `autoSize=false`，以保留给定尺寸；不接受外部 URL、组件资源和 Loader3D。
- List 的 `layout` 支持 `single_column`、`single_row`、`flow_horizontal`、`flow_vertical`、`pagination`。还可设置整数 `line_gap/column_gap`、`selection_mode`、`auto_item_size`、`align/v_align` 及 `overflow`（visible/hidden/scroll）。
- `default_item` 引用组件资源。`items` 是最多 1000 项的对象数组，每项支持 `url/title/icon/name/selectedTitle/selectedIcon`；省略 `url` 时使用默认组件。`icon/selectedIcon` 只接受图片 URL。不设默认组件时，每项必须提供组件 URL；空 List 可以不设默认组件。条目文案和图标的可见效果取决于模板组件是否提供相应 Button/Label 扩展。
- `x/y/width/height` 向零截断，精度损失在 `rounded` 回报；截断后尺寸须大于 0。名称由编辑器最终决定，`inserted.nameAdjusted` 表示编辑器是否调整了请求名称。
- 默认不保存、不进入 Agent 撤销栈；未保存可 `discard`。`save` 保存整个当前文档，`external_reload` 需要同时开启保存和验证。验证覆盖几何、资源、布局、条目数量、有效 URL 和覆盖字段；默认 XML 属性也会比对，不按缺失跳过。
- 非法参数在创建前拒绝。编辑器应用属性失败时，Bridge 尝试移除刚创建的节点，并用 `rolledBack` 报告结果；保存或持久化验证失败不自动回滚。操作恢复原选择集，关闭重开会重建文档选择状态。

```bash
uv run fgui-agent --project /PATH/TO/PROJECT insert-loader --name cover --width 180 --height 90 --fill scale
uv run fgui-agent --project /PATH/TO/PROJECT insert-list --default-item ui://PACKAGE_ID_COMPONENT_ID --items '[{"title":"One"},{"title":"Two"}]' --save --external-reload
```

### 分组、复制与层级（0.8.24+）

- `fgui_create_group(targets, name?)`：至少两个目标，每项用 `id`、`path` 或唯一 `name` 定位。成员按原显示列表顺序移到末尾，新组追加在成员之后。
- `fgui_duplicate_object(target, name?, dx=0, dy=0)`：复制显示对象，生成新 ID 并追加到末尾。保留节点序列化内容（文字样式、资源引用、Relation、Gear、实例扩展覆盖和 List 条目）；`dx/dy` 相对源坐标偏移，默认原位，最终坐标向零截断并回报 `rounded`。组件内的 Transition 属文档级内容，不随单个对象复制。
- `fgui_adjust_depth(target, index)`：移到零基绝对层级，`0` 为最底层。返回 `orderBefore` / `orderAfter`，索引不能越界或落入已有分组块。
- 三者首版均只接受**根组件下未锁定、未分组的普通对象**。组、组成员、根节点和嵌套组件内部对象会被拒绝；操作前须退出时间轴和组内编辑模式。
- 默认仅修改内存，支持 `save` / `verify` / `external_reload`。`save` 保存整个当前文档；验证覆盖显示顺序、名称、组成员归属，复制还比对完整节点序列化内容。`external_reload` 需 `save=true`，关闭重开后再次比对。
- 不进 Agent 撤销栈（`undoable:false`）；失败不自动回滚，未保存时可用 `discard` 放弃当前文档全部未保存修改。操作恢复原选择集和可读取的编辑器剪贴板槽位；关闭重开会重建文档选择状态。

```bash
uv run fgui-agent --project /PATH/TO/PROJECT create-group '[{"id":"n1"},{"id":"n2"}]' --name Header --save --external-reload
uv run fgui-agent --project /PATH/TO/PROJECT duplicate-object --id n3 --new-name Copy --dx 20 --save --external-reload
uv run fgui-agent --project /PATH/TO/PROJECT adjust-depth --id n3 0 --save --external-reload
```

### 包资源管理（0.8.22+）

`fgui_delete_package_item`、`fgui_rename_package_item`、`fgui_move_package_item`、`fgui_duplicate_package_item`
把「关掉编辑器、手改 `package.xml`、删 XML 文件」这类带外操作收进 Bridge。

- **立即落盘**：调用返回后 `package.xml` 与磁盘文件已是新状态；**不进 Agent 撤销栈**，失败不自动回滚。
- **删除前会检查引用**：仍被引用的资源会被挡住；确认要删传 `allow_dangling_references=True`，响应里的 `danglingReferences` 列出所有会变悬空的位置，含尚未落盘的引用。
- **改名/移动不更新引用方的 `fileName` 属性**：资源 id 不变、运行时不受影响；响应里的 `staleFileNameSlots` 列出待补齐的位置，让相关文档在编辑器里重新保存一次即可。
- **目标目录不存在时自动创建**：`create_folders=True`（默认），响应里的 `folderCreated` 回报是否新建。
- **改名/移动允许文档开着**；**删除要求目标文档先关闭**（文档开着时默认拒绝，`close_open_documents=True` 可让 Bridge 代为关闭，未保存改动一律拒绝）。

### 坐标与尺寸的整数语义（0.8.23+）

- FairyGUI 只存整数：`x`/`y`/`width`/`height` 落盘时**向零截断**（`50.5`→`50`、`-10.5`→`-10`），组件根尺寸更早一步就被截断。
- Bridge 写入前做同一套截断，响应里的 `rounded` 列出每一处精度损失（`[{property, from, to}]`），没有损失时不会出现该字段。
- `scale`、`rotation`、`pivot`、`alpha` 是真浮点，保留小数。
- 几何写入入口：`fgui_set_property`、`fgui_insert_object`、`fgui_insert_text`、`fgui_insert_loader`、`fgui_insert_list`、`fgui_set_text_style`、`fgui_create_component`、`fgui_create_button`，以及 `fgui_duplicate_object` 的最终坐标。

### 编辑器侧的两个老坑

- **`scale` 只保留 3 位小数**：编辑器把缩放写成 `scale="0.333"`，写 `scaleX=0.3333` 会「写成功但过不了落盘比对」（报「验证失败：xml」）。
- **工程里没有字体资源时别新增文本节点**：编辑器会抛 `NullReferenceException` 停摆主循环，桥接随即失联（请求一直没人认领），空文本也一样。

### 导入大图前先缩放（0.8.23+）

- `fgui_import_image` 的可选 `max_size`（长边上限，像素；CLI 是 `--max-size`）：源图长边超过它就先等比缩放再入库，alpha 通道保留，响应里的 `scaled` 回报缩放前后尺寸与比例。
- 响应里的 `atlasPrecheck` 是**入库前**的图集前置判定，分 `original`（原图尺寸）与 `effective`（入库尺寸）两段，`fit` 取 `fits` / `exceeds` / `unknown`；`unknown` 表示约束不足，需要人工确认。
- 缩放发生在入库之前：图集归属按入库后的像素尺寸判定，缩放后装得下的图不会再被标成单独图集。

### 同一个组件、不同实例（扩展级 override）

- `fgui_set_instance_override` 让同一个组件在不同实例上显示不同的文案与样式：Button 扩展可写 `title`（`text` 是别名）、`icon`、`selectedTitle`、`selectedIcon`、`titleColor`、`titleFontSize`；Label 扩展可写 `title`、`icon`、`titleColor`、`titleFontSize`。落盘形态是实例节点里的扩展子节点 `<Button title="..."/>`。
- **只有扩展级这一层可用**。改实例内部的普通子对象（普通 `<text>`、`<image>`）在 FairyGUI Editor 6.1.4 上做不到：编辑器不产出这种节点，运行时也不消费，Bridge 会在写入前直接拒绝。这类需求请用 `fgui_insert_text` 直接建对象，或把样式固化成组件类型。
- 颜色只接受 `#RRGGBB` 六位（编辑器落盘会丢掉 alpha，带 alpha 的输入会被拒绝）；`titleColor` / `titleFontSize` 是「开关 + 参数」结构，Bridge 会自动打开对应开关。
- 源组件没有扩展（例如普通组件实例）时会被拒绝，不会静默无效。

### 换掉一个组件实例

- `fgui_replace_object_resource` 除了 Image/Loader，**0.8.21 起也支持把组件实例换成另一个组件**——此前「把白色文本组件换成深灰文本组件」只能删掉重插，还要手算插入位置。
- 实例的 `id`、`name`、位置、relation 绑定和**显式写死的尺寸**都会保留；实例上的扩展覆盖（`<Button title="..."/>`）也会跟着留下来。换成没有扩展的源组件时，编辑器会自己丢弃用不上的覆盖。
- 实例**没有**显式写死尺寸时，尺寸会跟随新源组件——这是 FairyGUI 本来的语义。响应里的 `layout` 会报出替换前后的位置与尺寸，尺寸变了能立刻看出来。
- 根组件是组件定义本身，不是实例，不能被替换。

### 查找冗余资源

- `fgui_find_unused` 会沿着引用关系，找出工程里没有被任何地方引用的资源，返回包名、路径、大小，图片还带尺寸。导出资源默认也会列出来并标记 `exported=true`，因为运行时可能按 URL 直接加载它们；确认不需要后，可以用 `skip_exported=true` 把它们排除。
- `fgui_find_duplicate` 按文件内容分组，找出完全相同的图片、字体、音效和组件 XML，并按浪费的空间从大到小排序，方便优先清理大头。同名但内容不同不算重复。
- 两个工具都是只读的，不会改动或保存工程。可以用 `packages` / `types` 缩小范围，传 `include_branches=false` 只看主干。编辑器自带的同类功能需要 Pro 授权，Bridge 的实现不依赖它，装好就能用。

### 改资源引用之前

- `fgui_query_references` 查「谁引用了这个资源」，`fgui_query_dependencies` 查「这个资源依赖了谁」。两者都是只读的，不会修改文档。
- 单个对象换图用 `fgui_replace_object_resource`，支持 Image 和 Loader，可撤销、可验证。Button 的状态图替换不在支持范围内。
- 全工程批量换图用 `fgui_replace_references`。它**默认只预览**，确认 `totalCount` 和明细后再传 `execute=True`。执行后立即落盘、不进入 Agent 撤销栈，调用前请确认这是你想要的。替换完成后建议按引用图再查一次，确认源资源的残留引用为 0。

### 分支

- 用 `fgui_list_branches` 查看现有分支，`fgui_create_branch` 新建，`fgui_switch_branch` 切换（传空名称回到主干）。创建和切换都会立即写入磁盘、不能撤销；默认不处理已打开的文档，需要时传 `save_open_documents=true`。
- 读写工具省略 `branch` 时跟随当前活跃分支，传 `branch=""` 明确表示主干。支持 `branch` 的读取工具可以直接指向任意分支，写入则要求目标分支正处于活跃状态，避免改动落到错误的地方。分支资源放在 `assets_<branch>/<包名>/` 下，不会混进主干的 `package.xml`。
- 在 FairyGUI 6.1.4 上，保存仍然跟着文档本身：分支文档需要对应分支活跃时才能保存，主干文档在分支活跃时也会拒绝保存。切换前先保存并关闭文档，可以少走弯路。`fgui_replace_references` 和 `fgui_clear_atlas_markers` 只支持主干，分支活跃时会被拒绝。
- 重启编辑器后会回到主干，但分支内容都还在磁盘上，用 `fgui_switch_branch` 切回去就能继续。

### 动效

- Transition 覆盖全部 FairyGUI 原生轨道，时间单位是帧。`fgui_upsert_transition` 适合声明式地创建或整段替换动效；`fgui_add_keyframes`、`fgui_set_keyframe` 适合局部调整关键帧。
- `fgui_verify_transition` 是只读检查：它会验证目标对象、轨道兼容性、关键帧取值范围、嵌套 Transition / Sound 引用、Tween 端点和画面范围。`errors` 表示确定有问题，`warnings` 则可能是设计意图（例如滑入/滑出动画里坐标超出画布）。校验不会修改文档，也不会把文档标记为已修改。
- 关键帧的 `tween=true` 只能续接已经处于 Tween 关系中的帧。要在两个普通关键帧之间建立 Tween，或者延长已有 Tween，请用 `fgui_upsert_transition` 重建。
- `fgui_preview_animation` 只影响编辑器里的预览状态，不会保存为资源属性。
- MovieClip 的帧会直接嵌入 `.jta`，不会在包内生成散图资源。删除 MovieClip 需要显式传 `force=true`，并且会先检查引用；全新创建和删除无法撤销。

### 图集与发布

- `fgui_analyze_atlas_fit` 按图集打包器的真实约束（包级 `PackSettings` 或全局 `AtlasSetting`）判断每张图能否放进图集，不再依赖猜测。`fit=unknown` 表示约束信息不足，不代表通过。`summary.assignedAloneButFits` 可以帮你发现磁盘上被标成 `alone`、但实际装得下的图片。
- `fgui_import_image` 和 `fgui_publish` 使用与 `fgui_analyze_atlas_fit` 相同的判定逻辑，所以「分析说装得下、导入却标了 alone」不会发生。执行结果会放在 `atlasAssignment` 里，说明这次是写入了标记、已有标记无需重复写入，还是因为约束不足没有下结论。
- 包内已有图片的 `atlas` 标记没法通过编辑器 API 改掉。分析报出 `alone-not-needed` 时，可以用 `fgui_clear_atlas_markers` 修正：它默认只预览，确认后再执行。这个工具会直接写 `package.xml`，执行前自动备份，写入后重新加载包检查结果；该操作不可撤销，执行前请先关闭这些包里的文档（或允许 Bridge 代为关闭已保存的文档）。
- `fgui_set_publish_settings` 修改包级发布与图集设置。它只写你显式提供的字段，`atlasList` 是全量替换语义；`atlasList` 不能传空数组（FairyGUI 6.1.4 会报错并影响该包后续保存）；`padding`、`square` 等部分 `packSettings` 字段无法跨编辑器重启保留，这类设置建议直接在编辑器界面里改。
- 发布期间 Bridge 会封锁大部分写操作。发布前先调 `fgui_get_publish_settings` 确认输出目录与图集配置，发布后检查返回的文件变更清单。

### 连接与运行时

- 使用时 FairyGUI Editor 必须保持运行并打开目标工程。
- `.agent/` 是工程内的运行时队列与日志，不属于安装文件，不要提交到 Git。
- 插件会忽略超过 60 秒未被认领的请求，并在启动时清理残留队列。客户端超时并不代表操作没有执行，重试前请先用 `fgui_status` 或 `fgui_get_active_document` 确认当前状态，避免重复写入。
- 图片、字体、声音和 MovieClip 的导入路径必须是绝对路径。导入和替换都是磁盘写入，不受 `discard` 影响。

---
