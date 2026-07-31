# FairyGUI Agent Bridge

FairyGUI Agent Bridge 让支持 MCP 的 Agent 通过结构化工具操作 FairyGUI Editor。工具不依赖鼠标坐标，而是由 MCP/CLI 把 JSON 请求写入 FairyGUI 工程的 `.agent/` 队列，再由编辑器插件在主线程中调用 FairyGUI API。

- 当前版本：`0.6.0`
- 队列协议：`1.0`
- FairyGUI Editor 验证版本：`6.1.4`
- 通信方式：本地 JSON 文件队列
- MCP 传输：stdio

本独立仓库是该工具的唯一开发真源。业务工程只安装插件与 Skill 快照，不应在业务工程中嵌套克隆本仓库。

## 目录职责

```text
fgui-agent-bridge/
├── plugin/                    # FairyGUI Editor 插件
│   ├── main.ts / main.js
│   ├── package.json / tsconfig.json
│   └── types/                 # 独立编译所需的最小宿主类型
├── pyproject.toml / uv.lock   # Python 包与依赖锁定
├── src/fairygui_agent/        # MCP、CLI、工程定位和队列客户端
├── .agents/skills/            # 对应 Codex Skill
├── scripts/sync_to_project.py # 插件与 Skill 同步脚本
└── .mcp.example.json          # 通用 MCP stdio 配置示例
```

运行时队列位于被操作工程的 `.agent/`，例如：

```text
FairyGUI/.agent/
├── requests/
├── processing/
├── responses/
├── status.json
└── bridge.log
```

`.agent/` 是运行时数据，不纳入 Git。

## 安装与运行

需要 Python 3.10+ 和 [uv](https://docs.astral.sh/uv/)。在仓库根目录执行：

```bash
uv sync --frozen
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT status
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT ping
```

也可以把本目录作为普通 Python 包安装，安装后直接使用：

```bash
fgui-agent ping
fgui-agent-mcp
```

### 工程定位

按以下优先级选择 FairyGUI 工程：

1. MCP 调用 `fgui_use_project` 后的会话选择。
2. 启动参数 `--project`。
3. 环境变量 `FGUI_PROJECT_PATH`。
4. `CODEX_WORKSPACE_ROOT`、当前目录及父目录。
5. 从 Python 包所在目录向上查找 `FairyGUI/FairyGUI.fairy`；独立克隆使用时通常应显式传入目标工程。

参数可指向 `.fairy` 文件、FairyGUI 工程目录，或包含 `FairyGUI/FairyGUI.fairy` 的仓库目录。

### 编辑器路径

推荐设置统一环境变量：

```bash
export FAIRYGUI_EDITOR_PATH=/Applications/FairyGUI-Editor.app
```

Windows 示例：

```powershell
$env:FAIRYGUI_EDITOR_PATH = "C:\Tools\FairyGUI-Editor\FairyGUI-Editor.exe"
```

macOS 会尝试查找 `/Applications`、用户 `Applications` 和用户 `Downloads` 下的 `FairyGUI-Editor.app`。Windows 自动启动逻辑已实现，但尚未在真实 Windows 环境验证。其他平台不会自动启动编辑器，仍可连接已经运行并持续写入心跳的 FairyGUI Editor。


## 同步到 FairyGUI 工程

独立仓库是代码真源。不要直接把 Git 仓库克隆到业务工程的 `plugins/` 中；使用同步脚本复制受管理文件：

```bash
# 默认只预览，不写入
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT

# 同时预览插件与 Skill
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --skill-root /ABSOLUTE/PATH/TO/TARGET-REPOSITORY

# 确认后实际写入
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --skill-root /ABSOLUTE/PATH/TO/TARGET-REPOSITORY \
  --apply
```

插件写入目标 FairyGUI 工程的 `plugins/agent-bridge/`。Skill 仅在提供 `--skill-root` 时写入目标仓库的 `.agents/skills/fgui-agent-bridge/`。脚本不会创建 Git 元数据，也不会删除目标目录中的其他文件。

## MCP 配置

`.mcp.example.json` 提供通用 stdio 配置。Bridge 仓库路径与被操作的 FairyGUI 工程路径是两个独立参数，不能混用。

Codex 也可以直接登记：

```bash
codex mcp add fgui --env FGUI_PROJECT_PATH=/ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT -- \
  uv run --project /ABSOLUTE/PATH/TO/FGUI-AGENT-BRIDGE \
  fgui-agent-mcp
```

修改 MCP 配置后需要新建 Agent 任务，让客户端重新发现工具。

## MCP 工具与完成度

| MCP 工具 | FairyGUI Action | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| `fgui_status` | 本地状态 | 读取 | 完成 | 不唤醒编辑器，返回工程选择和心跳年龄 |
| `fgui_ping` | `ping` | 读取 | 完成 | 校验桥接版本、协议和 capability |
| `fgui_use_project` | 本地会话 | 配置 | 完成 | 切换当前 MCP 会话操作的工程 |
| `fgui_get_project` | `get_project` | 读取 | 完成 | 读取工程基本信息 |
| `fgui_list_packages` | `list_packages` | 读取 | 完成 | 列出工程中的包 |
| `fgui_list_items` | `list_items` | 读取 | 完成 | 列出包内资源，可按类型过滤 |
| `fgui_open_document` | `open_document` | 编辑器导航 | 完成 | 打开组件文档 |
| `fgui_create_component` | `create_component` | 资源创建 | 完成 | 在指定包和目录新建组件，可自动改名并创建后打开 |
| `fgui_import_image` | `import_image` | 资源导入 | 完成 | 从绝对本地路径导入图片，支持拒绝、自动改名或替换冲突 |
| `fgui_create_button` | `create_button` | 资源创建 | 完成 | 创建 Common/Check/Radio 标准 Button，支持最多 6 张状态图 |
| `fgui_get_active_document` | `get_active_document` | 读取 | 完成 | 读取活动文档和修改状态 |
| `fgui_get_tree` | `get_tree` | 读取 | 完成 | 读取对象树、ID、路径与常用属性 |
| `fgui_get_history` | `get_history` | 读取 | 完成 | 读取 Agent 与原生撤销状态 |
| `fgui_select_object` | `select_object` | 编辑器导航 | 完成 | ID、路径、唯一名称三选一 |
| `fgui_set_property` | `set_property` | 修改 | 完成 | 白名单属性，进入 Agent 属性事务栈 |
| `fgui_insert_object` | `insert_object` | 结构修改 | 部分完成 | 可插入已有 `ui://` 资源，无结构快照撤销 |
| `fgui_remove_object` | `remove_object` | 结构修改 | 部分完成 | 禁止删除根对象，无结构快照撤销 |
| `fgui_undo` | `undo` | 事务 | 完成 | 优先 Agent 属性事务，再回退原生历史 |
| `fgui_redo` | `redo` | 事务 | 完成 | 优先 Agent 属性事务，再回退原生历史 |
| `fgui_save_document` | `save_document` | 落盘 | 完成 | 显式保存当前文档 |
| `fgui_save_all` | `save_all` | 落盘 | 完成 | 显式保存全部文档、已打开包和工程 |
| `fgui_get_publish_settings` | `get_publish_settings` | 读取 | 完成 | 读取全局和包级发布设置及实际输出路径 |
| `fgui_publish` | `publish` | 发布/导出 | 完成 | 按工程发布设置导出当前包、指定包或全部包 |
| `fgui_discard_document` | `discard_document` | 回退 | 完成 | 放弃当前文档全部未保存修改 |

MCP 不提供无约束的原始 `call` 工具。CLI 保留 `call` 子命令，仅用于开发和排障。

## CLI 常用命令

```bash
FGUI="uv run fgui-agent"

$FGUI project
$FGUI packages
$FGUI items ViewHub
$FGUI open ViewHub ViewHubBtnItem
$FGUI create-component ViewHub NewPanel --width 1920 --height 1080 --folder Panels
$FGUI import-image ViewHub /absolute/path/button_up.png --folder Sprite --name button_up
$FGUI create-button ViewHub NewButton --folder Buttons --mode common \
  --image ui://packageIdImageUp --image ui://packageIdImageDown
$FGUI active
$FGUI tree
$FGUI set --id n4_qeeb x 120
$FGUI undo
$FGUI redo
$FGUI history
$FGUI publish-settings
$FGUI publish-settings ViewHub
$FGUI publish --scope active
$FGUI publish --scope packages --package ViewHub --package Common
$FGUI publish --scope all --publish-timeout 300
$FGUI discard
```

全局参数必须放在子命令前：

```bash
$FGUI --project /path/to/repository --timeout 15 ping
```

## 创建组件、导入图片与按钮

### 新建组件

`fgui_create_component` / CLI `create-component` 使用 FairyGUI 原生 `FPackage.CreateComponentItem`：

- 指定包名、组件名、宽高和包内目录；包内目录统一为 `/Folder/SubFolder/` 形式。
- 默认自动创建缺失目录、导出组件并打开新文档。
- 重名默认报错；`auto_rename=true` / `--auto-rename` 会生成 `_1`、`_2` 后缀。
- 创建后返回实际名称、`ui://` URL、组件文件、文档状态和 `requiresSave=true`。

### 导入图片

`fgui_import_image` / CLI `import-image` 使用 FairyGUI 原生异步资源导入：

- `source_path` 必须是存在的绝对本地路径，且 FairyGUI 能识别为图片类型。
- 可指定包内目录、资源名、是否导出和最长 1800 秒的等待时间。
- 冲突策略：`error` 默认拒绝、`auto_rename` 自动改名、`replace` 更新同名图片。
- 导入和替换会写入图片文件，返回 `diskWrite=true`；包元数据仍返回 `requiresSave=true`，需要随后保存。

### 创建标准按钮

`fgui_create_button` / CLI `create-button` 使用 FairyGUI 原生 `ComponentTemplates.CreateButtonItem`：

- 支持 `common`、`check`、`radio` 三种模式。
- 状态图片顺序固定为：`up`、`down`、`over`、`selectedOver`、`disabled`、`selectedDisabled`；最多 6 张，缺失位置自动补空。
- 状态图片必须是工程内已有 `ui://` 图片资源；可以先导入图片再创建按钮。
- 可控制是否创建文字、图标、尺寸关系、列表项模式、导出状态和创建后打开。
- 创建结果是带 `Button` 扩展、`button` 控制器和状态显示节点的标准 FairyGUI 组件。

创建组件和按钮不会自动调用保存工具；导入图片本身包含文件写入。结构创建与图片导入不进入 Agent 属性撤销栈，执行前应确认包、目录、名称和冲突策略。

## 保存与撤销边界

- 文档属性和对象修改默认只进入 FairyGUI 文档的未保存状态。
- 新建组件/按钮会创建包资源，图片导入/替换会直接写入图片文件；这些操作会返回 `requiresSave` / `diskWrite` 明确标记。
- 只有显式调用 `save`、`save-all` 或对应 MCP 保存工具才会保存文档和包元数据。
- 属性修改使用 Agent 自有事务栈，可立即 `undo` / `redo`。
- 属性当前值与事务记录不一致时拒绝撤销，避免覆盖人工修改。
- 保存、放弃文档、插入对象或删除对象时会清空 Agent 属性事务栈。
- 插入和删除目前没有完整的 Agent 结构事务；需要可靠回退时，在保存前使用 `discard`。
- 同名对象不唯一时拒绝修改，要求改用对象 ID 或路径。
- 不允许删除当前文档的根组件。
- FairyGUI 组件根节点不序列化 `touchable`。桥接会拒绝对此属性返回伪成功；透明根区域需要点击穿透时，应设置根组件 `opaque=false`，并按需设置子对象 `touchable=false`。
- `opaque` 已加入安全写入白名单，但仅允许设置当前文档根组件；对象树会返回组件的 `opaque` 当前值。

## 发布与导出

`fgui_get_publish_settings` / CLI `publish-settings` 可在发布前读取全局输出目录、格式、图集、代码生成设置以及包级覆盖。`fgui_publish` 和 CLI `publish` 使用这些现有设置，通过编辑器原生 `PublishHandler` 执行发布。工具不会自行改写发布目录、图集参数或代码生成配置。

支持的范围：

- `active`：发布当前文档所属包，默认值。
- `packages`：发布 `package_names` / `--package` 指定的一个或多个包。
- `all`：依次发布工程内全部包。

发布选项：

- 默认发布前保存全部文档和工程；可通过 `save_before_publish=false` 或 `--no-save` 关闭。
- `publish_desc_only=true` / `--desc-only` 只发布描述文件。
- 可显式指定 FairyGUI 分支；未指定时使用工程当前分支。
- MCP 默认等待 120 秒，最多允许 1800 秒；CLI 可用 `--publish-timeout` 调整。

发布结果包含包名、实际输出目录、文件扩展名、耗时，以及本次写入期间创建、更新和删除的文件清单。文件清单根据写入时间和大小判断，表示发布器写过的文件，不等同于 Git 内容一定发生变化。

发布是明确的磁盘写入操作。Agent 调用前应先读取工程和发布配置，并向用户说明发布范围；不要用发布工具代替普通文档保存。

## 尚未支持

| 能力 | 状态 |
| --- | --- |
| 导入字体、音频、Spine 等非图片资源 | 未支持 |
| 删除、移动或重命名包资源的 MCP 工具 | 未支持 |
| 批量布局与批量属性事务 | 未支持 |
| 插入/删除对象的 Agent 结构快照撤销 | 未支持 |
| Windows 真实环境端到端验证 | 未验证 |

## 协议与维护规则

请求格式：

```json
{
  "id": "request-id",
  "action": "get_project",
  "params": {},
  "protocolVersion": "1.0",
  "createdAt": "ISO-8601",
  "clientPid": 1234
}
```

响应格式：

```json
{
  "id": "request-id",
  "ok": true,
  "action": "get_project",
  "result": {},
  "timestamp": "ISO-8601"
}
```

维护时遵循：

1. `package.json`、`pyproject.toml` 和 Python `__version__` 使用同一工具版本。
2. 协议不兼容变更必须升级 `protocolVersion` 主版本。
3. 修改 Action、MCP 工具、白名单、安全语义或已知限制时同步更新本 README。
4. 任何功能变动同时更新 `.agents/skills/fgui-agent-bridge/SKILL.md` 与 `references/current-capabilities.md`。
5. `plugin/main.ts` 是 FairyGUI 插件源码；修改后重新编译 `plugin/main.js`，两者必须一起提交。
6. 不在代码或示例中提交个人绝对路径。

## 变更记录

### 0.6.0 - 2026-07-31

- 首次以独立公开仓库发布，采用 MIT 许可证。
- FairyGUI 插件 ID 更新为 `com.fgui.agent-bridge`，Bridge、Python 包和 Skill 版本统一为 `0.6.0`。
- MCP/CLI 与 FairyGUI 插件拆分为公开仓库根 Python 包和 `plugin/` 目录，工具名、参数和队列协议保持兼容。
- 增加本地最小宿主类型声明，移除对业务工程兄弟插件声明文件的编译依赖。
- 增加默认 dry-run 的 `scripts/sync_to_project.py`，用于在不嵌套 Git 仓库的情况下同步插件和 Skill。

### 0.5.1 - 2026-07-30

- 修复根组件属性写入的持久化误报：根节点 `touchable` 不再显示修改成功，而是返回 FairyGUI 原生序列化限制。
- 增加可持久化的根组件 `opaque` 白名单属性，并在对象树中返回组件 `opaque` 值。
- `opaque` 支持 Agent 属性撤销/重做；非根对象使用该属性时会被拒绝。

### 0.5.0 - 2026-07-30

- 增加 `fgui_create_component`、`fgui_import_image`、`fgui_create_button` 及对应 CLI。
- 支持创建包内目录和组件、导入/替换/自动改名图片，以及创建 Common/Check/Radio 标准按钮。
- 图片状态支持 `up/down/over/selectedOver/disabled/selectedDisabled` 六槽位，并校验为工程内 `ui://` 图片。
- 新建和导入结果返回实际名称、资源 URL、保存需求和磁盘写入语义；发布期间阻止并发资源创建。
- `save_all` 现在显式保存全部已打开包，确保新建资源和图片 `exported` 等包元数据落盘。
- CLI 在桥接返回 `ok=false` 时改为非零退出码，便于自动化发现失败。
- 在 FairyGUI Editor 6.1.4 的隔离工程副本中完成创建、导入、布局、保存和包发布验证。

### 0.4.0 - 2026-07-28

- 增加 `fgui_get_publish_settings`、`fgui_publish` 和对应 CLI，支持读取配置以及发布当前包、指定包和全部包。
- 支持发布前保存、仅发布描述、分支选择、长超时和输出文件变更报告。
- 文件队列支持等待 FairyGUI 异步发布任务完成后再返回响应。

### 0.3.0 - 2026-07-28

- 增加正式 MCP stdio 服务和 19 个显式 `fgui_*` 工具。
- CLI 与 MCP 复用同一 Python 队列客户端。
- 工具源码、配置和文档集中到本插件目录。
- 增加跨机器工程发现、编辑器路径配置和协议版本检查。

### 0.2.0

- 完成 JSON 文件队列、读取、属性修改、结构修改、保存、放弃和撤销/重做基础能力。

## 许可证

本项目采用 [MIT License](LICENSE)。
