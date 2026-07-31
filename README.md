# FairyGUI Agent Bridge

通过 MCP 或 CLI，让 Agent 以结构化指令操作 FairyGUI Editor。

- 版本：`0.6.0`
- 队列协议：`1.0`
- 已验证 FairyGUI Editor：`6.1.4`
- 通信：本地 JSON 队列 + MCP stdio

Bridge 仓库与 FairyGUI 工程分开存放。FairyGUI 工程只需要安装插件；使用 Codex 时可额外安装 Skill。

## AI 快速安装（提示词安装）

将下面的提示词复制给能够操作本地终端和文件的 AI 编程 Agent（例如 Codex）。AI 应实际执行安装与验证，而不是只返回命令说明。

```text
请帮我在这台电脑上完整安装 FairyGUI Agent Bridge。你可以执行终端命令和编辑本地文件，请实际完成安装，不要只给操作说明。

源仓库：https://github.com/Wilson520403/fgui-agent-bridge.git
目标 FairyGUI 工程：优先从当前工作区自动查找 .fairy 文件；找不到或找到多个时再询问我。
目标代码仓库：当前工作区；如果当前工作区就是 Bridge 仓库，先询问我是否还要把 Codex Skill 安装到其他代码仓库。

请按以下要求执行：
1. 检查 Git、Python 3.10+、uv、FairyGUI Editor，以及可选的 codex CLI。缺少可安全安装的依赖时直接安装；无法自动处理时明确告诉我阻塞项。
2. 使用仓库最新 main 分支。仓库已存在时先检查 git status，不覆盖未提交修改；不存在时克隆到稳定、非临时目录。
3. 识别并确认目标 FairyGUI 工程。可以使用 .fairy 文件、FairyGUI 工程目录，或包含 FairyGUI/FairyGUI.fairy 的代码仓库目录。
4. 在 Bridge 仓库执行 uv sync --frozen。
5. 执行 uv run python scripts/sync_to_project.py --project <实际工程路径> --apply 安装插件，并确认目标工程 plugins/agent-bridge/ 中的受管理文件已经写入。
6. 如果本机有 codex CLI，先执行 codex mcp get fgui 检查现有配置，再安全地新增或更新 fgui MCP；保留所有无关 MCP 配置。启动命令应从 Bridge 仓库运行 fgui-agent-mcp，并通过 FGUI_PROJECT_PATH 指向目标 FairyGUI 工程。
7. 如果当前工作区是我要使用 Codex 操作的代码仓库，将 Bridge 仓库中的 .agents/skills/fgui-agent-bridge/ 复制到当前工作区同路径；不要把 .agent/、.venv/、缓存或 Git 元数据复制进去。
8. 打开或提示我重新打开目标 FairyGUI 工程，然后依次完成 status、ping、project、packages 的低风险验证。不要用创建资源、保存或发布作为首次验证。
9. 最后汇报实际使用的 Bridge 路径、FairyGUI 工程路径、Skill 安装路径、MCP 配置和每项验证结果；任何未完成或仍需人工操作的步骤都要明确列出。
```

如果已经知道路径，可以先把提示词中的“目标 FairyGUI 工程”和“目标代码仓库”改成绝对路径，AI 就不需要再次询问。

## 人类安装

### 依赖

- Python `3.10+`
- [uv](https://docs.astral.sh/uv/)
- FairyGUI Editor
- 使用 Codex MCP 时需要 `codex` 命令

### 1. 获取 Bridge

```bash
git clone https://github.com/Wilson520403/fgui-agent-bridge.git
cd fgui-agent-bridge
uv sync --frozen
```

目录选择安装需要使用最新 `main` 分支；`v0.6.0` 标签不包含 `--choose-project`。

### 2. 安装 FairyGUI 插件

运行下面的命令，在弹出的窗口中选择 FairyGUI 工程目录：

```bash
uv run python scripts/sync_to_project.py --choose-project --apply
```

脚本会先检查工程，再将插件安装到 `plugins/agent-bridge/`。无效目录或取消选择时不会写入文件。

也可以直接指定路径：

```bash
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --apply
```

`--project` 支持 `.fairy` 文件、FairyGUI 工程目录，或包含 `FairyGUI/FairyGUI.fairy` 的仓库目录。

然后重新打开 FairyGUI 工程。插件运行时目录 `.agent/` 会自动创建，不要提交到 Git。

### 3. 注册 Codex MCP（可选）

```bash
codex mcp add fgui \
  --env FGUI_PROJECT_PATH=/ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  -- uv run --project /ABSOLUTE/PATH/TO/FGUI-AGENT-BRIDGE fgui-agent-mcp
```

检查配置：

```bash
codex mcp get fgui
```

修改配置后，新建一个 Codex 任务即可重新发现工具。

也可以参考仓库根目录的 `.mcp.example.json` 手动配置。

### 4. 验证

先打开 FairyGUI 工程，再执行：

```bash
uv run --project /ABSOLUTE/PATH/TO/FGUI-AGENT-BRIDGE \
  fgui-agent \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  ping
```

也可以先查看状态：

```bash
uv run --project /ABSOLUTE/PATH/TO/FGUI-AGENT-BRIDGE \
  fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT status
```

连接失败时，优先检查：FairyGUI 工程是否打开、`plugins/agent-bridge/main.js` 是否存在，以及 `.agent/bridge.log`。

## 可选：安装 Codex Skill

Skill 不是 MCP 的必需项。需要时，将仓库中的：

```text
.agents/skills/fgui-agent-bridge/
```

直接复制到目标代码工程的：

```text
<目标工程>/.agents/skills/fgui-agent-bridge/
```

不需要单独运行安装脚本。

## 常用 CLI

以下命令均可在 Bridge 仓库目录执行；也可以为 `fgui-agent` 添加 `--project PATH`。

```bash
uv run fgui-agent status
uv run fgui-agent ping
uv run fgui-agent project
uv run fgui-agent packages
uv run fgui-agent items ViewHub
uv run fgui-agent open ViewHub ViewHubBtnItem
uv run fgui-agent active
uv run fgui-agent tree
uv run fgui-agent save
uv run fgui-agent undo
uv run fgui-agent redo
uv run fgui-agent publish --scope active
```

创建和导入资源：

```bash
uv run fgui-agent create-component ViewHub NewPanel --width 1920 --height 1080
uv run fgui-agent import-image ViewHub /absolute/path/button.png
uv run fgui-agent create-button ViewHub NewButton --mode common
```

全局参数必须放在子命令前，例如：

```bash
uv run fgui-agent \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  packages
```

## MCP 工具

工具按用途分为：

- **连接与读取**：`fgui_status`、`fgui_ping`、`fgui_get_project`、`fgui_list_packages`、`fgui_list_items`、`fgui_get_active_document`、`fgui_get_tree`、`fgui_get_history`
- **导航与修改**：`fgui_open_document`、`fgui_select_object`、`fgui_set_property`、`fgui_insert_object`、`fgui_remove_object`
- **创建资源**：`fgui_create_component`、`fgui_import_image`、`fgui_create_button`
- **保存与回退**：`fgui_save_document`、`fgui_save_all`、`fgui_discard_document`、`fgui_undo`、`fgui_redo`
- **发布**：`fgui_get_publish_settings`、`fgui_publish`

MCP 只提供显式工具；CLI 的 `call` 仅用于调试原始 Action。

## 重要边界

- `fgui_set_property` 支持白名单属性，并进入 Agent 属性撤销栈。
- 插入和删除对象属于结构修改，暂不提供完整的 Agent 结构快照撤销。
- 图片导入使用绝对本地路径；按钮状态图必须是工程内 `ui://` 图片。
- 发布会写入磁盘，默认先保存；发布前应确认发布范围和工程发布设置。
- 多个 FairyGUI 工程可以共用 Bridge 仓库和 Python 环境，但每个工程都要单独安装插件。
- `.agent/` 是运行时队列，不纳入 Git。

## 当前限制

- 暂不支持字体、音频、Spine 等非图片资源导入。
- 暂不支持删除、移动或重命名包资源。
- 暂不支持批量布局和批量属性事务。
- Windows 尚未完成真实环境端到端验证。

## 更新

```bash
git pull
uv sync --frozen
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --apply
```

更新插件后重新打开 FairyGUI 工程。只有 MCP 启动命令或 Bridge 仓库路径变化时，才需要重新登记 MCP。

## 开发维护

- FairyGUI 插件源码：`plugin/main.ts`
- 插件运行文件：`plugin/main.js`
- Python MCP/CLI：`src/fairygui_agent/`
- Codex Skill：`.agents/skills/fgui-agent-bridge/`
- 同步脚本：`scripts/sync_to_project.py`

修改插件源码后，需重新生成并提交 `plugin/main.js`；版本号需同步更新到 `plugin/package.json`、`pyproject.toml`、Python `__version__` 和插件源码/运行文件。

## 许可证

[MIT License](LICENSE)
