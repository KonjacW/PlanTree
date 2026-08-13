# PlanTree

PlanTree 是一个本地 Node.js + TypeScript 任务树服务，同时提供 Codex MCP PiP 和本地 Web 两个入口。两个入口共享同一份任务树状态文件，所有任务树变更都由服务端执行版本检查和持久化。

## 五分钟启动

首次使用时，在 PowerShell 中安装两个工作区的依赖：

```powershell
Set-Location D:\Project\Cambridge\PlanTree\plugins\plantree\server
npm install

Set-Location ..\ui
npm install
```

启动本地 Web：

```powershell
Set-Location D:\Project\Cambridge\PlanTree\plugins\plantree
npm run web
```

统一启动器会先编译服务端，再在同一个 Node.js 进程中启动：

- Web 页面：`http://127.0.0.1:5174`
- 本地 API：`http://127.0.0.1:4174`

在启动终端按 `Ctrl+C` 同时停止两个服务。不要同时单独运行 `server` 的 Web 服务。

## Codex MCP 入口

MCP 配置位于 `.mcp.json`，通过本地 `stdio` 启动 `server/dist/index.js`。首次使用或修改服务端、UI 后先生成正式构建：

```powershell
Set-Location D:\Project\Cambridge\PlanTree\plugins\plantree\server
npm run build
```

该构建命令会先生成 MCP 内嵌 UI，再编译服务端 JavaScript。Codex 插件清单位于 `.codex-plugin/plugin.json`。

## 常用验证命令

集中开发验证：

```powershell
Set-Location D:\Project\Cambridge\PlanTree\plugins\plantree\server
npm test

Set-Location ..\ui
npm run typecheck

Set-Location D:\Project\Cambridge\PlanTree
openspec validate graph-interactive-plantree --strict
```

完整 UI 测试或 Web 生产构建按需运行：

```powershell
Set-Location D:\Project\Cambridge\PlanTree\plugins\plantree\ui
npm test
npm run build
```

## 必须保持的边界

- 所有写操作必须传递当前快照的 `expectedVersion`；HTTP 冲突返回 `409` 和服务端最新快照。
- MCP 与 Web 共用 `data/plantree-plan.json`，但撤销和重做历史只存在于各自服务进程内。
- 图中节点拖动仅调整前端会话坐标，不得调用 `move_node`；`move_node` 是服务端的同父节点顺序编辑能力。
- `childIds` 是树结构和同层顺序的权威来源，`dependsOn` 仅表示显式依赖。
- `data/plantree-plan.example.json` 是可提交示例；`data/plantree-plan.json` 是运行时状态，不得用示例文件无条件覆盖。
- 不改变既有 MCP 工具名、HTTP 路由、任务树 JSON 或版本冲突规则，除非先完成对应规范变更。

## 维护文档

- [架构与数据流](docs/architecture.md)
- [MCP 与 HTTP 接口契约](docs/api-contracts.md)
- [数据结构与持久化](docs/data-and-persistence.md)
- [Windows 开发与验证](docs/development.md)
- [故障排查](docs/troubleshooting.md)
- [后端交接清单](docs/handoff-checklist.md)

当前 OpenSpec 变更 `graph-interactive-plantree` 为 `25/26`；唯一未完成项是 `5.4 Codex MCP PiP` 人工走查，必须由实际宿主环境验收后再标记完成。
