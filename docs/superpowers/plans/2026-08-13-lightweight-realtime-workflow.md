# PlanTree 轻量实时工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有版本化 JSON 计划树上增加四阶段、依赖编辑、提示词审阅与 HTTP JSON + SSE JSON 实时同步。

**Architecture:** 后端继续作为唯一权威，持久化扩展后的 `PlanSnapshot` 并执行阶段、依赖、提示词和执行规则；HTTP JSON 接收用户命令，SSE JSON 广播完整快照与进度。前端复用现有 React 窗口和 CSS，维护仅限选中、视图和未提交文本草稿的本地状态。

**Tech Stack:** TypeScript、Node `http`、SSE、React 19、Vitest、现有 MCP/HTTP `ToolCaller`。

## Global Constraints

- 保留 MCP 工具、现有 HTTP 路由、状态文件和 `expectedVersion` 冲突规则。
- 前端不得直接写 JSON 状态文件，不得自行判定 Agent 完成或提示词有效性。
- 第一版只支持详情面板内增删依赖，不做自由拉线或拖拽创建边。
- 任一入口（HTTP、MCP 或 Agent）写入状态文件后都由状态写入层触发 SSE 完整快照；重连后 `GET /api/plan` 重新获取快照。
- 人工确认的提示词永不被自动覆盖，Agent 只写建议提示词。
- 不引入 WebSocket、事件回放、命令队列、插件注册表或独立设计系统。

---

## 文件结构

- `plugins/plantree/server/src/domain/types.ts`：扩展阶段、提示词、执行与关系领域类型。
- `plugins/plantree/server/src/domain/workflow.ts`：纯阶段门禁、受影响节点与依赖校验。
- `plugins/plantree/server/src/application/demo-session.ts`：所有命令的权威编排和 JSON 写入。
- `plugins/plantree/server/src/application/persistent-plan-store.ts`：写入后通知订阅者，供所有入口统一实时广播。
- `plugins/plantree/server/src/web-api.ts`：`/api/commands`、`/api/events` 和事件广播。
- `plugins/plantree/server/test/workflow.test.ts`：领域规则单测。
- `plugins/plantree/server/test/web-api.test.ts`：HTTP JSON、409、SSE 端点测试。
- `plugins/plantree/ui/src/plan-api.ts`：轻量 HTTP/SSE 客户端。
- `plugins/plantree/ui/src/PlanTreeWindow.tsx`：阶段轨道、依赖编辑、提示词审阅、执行入口。
- `plugins/plantree/ui/src/PlanTreeWindow.css`：复用现有颜色与按钮样式的新增区域。
- `plugins/plantree/ui/src/plan-api.test.ts`：客户端命令与 SSE 解析测试。
- `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`：阶段门禁、草稿保护与依赖编辑 UI 测试。

### Task 1: 扩展权威 JSON 领域模型

**Files:**
- Modify: `plugins/plantree/server/src/domain/types.ts`
- Create: `plugins/plantree/server/src/domain/workflow.ts`
- Create: `plugins/plantree/server/test/workflow.test.ts`

**Interfaces:**
- Produces: `WorkflowPhase`、`PromptRecord`、`PlanRelation`、`getRelations(snapshot)`、`affectedPromptNodeIds(snapshot, changedIds)`、`validateDependencyChange(snapshot, nodeId, dependsOn)`。

- [ ] **Step 1: 写失败测试**

```ts
it("修改节点依赖时标记后代与依赖者的提示词为过期", () => {
  const affected = affectedPromptNodeIds(snapshot, ["repair"]);
  expect(affected).toEqual(expect.arrayContaining(["repair", "locate", "implement", "test"]));
});

it("拒绝环形依赖", () => {
  expect(() => validateDependencyChange(snapshot, "repair", ["implement"])).toThrow("环形依赖");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- workflow.test.ts`（在 `plugins/plantree/server`）

- [ ] **Step 3: 实现最小领域类型与纯函数**

```ts
export type WorkflowPhase = "structure_draft" | "structure_review" | "prompt_generation" | "prompt_review_execution";
export type PromptStatus = "missing" | "draft" | "confirmed" | "stale";
export type PlanRelation = { id: string; from: string; to: string; type: "tree" | "dependency" };
```

在 `PlanSnapshot` 新增 `phase`、`prompts`、`execution` 的可选兼容字段；以 `parentId` 和 `dependsOn` 生成关系数组，不迁移现有 JSON 结构。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- workflow.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/plantree/server/src/domain plugins/plantree/server/test/workflow.test.ts
git commit -m "feat: add lightweight workflow domain"
```

### Task 2: 在会话层实现阶段、依赖和提示词命令

**Files:**
- Modify: `plugins/plantree/server/src/application/demo-session.ts`
- Modify: `plugins/plantree/server/src/domain/plan-validation.ts`
- Modify: `plugins/plantree/server/test/demo-session.test.ts`

**Interfaces:**
- Consumes: Task 1 领域函数。
- Produces: `DemoSession.command(command, expectedVersion)`，支持 `add_dependency`、`remove_dependency`、`generate_prompts`、`save_prompt`、`accept_suggested_prompt`、`execute_node_and_stop`、`return_to_structure_review`；旧 MCP/HTTP 入口均委托给它。

- [ ] **Step 1: 写失败测试**

```ts
it("保存人工提示词后生成建议不会覆盖确认文本", async () => {
  await value.command({ type: "save_prompt", nodeId: "repair", text: "人工文本" }, version);
  const result = await value.command({ type: "generate_prompts", nodeIds: ["repair"] }, nextVersion);
  expect(result.snapshot.prompts.repair.confirmedPrompt).toBe("人工文本");
  expect(result.snapshot.prompts.repair.suggestedPrompt).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- demo-session.test.ts`

- [ ] **Step 3: 实现命令分发和服务端规则**

每个变更先检查 `planId`、`commandId`、`expectedVersion`，再检查阶段和未执行限制，最后调用 `PersistentPlanStore.write`。依赖变更更新 `dependsOn` 并仅标记目标节点提示词为 `stale`；结构变更标记变更节点及其未执行后代；生成只写 `suggestedPrompt`；执行节点后写 `stopped` 状态并允许返回结构审阅。已完成节点第一版拒绝编辑，不实现返工命令。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- demo-session.test.ts workflow.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/plantree/server/src/application/demo-session.ts plugins/plantree/server/src/domain/plan-validation.ts plugins/plantree/server/test/demo-session.test.ts
git commit -m "feat: add workflow commands"
```

### Task 3: 增加 HTTP JSON 命令与 SSE 快照事件

**Files:**
- Modify: `plugins/plantree/server/src/web-api.ts`
- Create: `plugins/plantree/server/test/web-api.test.ts`

**Interfaces:**
- Consumes: `DemoSession.command`。
- Produces: `POST /api/commands`、`GET /api/events`；SSE 事件 `snapshot`、`progress`、`error`。

- [ ] **Step 1: 写失败测试**

```ts
it("MCP 与 HTTP 写入后均广播完整快照", async () => {
  const events = openEvents(api);
  const response = await post(api, "/api/commands", { planId: "demo-import-wizard-crash", commandId: "a", expectedVersion: 1, type: "add_dependency", payload: { nodeId: "verify", dependsOn: "repair" } });
  expect(response.status).toBe(200);
  expect(await events.next()).toContain("event: snapshot");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- web-api.test.ts`

- [ ] **Step 3: 实现最小 SSE 广播器**

在 `PersistentPlanStore` 增加写入订阅；`createWebApi` 内维护已连接 `ServerResponse` 集合并订阅该通知；`/api/events` 写入 `text/event-stream` 和连接保活头。写入由 HTTP、MCP 或 Agent 发起时都从 store 广播 `snapshot`。`/api/commands` 与旧路由均调用同一个 `DemoSession.command` 分发函数。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- web-api.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/plantree/server/src/web-api.ts plugins/plantree/server/test/web-api.test.ts
git commit -m "feat: stream plan snapshots over sse"
```

### Task 4: 添加前端轻量 API 适配器

**Files:**
- Create: `plugins/plantree/ui/src/plan-api.ts`
- Create: `plugins/plantree/ui/src/plan-api.test.ts`

**Interfaces:**
- Produces: `loadPlan(planId)`、`sendCommand(command)`、`subscribeToPlanEvents(planId, onEvent)`。

- [ ] **Step 1: 写失败测试**

```ts
it("将命令编码为 JSON 并在 409 时返回服务端快照", async () => {
  await expect(api.sendCommand(command)).rejects.toMatchObject({ snapshot });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- plan-api.test.ts`（在 `plugins/plantree/ui`）

- [ ] **Step 3: 实现薄客户端**

`sendCommand` 调用 `/api/commands` 并始终编码 `planId`、`commandId`、`expectedVersion`；`subscribeToPlanEvents` 用 `EventSource` 监听三个事件类型；收到 `snapshot` 直接交给调用方。断线由 `EventSource` 自动重连，组件重连后调用 `loadPlan`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- plan-api.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/plantree/ui/src/plan-api.ts plugins/plantree/ui/src/plan-api.test.ts
git commit -m "feat: add plan json api client"
```

### Task 5: 将现有窗口演进为四阶段界面

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.tsx`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.css`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`

**Interfaces:**
- Consumes: `PlanSnapshot`、`PlanRelation`、Task 4 的 API 函数。
- Produces: 阶段轨道、节点详情依赖增删、提示词建议/确认编辑、单节点执行停止与本地草稿保护。

- [ ] **Step 1: 写失败测试**

```tsx
it("在结构审阅中可添加依赖但不提供自由连线", async () => {
  render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);
  await user.selectOptions(screen.getByLabelText("添加前置依赖"), "repair");
  await user.click(screen.getByRole("button", { name: "添加依赖" }));
  expect(caller).toHaveBeenCalledWith("command", expect.objectContaining({ type: "add_dependency" }));
  expect(screen.queryByLabelText("创建连线")).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- PlanTreeWindow.test.tsx`

- [ ] **Step 3: 最小化 UI 实现**

在现有头部加入四阶段标签；仅当前阶段可用操作可点击。节点详情添加依赖下拉和删除按钮；提示词区按 `suggestedPrompt` / `confirmedPrompt` 显示“采纳、保存、保留”操作；`textarea` 本地草稿在新快照到达时不覆盖。活动信息仅显示最新一条进度摘要；执行输出第一版不建立独立流。已完成节点的编辑入口禁用并说明原因。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- PlanTreeWindow.test.tsx plan-api.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/plantree/ui/src/PlanTreeWindow.tsx plugins/plantree/ui/src/PlanTreeWindow.css plugins/plantree/ui/src/PlanTreeWindow.test.tsx
git commit -m "feat: add lightweight workflow interface"
```

### Task 6: 验证兼容性与构建

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-plan-execution-workflow-design.md`

- [ ] **Step 1: 运行服务端完整测试和构建**

Run: `npm test && npm run build`（在 `plugins/plantree/server`）

- [ ] **Step 2: 运行前端完整测试、类型检查和构建**

Run: `npm test && npm run typecheck && npm run build`（在 `plugins/plantree/ui`）

- [ ] **Step 3: 手动冒烟验证**

启动本地服务，验证 JSON 命令更新树、SSE 推送完整快照、依赖编辑被后端校验、人工提示词不被建议覆盖、执行后可回到结构审阅。

- [ ] **Step 4: 更新规范验收结果并 Commit**

```bash
git add docs/superpowers/specs/2026-08-13-plan-execution-workflow-design.md
git commit -m "docs: record lightweight workflow validation"
```
