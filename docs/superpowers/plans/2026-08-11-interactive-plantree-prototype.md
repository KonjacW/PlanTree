# PlanTree Codex 插件小窗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可在 Codex 中安装的 PlanTree 插件，通过 MCP App Picture-in-Picture 小窗编辑任务树，并由本地 MCP 服务进行确定性局部重规划。

**Architecture:** 插件包同时包含 skill、stdio MCP 服务和 MCP App 小窗资源。MCP 服务是计划、版本、验证结果和审计日志的唯一权威来源；UI 经 MCP Apps bridge 调用工具，渲染最新结构化快照，不直接保存或篡改业务状态。

**Tech Stack:** Node.js 20、TypeScript、MCP TypeScript SDK、`@modelcontextprotocol/ext-apps`、React、esbuild、Vitest、插件脚手架与本地 marketplace。

## Global Constraints

- 交付物 MUST 是 Codex 本地插件，不得是独立网页、独立桌面应用或外部浏览器标签页。
- 任务树 MUST 以 Codex 内嵌 MCP App Picture-in-Picture 小窗呈现；小窗不可用时，MCP 数据工具 MUST 仍完整可用。
- MCP 服务 MUST 是计划、审计、撤销历史和验证结果的权威来源；UI 仅保存短暂的展示状态。
- 第一阶段 MUST 使用确定性模拟规划器，且不得访问真实 LLM、网络服务、SWE-bench、GitHub、终端、容器或代码执行环境。
- 所有编辑 MUST 经过影响范围分析、局部重规划、依赖同步、计划验证和审计追加。
- 仅 `render_plan_tree` 可以关联 UI 资源；所有数据工具 MUST 返回 `structuredContent` 和可读摘要。

---

## Planned File Structure

| 路径 | 责任 |
| --- | --- |
| `.codex-plugin/plugin.json` | 插件名称、版本、skills 与 MCP 服务入口。 |
| `skills/plantree/SKILL.md` | PlanTree 工作流的发现和工具调用规则。 |
| `server/src/domain/types.ts` | 计划、节点、命令、验证、审计的共享类型。 |
| `server/src/domain/plan.ts` | 不可变任务树读写与遍历。 |
| `server/src/domain/editor.ts` | 编辑命令与快照撤销。 |
| `server/src/domain/impact.ts` | 影响范围和反向依赖闭包。 |
| `server/src/domain/planner.ts` | 确定性局部规划与依赖同步。 |
| `server/src/domain/validator.ts` | 计划有效性与执行资格检查。 |
| `server/src/domain/executor.ts` | 单步模拟执行和阶段状态汇总。 |
| `server/src/domain/audit.ts` | 只追加审计记录。 |
| `server/src/demo/initialPlan.ts` | 稳定的缺陷修复演示树和规划模板。 |
| `server/src/session.ts` | 组织全部领域步骤的权威会话控制器。 |
| `server/src/mcp.ts` | 注册数据工具、渲染工具和 MCP App UI 资源。 |
| `ui/src/PlanTreeWidget.tsx` | PiP 小窗的任务树、编辑和状态视图。 |
| `ui/src/bridge.ts` | MCP Apps bridge 的工具调用和结果订阅。 |
| `ui/src/main.tsx` | 小窗组件入口。 |
| `tests/` 与 `ui/src/*.test.tsx` | 领域、MCP 集成和组件测试。 |

### Task 1: 创建可安装的插件骨架

**Files:**
- Create: `.codex-plugin/plugin.json`, `skills/plantree/SKILL.md`
- Create: `server/package.json`, `server/tsconfig.json`, `ui/package.json`, `ui/tsconfig.json`

**Interfaces:**
- Produces: 可被本地 marketplace 识别的插件包和 stdio MCP 服务入口声明。

- [ ] **Step 1: 使用插件脚手架创建 `plantree` 插件，并保留 manifest、skill、MCP 服务和 UI 源码的独立目录。**
- [ ] **Step 2: 在 manifest 中声明插件版本、skill 根目录和本地 MCP 服务连接，不声明网页服务器或外部 URL。**
- [ ] **Step 3: 编写 PlanTree skill，要求先创建或加载演示会话，之后调用数据工具，最后仅在需要交互时调用 `render_plan_tree`。**
- [ ] **Step 4: 为 MCP 服务配置 TypeScript、Vitest 和 MCP SDK，为 UI 配置 React、esbuild、MCP Apps bridge 与组件测试。**
- [ ] **Step 5: 将插件注册到个人 marketplace，刷新 Codex 并验证 manifest 与 skill 均可被发现。**

### Task 2: 以测试驱动建立领域模型

**Files:**
- Create: `server/src/domain/types.ts`, `server/src/domain/plan.ts`, `server/src/domain/plan.test.ts`
- Create: `server/src/demo/initialPlan.ts`, `server/src/demo/initialPlan.test.ts`

**Interfaces:**
- Produces: `Plan`、`TaskNode`、`createInitialPlan()`、`getNode()`、`getDescendants()`。

- [ ] **Step 1: 编写失败测试，断言初始计划具有一个根目标和调查、修复、测试、验证、提交说明分支。**
- [ ] **Step 2: 定义稳定节点 ID、父子关系、显式依赖、节点状态、版本和来源等领域类型。**
- [ ] **Step 3: 实现不可变节点查询、后代遍历和节点替换工具。**
- [ ] **Step 4: 增加测试，验证测试节点显式依赖修复节点，且所有节点可由根节点到达。**
- [ ] **Step 5: 运行领域测试并提交“feat: add task tree domain model”。**

### Task 3: 完成编辑、局部重规划与一致性检查

**Files:**
- Create: `server/src/domain/editor.ts`, `server/src/domain/impact.ts`, `server/src/domain/planner.ts`, `server/src/domain/validator.ts`
- Create: 对应的 `*.test.ts` 文件

**Interfaces:**
- Consumes: `Plan`、编辑命令、节点模板。
- Produces: `applyEdit()`、`calculateImpact()`、`replan()`、`synchronizeDependencies()`、`validatePlan()`。

- [ ] **Step 1: 编写编辑器失败测试，覆盖添加、非空改写、展开、裁剪、根节点保护、叶节点保护和撤销。**
- [ ] **Step 2: 实现命令驱动编辑和编辑前快照撤销；拒绝操作必须返回原计划而不递增版本。**
- [ ] **Step 3: 编写影响范围失败测试，验证编辑节点、后代和反向依赖闭包被更新，而无关分支逐字段保持不变。**
- [ ] **Step 4: 实现基于节点类型模板的纯函数模拟规划器，并测试相同输入得到相同子树和依赖。**
- [ ] **Step 5: 实现依赖同步和有效性检查，测试已裁剪依赖导致后继节点失效并阻止执行。**
- [ ] **Step 6: 运行所有领域测试并提交“feat: add deterministic replanning and validation”。**

### Task 4: 添加模拟执行、审计和会话控制器

**Files:**
- Create: `server/src/domain/executor.ts`, `server/src/domain/audit.ts`, `server/src/session.ts`
- Create: `server/src/domain/executor.test.ts`, `server/src/domain/audit.test.ts`, `server/src/session.test.ts`

**Interfaces:**
- Produces: `simulateExecution()`、`appendAudit()`、`createSession()`、`dispatchEdit()`、`undo()`、`reset()`。

- [ ] **Step 1: 编写失败测试，确认只有依赖已完成的叶节点可以执行，并在完成后汇总祖先阶段状态。**
- [ ] **Step 2: 实现模拟执行器，确保它不读取文件、不发起网络请求且不执行命令。**
- [ ] **Step 3: 编写失败测试，确认成功改写按序写入编辑、影响范围、重规划和验证审计事件。**
- [ ] **Step 4: 实现只追加审计日志，并为会话控制器串联编辑、规划、同步、验证、执行、撤销和重置。**
- [ ] **Step 5: 运行集成测试并提交“feat: add authoritative PlanTree session”。**

### Task 5: 暴露 MCP 数据工具与渲染工具

**Files:**
- Create: `server/src/mcp.ts`, `server/src/mcp.test.ts`
- Modify: `server/src/session.ts`

**Interfaces:**
- Produces: `create_or_load_demo`、`edit_node`、`simulate_execution`、`undo_last_edit`、`reset_demo`、`render_plan_tree` MCP 工具。

- [ ] **Step 1: 为每个数据工具编写输入输出 schema，输出统一包含当前计划、验证结果、最新审计记录与摘要。**
- [ ] **Step 2: 编写 MCP 集成测试，调用创建、编辑、执行、撤销和重置工具时不得返回 UI resource URI。**
- [ ] **Step 3: 实现数据工具，将请求委托给会话控制器并返回权威 `structuredContent`。**
- [ ] **Step 4: 注册 MCP App UI resource，并实现 `render_plan_tree` 作为唯一关联该资源的工具。**
- [ ] **Step 5: 编写测试，验证渲染工具返回当前快照与 UI resource URI，且服务不发生任何外部请求。**
- [ ] **Step 6: 运行 MCP 集成测试并提交“feat: expose PlanTree MCP tools”。**

### Task 6: 构建 Codex 内嵌 PiP 小窗

**Files:**
- Create: `ui/src/bridge.ts`, `ui/src/PlanTreeWidget.tsx`, `ui/src/main.tsx`
- Create: `ui/src/PlanTreeWidget.test.tsx`

**Interfaces:**
- Consumes: `render_plan_tree` 的 `structuredContent` 及 MCP Apps `tools/call` bridge。
- Produces: 可在 Codex 内显示、并经工具调用修改权威计划的小窗组件。

- [ ] **Step 1: 编写组件失败测试，使用模拟的工具结果渲染层级树、节点详情、依赖提示、有效性问题和审计日志。**
- [ ] **Step 2: 实现 bridge 层，接收 `ui/notifications/tool-result` 并通过 `tools/call` 调用数据工具。**
- [ ] **Step 3: 实现小窗组件，将选中节点、树展开状态和表单草稿作为唯一 UI 本地状态。**
- [ ] **Step 4: 增加添加、改写、展开、裁剪、撤销、模拟执行和重置控件；每次工具成功后以服务端快照刷新。**
- [ ] **Step 5: 配置最小 CSP，禁止外部连接和资源域；测试 UI 不使用外部浏览器或网络资源。**
- [ ] **Step 6: 运行组件测试并提交“feat: add PlanTree MCP App widget”。**

### Task 7: 在 Codex 中验收插件交互

**Files:**
- Create: `README.md`, `docs/demo-script.md`, `docs/plugin-test-checklist.md`

**Interfaces:**
- Consumes: 已安装的本地插件。
- Produces: 可复现的 Codex 内演示与降级验证记录。

- [ ] **Step 1: 在本地 marketplace 安装插件，在新的 Codex 会话确认 PlanTree skill 可被触发。**
- [ ] **Step 2: 走查数据工具流程：加载演示、改写调查节点、展开修复节点、裁剪修复分支、撤销、模拟执行与重置。**
- [ ] **Step 3: 调用 `render_plan_tree`，确认任务树以 Codex 会话内小窗呈现，且不会启动外部浏览器。**
- [ ] **Step 4: 在不渲染小窗的会话重复核心编辑流程，确认 Codex 能仅凭结构化工具结果继续工作。**
- [ ] **Step 5: 运行类型检查、领域测试、MCP 集成测试和组件测试；记录结果并提交“test: verify PlanTree Codex plugin”。**
