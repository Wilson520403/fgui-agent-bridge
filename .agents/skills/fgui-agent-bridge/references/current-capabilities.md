# Agent Bridge 当前能力参考

> 这是 独立 `fgui-agent-bridge` 仓库在 2026-07-31 的能力快照。功能变动时必须同步本文件，并以源码实际签名为最终依据。

## 版本与通道

- Bridge 版本：`0.6.0`
- FairyGUI 插件 ID：`com.fgui.agent-bridge`
- 代码真源：独立公开仓库；业务工程只安装插件与 Skill 快照
- 队列协议：`1.0`
- FairyGUI Editor 验证版本：`6.1.4`
- MCP 工具数：24，其中 22 个对应 Bridge Action，`fgui_status` 和 `fgui_use_project` 为 Python 本地能力
- 传输：MCP stdio；底层为目标工程 `.agent/` 下的本地 JSON 文件队列
- 运行时目录：`.agent/requests`、`.agent/processing`、`.agent/responses`、`.agent/status.json`、`.agent/bridge.log`
- `.agent/` 是运行时数据，不纳入 Git

## MCP 工具签名

以下签名以 `src/fairygui_agent/mcp_server.py` 为准；工具参数使用 Python snake_case，桥接请求内部映射为 camelCase。

| 工具 | 主要参数 | 用途 |
| --- | --- | --- |
| `fgui_status` | 无 | 读取本地工程选择、在线状态与心跳年龄，不主动唤醒编辑器 |
| `fgui_ping` | 无 | 唤醒/验证编辑器并检查版本、协议和 capability |
| `fgui_use_project` | `project_path` | 选择 `.fairy`、FairyGUI 工程目录或仓库目录 |
| `fgui_get_project` | 无 | 读取工程基本信息 |
| `fgui_list_packages` | 无 | 列出工程包 |
| `fgui_list_items` | `package_name`, `item_type?` | 列出包内资源，可按类型过滤 |
| `fgui_open_document` | `package_name`, `item_name` | 打开已有组件文档 |
| `fgui_create_component` | `package_name`, `component_name`, `width=800`, `height=600`, `folder_path=''`, `extension_id?`, `exported=True`, `auto_rename=False`, `create_folders=True`, `open_after_create=True` | 新建组件资源并可立即打开；不自动保存 |
| `fgui_import_image` | `package_name`, `source_path`, `folder_path=''`, `resource_name?`, `conflict_policy='error'`, `exported=True`, `create_folders=True`, `timeout_seconds=120` | 从绝对本地路径导入图片；支持 `error/auto_rename/replace` |
| `fgui_create_button` | `package_name`, `button_name`, `width=160`, `height=60`, `folder_path=''`, `mode='common'`, `image_urls?`, `create_text=True`, `create_icon=True`, `create_relations=True`, `as_list_item=False`, `exported=True`, `auto_rename=False`, `create_folders=True`, `open_after_create=True`, `extension_id?` | 创建 Common/Check/Radio 标准 Button 组件 |
| `fgui_get_active_document` | 无 | 读取活动文档、修改状态和选择数量 |
| `fgui_get_tree` | `max_depth=12` | 读取对象树、ID、路径和常用属性 |
| `fgui_get_history` | 无 | 读取 Agent 属性事务栈与 FairyGUI 原生撤销状态 |
| `fgui_select_object` | 对象 ID、路径、唯一名称三选一 | 选择对象 |
| `fgui_set_property` | `property_name`, `value`, 目标三选一 | 修改白名单属性并进入 Agent 属性事务栈 |
| `fgui_insert_object` | `url`, `x=0`, `y=0`, `name?`, `insert_index?` | 插入已有 `ui://` 资源；不保存 |
| `fgui_remove_object` | 目标三选一 | 删除非根对象；不保存 |
| `fgui_undo` | 无 | 优先撤销 Agent 属性事务，再回退 FairyGUI 原生撤销 |
| `fgui_redo` | 无 | 优先重做 Agent 属性事务，再回退 FairyGUI 原生重做 |
| `fgui_save_document` | 无 | 保存当前文档并清空 Agent 属性事务栈 |
| `fgui_save_all` | 无 | 保存全部文档、已打开包和工程并清空 Agent 属性事务栈 |
| `fgui_get_publish_settings` | `package_name?` | 读取全局与包级发布配置 |
| `fgui_publish` | `scope='active'`, `package_names?`, `branch?`, `save_before_publish=True`, `publish_desc_only=False`, `timeout_seconds=120` | 按现有配置发布并返回文件变更报告 |
| `fgui_discard_document` | 无 | 放弃当前文档全部未保存修改并重新加载磁盘版本 |

## 创建与导入语义

### 组件

- 包内目录输入可写 `Folder/SubFolder`，桥接统一为 `/Folder/SubFolder/`。
- 缺失目录默认创建；名称冲突默认拒绝，可选择自动追加 `_1`、`_2`。
- 创建结果返回实际名称、资源描述、`ui://` URL、文档状态和 `requiresSave=true`。

### 图片

- `source_path` 由 Python 端展开为绝对路径，编辑器端再次验证绝对路径、文件存在和图片类型。
- 导入名称按源扩展名落盘；图片资源默认 `exported=true`。
- `error` 拒绝同名；`auto_rename` 生成唯一名称；`replace` 仅允许替换同名图片。
- 导入/替换包含磁盘写入并返回 `diskWrite=true`；包元数据仍需保存。

### 按钮

- 模式映射：`common → Common`、`check → Check`、`radio → Radio`。
- `image_urls` 最多 6 个，顺序为 `up/down/over/selectedOver/disabled/selectedDisabled`，不足自动补空。
- 非空状态资源必须解析为工程内图片 `ui://` URL。
- 使用 `ComponentTemplates.CreateButtonItem` 创建标准 Button 扩展、`button` 控制器、状态节点和可选 `title`/`icon`。

## CLI 映射

正式子命令包括：

- `status`、`ping`、`project`、`packages`、`items`、`open`
- `create-component PACKAGE NAME [--width] [--height] [--folder] [--extension] [--not-exported] [--auto-rename] [--no-create-folders] [--no-open]`
- `import-image PACKAGE SOURCE [--folder] [--name] [--conflict error|auto_rename|replace] [--not-exported] [--no-create-folders] [--import-timeout]`
- `create-button PACKAGE NAME [--width] [--height] [--folder] [--mode common|check|radio] [--image URL] [--no-text] [--no-icon] [--no-relations] [--as-list-item] [--not-exported] [--auto-rename] [--no-create-folders] [--no-open] [--extension]`
- `active`、`tree`、`select`、`set`、`insert`、`remove`
- `save`、`discard`、`save-all`、`history`、`undo`、`redo`
- `publish-settings`、`publish`
- `call`：仅调试原始 Action

全局参数 `--project`、`--editor`、`--timeout` 必须位于子命令前。CLI 收到桥接响应 `ok=false` 时返回非零退出码。

## Bridge Action

```text
ping
get_project
list_packages
list_items
open_document
create_component
import_image
create_button
get_active_document
get_tree
select_object
set_property
insert_object
remove_object
save_document
save_all
get_publish_settings
publish
get_history
discard_document
undo
redo
```

## 关键限制

- `set_property` 只接受白名单属性。
- 根组件 `touchable` 不属于 FairyGUI 组件定义的可序列化状态，桥接会明确拒绝；根区域点击穿透使用 `opaque=false`。
- `opaque` 在对象树中可读、可由 `set_property` 修改并进入 Agent 属性事务栈，但只允许用于当前文档根组件。
- 同名对象不唯一时必须改用对象 ID 或路径。
- 不允许删除当前文档根对象。
- 创建组件/按钮、导入图片、插入/删除对象不进入 Agent 属性事务栈。
- 图片导入是磁盘写入；`discard_document` 不能回滚已导入资源。
- 发布期间阻止打开文档、资源创建/导入、对象修改、保存、放弃和撤销/重做。
- 仍未提供非图片资源导入，以及包资源删除、移动、重命名工具。
- Windows 真实环境端到端验证仍未执行。

## 文件变动同步矩阵

| 变动文件/区域 | 需要同步 |
| --- | --- |
| `plugin/main.ts` Action、参数、返回值、白名单、阻塞策略、协议或版本 | `plugin/main.js`、三处版本、`uv.lock`、README、本 Skill 与本文件 |
| `src/fairygui_agent/mcp_server.py` MCP 工具或参数 | `src/fairygui_agent/bridge_client.py` capability、README、CLI/Skill 映射、本文件 |
| `src/fairygui_agent/cli.py` 子命令、参数或退出码 | README CLI、本 Skill、本文件 |
| `src/fairygui_agent/bridge_client.py` 队列、能力校验、超时或响应语义 | README 安装/协议、本 Skill、本文件 |
| 创建/导入 API 或保存语义 | README 创建章节、本 Skill 操作流程、本文件 |

## 对照检查

1. `plugin/package.json`、`pyproject.toml`、`src/fairygui_agent/__init__.py`、`uv.lock` 版本一致。
2. `plugin/main.ts` capability 与 Action 分发一致；`src/fairygui_agent/bridge_client.py` 必需能力覆盖正式 Action。
3. MCP 工具、CLI parser、README 工具表和 Skill 没有失效参数。
4. `plugin/main.ts` 与重新编译的 `plugin/main.js` 一致。
5. 创建/导入变更应在 FairyGUI Editor 6.1.4 的隔离工程副本中验证，避免污染正式工程。
