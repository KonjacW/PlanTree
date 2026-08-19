# Windows 开发与验证

## 环境要求

- Windows PowerShell。
- Node.js 20 或更高版本，并确保 `node`、`npm` 已加入 PATH；依赖版本以两个 `package-lock.json` 为准。
- 如需执行规范校验，安装可用的 `openspec` CLI。
- Codex 侧栏执行走查需要支持本地插件与资源链接的 Codex 宿主。

项目由两个独立 npm 工作区组成：

- `server/`：MCP、HTTP、领域逻辑与持久化。
- `ui/`：侧栏 Web React 应用。

插件根 `package.json` 只提供统一 Web 启动命令。

## 安装依赖

以下命令均从仓库根目录执行。首次检出后分别安装锁定依赖：

```powershell
npm --prefix plugins/plantree/server ci
npm --prefix plugins/plantree/ui ci
```

主动更新依赖时可使用 `npm install`；普通使用和复现构建优先使用 `npm ci`。不要删除或手工合并两个锁文件。

## 本地 Web 开发

```powershell
npm --prefix plugins/plantree run web
```

`scripts/start-web.mjs` 按以下顺序工作：

1. 使用 `server/node_modules/typescript` 编译 `server/tsconfig.build.json`。
2. 动态加载最新 `server/dist/web-server.js`，监听 `127.0.0.1:4174`。
3. 通过 Vite Node API 启动 `127.0.0.1:5174`。
4. 两个监听器由同一个 Node.js 进程管理。

Vite 使用 `strictPort: true`，端口占用时启动失败，不会自动改用其他端口。停止服务时回到启动终端按 `Ctrl+C`。

## Codex MCP 构建

```powershell
npm --prefix plugins/plantree/server run build
```

服务端 `prebuild` 会先用 Vite 构建侧栏到 `ui/dist`，再用 TypeScript 将服务端源码编译到 `server/dist`。

`.mcp.json` 使用 PATH 中的 `node`。启动代码先读取可选的 `PLANTREE_PLUGIN_ROOT`（测试/开发覆盖），再定位默认个人插件目录 `~/plugins/plantree`，因此可以从任意工作目录启动，也不依赖宿主展开 `${PLUGIN_ROOT}`。如果 Codex 无法找到 Node.js，先确认 `Get-Command node`，然后完全重启 Codex以重新读取 PATH。不要将个人机器的绝对 Node.js 路径提交到仓库。

`render_plan_tree` 启动并返回绑定 `127.0.0.1:5174` 的侧栏入口。侧栏复制按钮向本地 API 提交计划 ID 与快照版本，服务端生成 `plantree-prompt.md` 并通过 Windows `FileDropList` 放入剪贴板。项目不注册 MCP App、内嵌任务树资源或对话恢复桥。

首次安装仓库内的本地插件：

```powershell
codex plugin marketplace add .
codex plugin add plantree@plantree-local
```

插件更新并重新构建后，运行 `codex plugin add plantree@plantree-local` 刷新安装，再完全重启 Codex 并新建任务。

## 集中验证策略

### 仅修改服务端领域或协议

```powershell
npm --prefix plugins/plantree/server test
```

当前 `pretest` 会先生成侧栏 UI 和服务端构建，因此该命令同时检查干净构建入口与服务端测试文件。

### 仅修改 UI 类型或纯函数

```powershell
npm --prefix plugins/plantree/ui test
npm --prefix plugins/plantree/ui run typecheck
```

可在开发中定向运行单个 Vitest 文件；交付前再运行完整 UI 测试。

### 修改 UI 构建

```powershell
npm --prefix plugins/plantree/ui run build
```

该命令生成侧栏 Web 产物。

### 修改 OpenSpec 范围内行为

```powershell
openspec validate graph-interactive-plantree --strict
```

## 交付前完整验证

功能性修改交付前建议按顺序执行：

```powershell
npm --prefix plugins/plantree/ui test
npm --prefix plugins/plantree/ui run typecheck
npm --prefix plugins/plantree/ui run build
npm --prefix plugins/plantree/server test
npm --prefix plugins/plantree/server run build
openspec validate graph-interactive-plantree --strict
```

文档或无行为配置修改可以采用集中监测点：服务端 `npm test`、UI `npm run typecheck`、OpenSpec strict validate 和静态链接检查。

## 目录职责

| 路径 | 是否源码/应保留 | 说明 |
| --- | --- | --- |
| `server/src` | 是 | 服务端 TypeScript 源码。 |
| `server/test` | 是 | 服务端 Vitest。 |
| `ui/src` | 是 | React UI、纯适配函数和 UI 测试。 |
| `data/plantree-plan.example.json` | 是 | 可提交示例数据。 |
| `data/plantree-plan.json` | 运行数据 | 本机任务树状态，已忽略。 |
| `data/plantree-prompt.md` | 运行数据 | 最近一次复制的执行提示文件，已忽略。 |
| `server/dist` | 可再生 | MCP 与 Web API JavaScript 构建；MCP 运行需要。 |
| `ui/dist` | 可再生 | 侧栏 Web 构建产物。 |
| `server/node_modules`、`ui/node_modules` | 可再生 | 独立依赖目录。 |
| `openspec/changes` | 是 | 已确认变更的设计、规格和任务。 |

不要为了“整理目录”移动 `server/src`、`ui/src` 或共享 `data/`；当前相对路径被构建脚本、MCP 配置和默认状态路径共同使用。

## 修改路径提示

- 新增领域编辑：先修改 `domain/plan-editor.ts` 和领域测试，再接入 `DemoSession`。
- 新增写接口：同步 MCP 注册、HTTP 路由、HTTP `ToolCaller`、`expectedVersion` 和冲突测试。
- 修改任务树类型：同步服务端 `domain/types.ts` 与 UI `plan-types.ts`，保持旧 JSON 可加载。
- 修改图关系：优先修改 `ui/src/graph-model.ts` 的纯适配层及其测试。
- 修改提示词派生：保持 `ui/src/prompt.ts` 为不写快照、不发网络请求的纯函数。
