# PlanTree

PlanTree 是一个本地 Node.js + TypeScript 图形任务树项目，同时提供：

- 本地 Web 页面
- Codex MCP 工具
- Codex MCP PiP 图形界面
- 文件持久化、版本冲突保护、撤销与重做
- 从用户总目标生成树、人工调树并按叶节点顺序真实执行的完整链路

## 环境要求

- Windows 10/11
- PowerShell
- Node.js 20 或更高版本，且 `node`、`npm` 已加入 `PATH`
- Git

检查环境：

```powershell
node --version
npm --version
git --version
```

## 获取项目

在你希望存放项目的目录中执行。已配置 GitHub CLI 时推荐：

```powershell
gh repo clone KonjacW/PlanTree
Set-Location PlanTree
```

也可以使用 Git：

```powershell
git clone https://github.com/KonjacW/PlanTree.git
Set-Location PlanTree
```

该仓库为私人仓库，克隆者需要先获得仓库访问权限，并通过 `gh auth login` 或 Git 凭据完成 GitHub 登录。

后续命令均假定当前目录是克隆后的仓库根目录，即包含 `README.md`、`plugins/` 和 `openspec/` 的目录。

## 安装依赖

服务端和 UI 是两个独立 npm 工作区，需要分别安装：

```powershell
npm --prefix plugins/plantree/server ci
npm --prefix plugins/plantree/ui ci
```

如果正在主动更新依赖，可将 `ci` 改为 `install`；普通使用和复现构建优先使用 `npm ci`。

## 启动本地 Web

```powershell
npm --prefix plugins/plantree run web
```

启动成功后打开：

- 页面：<http://127.0.0.1:5174>
- API：<http://127.0.0.1:4174/api/plan>

在启动命令所在终端按 `Ctrl+C` 停止服务。不要另外单独启动 `web:server`，统一启动器会自动编译最新服务端并同时管理页面和 API。

## 构建 Codex MCP 插件

```powershell
npm --prefix plugins/plantree/server run build
```

该命令会生成 MCP 内嵌 UI 和 `plugins/plantree/server/dist/index.js`。插件配置使用 PATH 中的 `node` 启动服务，因此安装或更新 Node.js 后应重启 Codex，使桌面应用读取最新环境变量。

仓库包含本地插件目录和 marketplace 描述：

- 插件：`plugins/plantree/`
- Marketplace：`.agents/plugins/marketplace.json`
- MCP 配置：`plugins/plantree/.mcp.json`

首次安装时，在仓库根目录注册该本地 marketplace：

```powershell
codex plugin marketplace add .
codex plugin add plantree@plantree-local
```

检查安装结果：

```powershell
codex plugin marketplace list
codex plugin list
```

后续拉取新版代码后，重新安装依赖、执行 MCP 构建，再运行：

```powershell
codex plugin add plantree@plantree-local
```

完全重启 Codex 并新建任务，使新的 MCP 工具和 PiP 资源生效。

## 最小验证

```powershell
npm --prefix plugins/plantree/server test
npm --prefix plugins/plantree/ui run typecheck
npm --prefix plugins/plantree/ui test
openspec validate graph-interactive-plantree --strict
```

## 完整规划与执行链

Codex 通过插件按以下协议工作：

1. `build_planner_prompt`：把用户总目标转换为精简 TaskTree JSON 规划提示词。
2. Codex 生成 JSON 后调用 `import_task_tree`，UI 显示并允许用户改写、排序或删除节点。
3. `compile_execution_chain`：只收集未删除的可执行叶节点，按 `childIds` 深度优先顺序生成任务提示词。
4. `start_next_task`：一次只领取一个任务并标记为执行中。
5. Codex 完成当前任务后调用 `complete_task`，然后领取下一项，直至 `done: true`。

在 Codex 内嵌 UI 中点击“交给 Codex 执行剩余队列”，UI 会通过 MCP App `sendMessage` 向当前对话发送一次执行协议。Codex 随后自行循环领取、实际执行和验收任务，无需逐条复制提示词；任务失败、需要审批或验收未通过时会停在当前节点。

麒麟 OS 记忆系统的完整回归样例位于 `plugins/plantree/data/kylin-memory-task-tree.example.json`。测试中的人工修改会删除 `n3`、`n10`、`n11`，把 `n12` 改为生成 `mock_plan.md`，最终执行顺序为 `n4 → n5 → n7 → n8 → n9 → n12`。

如果本机没有安装 OpenSpec CLI，可以先完成前两项；OpenSpec 校验主要用于继续维护规范变更。

## 项目文档

- [完整安装、启动与开发说明](plugins/plantree/README.md)
- [架构与数据流](plugins/plantree/docs/architecture.md)
- [MCP 与 HTTP 接口契约](plugins/plantree/docs/api-contracts.md)
- [数据结构与持久化](plugins/plantree/docs/data-and-persistence.md)
- [Windows 开发与验证](plugins/plantree/docs/development.md)
- [故障排查](plugins/plantree/docs/troubleshooting.md)
- [后端交接清单](plugins/plantree/docs/handoff-checklist.md)

当前 OpenSpec 变更 `graph-interactive-plantree` 为 `25/26`，唯一未完成项是 Codex MCP PiP 人工走查。
