# PlanTree 后端交接规范化设计

## 1. 背景

PlanTree 已完成图形任务树、Web 本地入口、Codex MCP PiP 入口、版本冲突保护、撤销与重做、节点人工提示词等核心能力。当前实现已通过 UI、服务端、构建和 OpenSpec 验证，下一阶段需要将项目整理为便于后端开发者继续维护的工程交付物。

本次交接对象继续维护当前 Node.js + TypeScript 服务端，主要运行环境为 Windows 本地与 Codex 插件，不涉及迁移到其他技术栈或服务器化部署。

## 2. 目标

规范化完成后，接手者应能够：

1. 在 Windows PowerShell 中独立安装依赖并启动本地 Web 或 Codex MCP 服务。
2. 理解领域层、应用会话层、文件持久化层、MCP 适配层和 HTTP 适配层的职责边界。
3. 查明 MCP 工具、HTTP 路由、任务树数据结构和版本冲突规则。
4. 安全修改当前功能，并选择与改动范围匹配的测试、类型检查和构建命令。
5. 处理端口占用、旧服务进程、旧构建、状态文件异常、版本冲突和撤销历史失效等常见问题。
6. 明确允许扩展的接口和当前禁止突破的架构边界。
7. 使用交接清单确认本地环境、正式构建和遗留人工验收状态。

## 3. 非目标

本次工作不包含：

- 修改 MCP 工具名、HTTP 路由、任务树 JSON 结构或版本冲突语义。
- 改变任务图布局、提示词行为、快捷键或其他 UI 交互。
- 引入文档站生成器、格式化工具、部署系统或新的运行依赖。
- 设计 macOS、Linux 或服务器生产部署流程。
- 创建数据库、远程服务、WebSocket、Graphviz 或额外状态管理系统。
- 移动、重命名或重构现有源码模块。
- 将 Codex MCP PiP 人工走查标记为已完成。

## 4. 文档信息架构

正式文档位于 `plugins/plantree/docs/`，`plugins/plantree/README.md` 作为统一入口。

### 4.1 README 入口页

`plugins/plantree/README.md` 保留以下内容：

- 项目用途和运行边界。
- 五分钟快速启动流程。
- Web、API 和 MCP 的入口说明。
- 最常用的测试与构建命令。
- 文档导航。
- 不可忽略的安全边界：所有写操作传递 `expectedVersion`、节点视觉拖动不调用 `move_node`、运行时状态文件不可当作示例文件覆盖。

详细原理和长篇排障说明迁移到专题文档，避免 README 同时承担使用手册和维护手册。

### 4.2 架构说明

`plugins/plantree/docs/architecture.md` 说明：

- `server/src/domain`：计划编辑、校验、影响分析、模拟规划、模拟执行和领域类型。
- `server/src/application`：`DemoSession`、持久化状态、撤销与重做会话历史。
- `server/src/server.ts`：MCP 工具与资源适配。
- `server/src/web-api.ts` 与 `web-server.ts`：本地 HTTP 适配和监听器。
- `ui/src`：共享 React 应用、HTTP/MCP `ToolCaller`、图模型纯函数和提示词纯函数。
- MCP 与 Web 共用 `plugins/plantree/data/plantree-plan.json`，但各自进程维护独立撤销/重做栈。
- Web 统一启动器先构建服务端，再在同一个 Node.js 进程托管 API 与 Vite。

文档使用简洁数据流图表达双入口共享持久化状态的关系，不引入新的运行组件。

### 4.3 接口契约

`plugins/plantree/docs/api-contracts.md` 逐项记录：

- MCP 工具：`create_or_load_demo`、`edit_node`、`simulate_execution`、`move_node`、`undo_last_edit`、`redo_last_edit`、`reset_demo`、`render_plan_tree`。
- HTTP 路由：`GET /api/plan`、演示加载/重置、撤销、重做、节点编辑、节点移动和模拟执行。
- `edit_node` 的 `add`、`rewrite`、`expand`、`prune`、`prompt` 操作参数。
- 所有变更操作必须携带非负整数 `expectedVersion`。
- MCP 冲突通过错误结果携带最新 `snapshot`；HTTP 冲突返回 `409`、错误信息和最新 `snapshot`。
- 一般参数错误、无资源和成功响应的形式。

该文档只描述已由代码和测试确认的契约，不声明不存在的稳定性或兼容承诺。

### 4.4 数据与持久化

`plugins/plantree/docs/data-and-persistence.md` 说明：

- `PlanSnapshot`、`PlanNode`、`ValidationResult`、`AuditEntry` 的字段和枚举值。
- `childIds` 决定树顺序，`dependsOn` 表示显式依赖。
- `customPrompt` 与 `customPromptBaseVersion` 的含义。
- 运行时状态文件与可提交示例文件的区别。
- 首次读取自动创建状态文件、读取校验、`.tmp` 原子写入和失败清理。
- 计划版本和节点版本的用途。
- 撤销/重做仅存在于当前服务进程内，重启后清空；跨入口更新会使旧历史因版本冲突失效。
- 重置保留版本单调增长并清空当前进程历史。

### 4.5 开发与验证

`plugins/plantree/docs/development.md` 以 PowerShell 命令记录：

- Node.js 与 npm 前置条件。
- UI 与服务端依赖安装。
- `npm run web` 统一启动流程。
- MCP 构建和 Codex 插件入口关系。
- UI 单元测试、类型检查、Web/MCP 构建。
- 服务端单元测试和构建。
- OpenSpec 严格校验。
- 按修改范围选择最小验证集和交付前完整验证集。
- 构建产物、运行数据、依赖目录和源码目录的区别。

所有命令在文档交付前以当前项目脚本实际执行验证。

### 4.6 故障排查

`plugins/plantree/docs/troubleshooting.md` 使用“现象—原因—检查—处理”结构覆盖：

- `4174` 或 `5174` 被占用。
- 直接关闭终端造成旧进程遗留。
- 新前端连接旧服务端并出现参数不完整。
- `server/dist` 缺失或过期。
- `plantree-plan.json` 无效。
- HTTP `409` 或 MCP 版本冲突。
- 没有可撤销或可重做编辑。
- Web 正常但 Codex PiP 未显示。
- `@xyflow/react` 构建时的既有 `use client` 警告。

排障命令只检查或操作明确的 PlanTree 进程和路径，不提供宽泛的递归删除命令。

### 4.7 交接清单

`plugins/plantree/docs/handoff-checklist.md` 包含：

- 环境接手检查。
- Web、API、MCP 构建和状态文件检查。
- 接口变更、领域变更、持久化变更和 UI 协议变更对应的回归矩阵。
- 不得突破的架构边界。
- 当前 OpenSpec `graph-interactive-plantree` 状态为 `25/26`。
- 唯一待完成项为 `5.4 Codex MCP PiP` 人工走查。
- 无新增依赖、无 Git commit 的交付说明。

## 5. 轻量工程规范

在项目根目录增加 `.editorconfig`，仅声明：

- UTF-8。
- LF 换行。
- 文件末尾换行。
- 删除行末空格。
- TypeScript、JavaScript、JSON、Markdown 使用两个空格缩进；Markdown 保留有意义的行末空格。

该文件不依赖额外工具，不修改现有源码语义。除非验证发现明确错误，不调整 `package.json` 脚本、TypeScript 配置或目录结构。

复核 `plugins/plantree/.gitignore`，确保忽略规则继续覆盖：

- `node_modules/`
- `dist/`
- `data/plantree-plan.json`
- `data/plantree-plan.json.tmp`
- `*.log`

运行时计划、锁文件、示例计划和正式源码均保留。

## 6. 事实来源与一致性规则

文档内容按以下优先级核对：

1. 当前服务端和 UI 源码。
2. 自动化测试。
3. `graph-interactive-plantree` OpenSpec proposal、design、specs 和 tasks。
4. 现有 README。

如现有 README 与源码不一致，以源码和测试为准并修正文档。如 OpenSpec 与用户已确认交互不一致，以已确认交互为准，并在交接清单中记录差异。文档不得凭经验补充未实现的 API、部署能力或兼容保证。

## 7. 实施顺序

1. 读取并建立现有模块、脚本、接口、数据字段和测试的事实清单。
2. 增加 `.editorconfig`，复核忽略规则和目录职责。
3. 将 README 收敛为快速入口和文档导航。
4. 按架构、接口、数据、开发、排障和交接清单顺序编写专题文档。
5. 检查文档内链接、文件路径、命令和接口名称。
6. 执行 UI 测试、类型检查、Web/MCP 构建、服务端测试与构建、OpenSpec strict validate。
7. 检查无临时文件、无新增依赖、运行时任务树数据未被测试或整理流程意外改写。

## 8. 验收标准

满足以下条件时，规范化工作完成：

- README 能让新接手者在五分钟内找到安装、启动和完整文档入口。
- 六份专题文档均存在，互相链接正确，内容与当前实现一致。
- MCP 工具、HTTP 路由、数据结构、持久化和版本冲突规则均有明确说明。
- Windows 本地与 Codex 插件的开发、构建和排障流程完整。
- `.editorconfig` 生效范围清晰，未新增依赖或重构源码。
- UI 与服务端测试、类型检查、构建和 OpenSpec 校验全部通过。
- `plugins/plantree/data/plantree-plan.json` 保留，项目中无新的中间文件。
- OpenSpec 5.4 仍保持未完成，直至用户完成 Codex MCP PiP 人工验收。

## 9. 风险控制

- 文档漂移：接口和字段从源码及测试逐项提取，验证时再次搜索名称。
- 误删运行数据：目录整理只清理明确的临时文件，不删除状态文件、示例文件、锁文件或依赖目录。
- 过度规范化：不引入新工具，不重排源码，不扩大到团队分支、提交或发布制度。
- 人工验收被误报：交接清单明确保留 OpenSpec 5.4 未完成状态。
- Windows 命令误操作：排障命令先解析并核验目标，不使用宽泛删除或不受限进程终止。
