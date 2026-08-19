# FairyGUI Agent Bridge

通过 MCP 或 CLI，让 CodeX之类的Agent 以结构化指令操作 FairyGUI Editor，从而实现自动拼UI界面

- 版本：`0.8.1`
- 队列协议：`1.0`
- 已验证 FairyGUI Editor：`6.1.4`
- 通信：本地 JSON 队列 + MCP stdio

Bridge 仓库与 FairyGUI 工程分开存放。FairyGUI 工程只需要安装插件；使用 Codex 时可额外安装 Skill。

## 依赖

- Python `3.10+`
- [uv](https://docs.astral.sh/uv/)
- FairyGUI Editor
- 使用 Codex MCP 时需要 `codex` 命令

## AI 安装

将下面的提示词复制给能够操作本地终端和文件的 AI 编程 Agent（例如 Codex）

```text
请帮我在这台电脑上完整安装 FairyGUI Agent Bridge。你可以执行终端命令和编辑本地文件，请实际完成安装，不要只给操作说明。

源仓库：https://github.com/Wilson520403/fgui-agent-bridge.git
目标 FairyGUI 工程：优先从当前工作区自动查找 .fairy 文件；找不到或找到多个时停下来询问我。
目标代码仓库：当前工作区；
```
## 人类安装

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
uv run fgui-agent import-font ViewHub /absolute/path/font.ttf
uv run fgui-agent import-sound ViewHub /absolute/path/click.mp3
uv run fgui-agent create-movieclip ViewHub Loading --frame /absolute/path/loading_01.png --frame /absolute/path/loading_02.png --fps 12
uv run fgui-agent create-button ViewHub NewButton --mode common
uv run fgui-agent upsert-transition '{"name":"fadeIn","frameRate":60,"items":[{"type":"Alpha","frame":0,"tween":{"duration":12,"start":0,"end":1}}]}'
uv run fgui-agent preview-transition play fadeIn
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
- **创建资源**：`fgui_create_component`、`fgui_import_image`、`fgui_import_font`、`fgui_import_sound`、`fgui_create_button`、`fgui_create_movieclip`、`fgui_update_movieclip`、`fgui_get_movieclip`、`fgui_remove_movieclip`
- **Transition**：`fgui_list_transitions`、`fgui_get_transition`、`fgui_upsert_transition`、`fgui_remove_transition`、`fgui_add_transition_item`、`fgui_update_transition_item`、`fgui_remove_transition_item`
- **动画预览**：`fgui_preview_animation`（Transition 与 MovieClip 的播放、暂停、停止、跳帧和状态查询；不保存）
- **保存与回退**：`fgui_save_document`、`fgui_save_all`、`fgui_discard_document`、`fgui_undo`、`fgui_redo`
- **发布**：`fgui_get_publish_settings`、`fgui_publish`

Transition 使用类型化 JSON 和 FairyGUI frame 时间单位，覆盖 XY、Size、Pivot、Scale、Skew、Alpha、Rotation、Color、Animation、Visible、Sound、Transition、Shake、ColorFilter、Text、Icon 全部原生轨道。一次 Transition 声明式更新或关键帧原子操作形成一个 Agent 事务，可通过 `fgui_undo` / `fgui_redo` 回退。Tween 的路径和自定义缓动读取结果同时包含 `encoded` 与 `points`；再次写入时优先复用 `encoded`，以保留 Editor 规范化后的完整数据。`playTimes` 是 Editor 运行态字段，不写入组件 XML。

MovieClip 接受有序本地图片序列并通过 FairyGUI `AniData.ImportImages` 嵌入 `.jta`，不会为每帧额外创建包内图片 `ui://` 资源。创建/更新响应会返回本次 `frameSources` 和 `resourceChanges`；重新读取只能得到 `.jta` 中的帧、矩形和延迟信息。FPS 范围为 `1..255`，Repeat Delay 与每帧 Delay 为 `0..255` 的额外延迟帧数，并支持 Speed、Swing。声音资源可用 `fgui_import_sound` 导入并在 Sound 轨道中引用。

资源导入和 MovieClip 帧处理会写磁盘，`fgui_discard_document` 不会自动删除它们。已有 MovieClip 的更新或 `replace` 会记录文件快照，可通过 Agent undo/redo 回退；全新 MovieClip 创建和删除属于不可逆资源生命周期操作。创建失败会尽力清理本次新建的 `.jta` 与包资源。MovieClip 删除要求显式 `force=True`，且检测到组件引用时仍会拒绝删除。

### 大图图集限制

图片资源如果达到 `1920×1080`，或任一边达到 2K（`2048`），会自动设置 FairyGUI 的 `alone` 纹理集。这样每张大图都会单独生成图集，不会和小图混排。通过 `fgui_import_image` 导入/替换时立即应用；执行 `fgui_publish` 时还会扫描目标包并补齐历史资源的设置。发布响应和 `fgui_get_publish_settings` 会返回该规则及本次被修正的资源。

MCP 只提供显式工具；CLI 的 `call` 仅用于调试原始 Action。

## 当前限制

- 动画兼容基线为 FairyGUI Editor `6.1.4`；尚未完成其他 6.x 的真实环境兼容矩阵。
- 不支持 Spine、DragonBones、Loader3D、SWF 或运行时游戏代码层动画控制。
- 通用包资源的删除、移动和重命名仍不支持；仅提供带 `force` 且带引用检查的 MovieClip 删除。
- Windows 尚未完成真实环境端到端验证。

## 更新

```bash
git pull
uv sync --frozen
uv run python scripts/sync_to_project.py --choose-project --apply
```
有或者直接和你的 agent 说“/fgui-agent-bridge更新这个技能”。更新插件后重新打开 FairyGUI 工程。只有 MCP 启动命令或 Bridge 仓库路径变化时，才需要重新登记 MCP。

## 开发维护

- FairyGUI 插件源码：`plugin/main.ts`
- 插件运行文件：`plugin/main.js`
- Python MCP/CLI：`src/fairygui_agent/`
- Codex Skill：`.agents/skills/fgui-agent-bridge/`
- 同步脚本：`scripts/sync_to_project.py`

修改插件源码后，需重新生成并提交 `plugin/main.js`；版本号需同步更新到 `plugin/package.json`、`pyproject.toml`、Python `__version__` 和插件源码/运行文件。


## 其他开源库推荐
- [蓝湖 MCP](https://github.com/dsphper/lanhu-mcp)，配合本工具，可以用 CodeX 之类的 Agent 自动切图然后拼接好 UI 发布


## 许可证

[MIT License](LICENSE)
