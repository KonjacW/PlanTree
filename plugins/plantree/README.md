# PlanTree 插件

本目录包含 PlanTree 的 Codex 插件、本地 Web 启动器、Node.js + TypeScript 服务端和共享 React UI。MCP 与 Web 使用同一份本地任务树状态，所有写操作都由服务端进行版本检查。

本文所有 PowerShell 命令都从仓库根目录执行。仓库根目录是包含 `README.md`、`plugins/` 和 `openspec/` 的目录，不要求项目位于任何固定磁盘或文件夹。

## 1. 准备环境

安装 Node.js 20 或更高版本，并确保命令可用：

```powershell
node --version
npm --version
```

安装依赖：

```powershell
npm --prefix plugins/plantree/server ci
npm --prefix plugins/plantree/ui ci
```

## 2. 使用本地 Web

```powershell
npm --prefix plugins/plantree run web
```

统一启动器会先编译服务端，再在同一个 Node.js 进程中启动：

- Web 页面：<http://127.0.0.1:5174>
- 本地 API：<http://127.0.0.1:4174>
- 任务树读取接口：<http://127.0.0.1:4174/api/plan>

在启动终端按 `Ctrl+C` 同时停止页面和 API。不要同时单独运行服务端的 `web:server`，否则可能连接到旧构建。

## 3. 构建 Codex MCP 插件

```powershell
npm --prefix plugins/plantree/server run build
```

构建过程会：

1. 构建侧栏使用的 React UI。
2. 生成 `plugins/plantree/server/dist/index.js`。

`.mcp.json` 使用 PATH 中的 `node`，并由 Node 启动器在运行时定位个人插件目录；不依赖 Codex 对 `${PLUGIN_ROOT}` 做字符串展开，也不会绑定开发者的用户名、盘符或 Node.js 安装目录。开发测试可用 `PLANTREE_PLUGIN_ROOT` 指向源码插件根。若 Codex 无法找到 `node`：

1. 在 PowerShell 中确认 `Get-Command node` 有结果。
2. 完全退出并重新打开 Codex，使其重新读取 PATH。
3. 重新构建并安装插件；不要在仓库中提交个人机器的绝对路径。

安装成功后，调用 `render_plan_tree` 会启动并返回侧栏任务树，同时记录创建该树的 Codex `threadId`。用户点击一次“开始自动执行”后，本地桥接会用 `codex exec resume` 在原对话启动新回合，并按顺序处理完整剩余队列，无需保持旧回合等待、复制提示词或逐项确认。

节点内容、执行链和快捷键帮助共用任务树窗口内的单层工作区，按需替换“当前节点详情”区域，打开其中一项会收起另一项，不增加新的页面层级。只有裁剪节点和放弃未保存修改仍使用带遮罩的确认弹窗。

首次安装本地插件时，在仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin add plantree@plantree-local
```

`.agents/plugins/marketplace.json` 中的插件源相对指向 `plugins/plantree`。可用以下命令确认 marketplace 和插件状态：

```powershell
codex plugin marketplace list
codex plugin list
```

拉取新版代码并重新构建后，再运行 `codex plugin add plantree@plantree-local` 刷新安装。完全重启 Codex，并在新任务中测试新的 MCP 工具和侧栏执行请求。

## 4. 常用验证

服务端、MCP 协议和构建入口：

```powershell
npm --prefix plugins/plantree/server test
```

UI 类型检查：

```powershell
npm --prefix plugins/plantree/ui run typecheck
```

完整 UI 测试和侧栏 Web 构建：

```powershell
npm --prefix plugins/plantree/ui test
npm --prefix plugins/plantree/ui run build
```

OpenSpec 严格校验：

```powershell
openspec validate graph-interactive-plantree --strict
```

## 5. 运行数据

- `plugins/plantree/data/plantree-plan.example.json`：随仓库提交的示例。
- `plugins/plantree/data/kylin-memory-task-tree.example.json`：总目标到人工调树、链式执行的回归输入。
- `plugins/plantree/data/plantree-plan.json`：本机运行状态，已被 Git 忽略。
- `plugins/plantree/server/dist`、`plugins/plantree/ui/dist`：可重新构建的产物，已被 Git 忽略。

不要用示例文件无条件覆盖其他人的运行状态，也不要提交自己的 `plantree-plan.json`。

## 6. 必须保持的边界

- 所有写操作必须传递当前快照的 `expectedVersion`；HTTP 冲突返回 `409` 和服务端最新快照。
- MCP 与 Web 共用状态文件，但撤销和重做历史只存在于各自服务进程内。
- 图中节点拖动仅调整前端会话坐标，不得调用 `move_node`。
- `childIds` 是树结构和同层顺序的权威来源，`dependsOn` 仅表示显式依赖。
- 执行链仅包含未裁剪的 `task`/`checkpoint` 叶节点；`start_next_task` 与 `complete_task` 必须交替调用，不允许跳过当前任务。
- 不改变既有 MCP 工具名、HTTP 路由、任务树 JSON 或版本冲突规则，除非先完成对应规范变更。

## 维护文档

- [架构与数据流](docs/architecture.md)
- [MCP 与 HTTP 接口契约](docs/api-contracts.md)
- [数据结构与持久化](docs/data-and-persistence.md)
- [Windows 开发与验证](docs/development.md)
- [故障排查](docs/troubleshooting.md)
- [后端交接清单](docs/handoff-checklist.md)

当前产品决策永久放弃内嵌任务树；验收重点是侧栏一次点击后在创建任务树的原 Codex 对话启动新回合并接管完整执行链。
