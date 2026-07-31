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
- 修改组件属性、插入/删除已有 `ui://` 资源、保存、放弃、撤销或重做。
- 发布当前包、指定包或全部包，或检查发布设置。
- 修改插件、MCP、CLI、版本、协议、白名单、队列语义、同步脚本或 README。

## 使用工作流

### 1. 连接与定位

1. 使用 `fgui_status` 查看当前会话是否已选择工程、编辑器是否在线以及心跳年龄；它不会唤醒编辑器。
2. 工程未选择时调用 `fgui_use_project`，参数可为 `.fairy` 文件、FairyGUI 工程目录或包含 `FairyGUI/FairyGUI.fairy` 的仓库目录。
3. 需要唤醒或验证编辑器时调用 `fgui_ping`。不要把“请求已写入队列”当作 FairyGUI 已完成。
4. 不知道包名时先 `fgui_list_packages`；不知道资源时用 `fgui_list_items`。
5. 打开组件后先确认活动文档，再读取对象树。修改优先使用稳定对象 ID，其次对象路径；只有名称唯一时才使用名称。

### 2. 创建、修改和保存

- 新建组件使用 `fgui_create_component`，明确包、目录、名称、宽高、导出状态和冲突策略。
- 图片导入使用绝对本地路径；`replace` 是磁盘覆盖，不能由文档放弃回滚。
- 按钮状态图顺序固定为 `up/down/over/selectedOver/disabled/selectedDisabled`，非空值必须是工程内图片 `ui://` URL。
- 属性修改进入 Agent 属性事务栈；结构创建、插入和删除没有完整结构快照撤销。
- 保存使用 `fgui_save_document` 或 `fgui_save_all`；放弃全部未保存修改使用 `fgui_discard_document`。

### 3. 发布

1. 先调用 `fgui_get_publish_settings` 确认输出目录、格式、图集、代码生成和包级覆盖。
2. 明确发布范围：`active`、`packages` 或 `all`。
3. 再调用 `fgui_publish`，按需设置保存、描述文件、分支和超时。
4. 读取实际输出目录、扩展名、耗时和文件变更清单；文件清单不等于 Git 内容一定变化。
5. 发布期间部分读写 Action 会被阻塞；遇到超时先检查状态和 `.agent/bridge.log`，不要并发重复发布。

## CLI 约定

在独立仓库根目录使用：

```bash
uv sync --frozen
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT status
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT ping
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT packages
uv run fgui-agent --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT tree
```

全局参数 `--project`、`--editor`、`--timeout` 必须位于子命令前。`call` 只用于调试原始 Action，不替代正式 MCP 工具。

## 同步到业务工程

独立仓库是开发真源。同步脚本默认只预览，必须显式传入 `--apply` 才写入：

```bash
uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --skill-root /ABSOLUTE/PATH/TO/TARGET-REPOSITORY

uv run python scripts/sync_to_project.py \
  --project /ABSOLUTE/PATH/TO/FAIRYGUI-PROJECT \
  --skill-root /ABSOLUTE/PATH/TO/TARGET-REPOSITORY \
  --apply
```

- 插件目标为 FairyGUI 工程的 `plugins/agent-bridge/`。
- Skill 仅在提供 `--skill-root` 时写入 `.agents/skills/fgui-agent-bridge/`。
- 脚本不创建 Git 元数据、不复制缓存、不删除目标目录其他文件。
- 发布仓库变更完成后，业务工程同步应作为独立操作审阅和提交。

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
- 同一请求不要重复写入；响应必须按请求 ID 匹配。
- 图片导入和发布是磁盘写入，执行前确认目标和冲突策略。
- 不允许删除根组件；不要把 `discard`、`undo` 和 `save` 混为同一语义。
- 根组件点击穿透使用可序列化的 `opaque=false`；不要把无法持久化的根 `touchable` 宣称成功。
- 不在代码、配置、文档或示例中提交个人绝对路径、密钥或真实 MCP 配置。

## 输出要求

完成操作或维护任务时报告：

- 涉及的包、文档、对象或文件；
- 是否保存、发布、放弃或同步，以及作用范围；
- 执行了哪些静态检查、MCP 握手和编辑器验证；
- 哪些真实平台或环境仍未验证。
