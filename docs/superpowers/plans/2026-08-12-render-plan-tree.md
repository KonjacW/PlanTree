# render_plan_tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 注册唯一的 `render_plan_tree` MCP App 渲染工具及其 `ui://plantree/plan-tree.html` 资源。

**Architecture:** 服务端继续维护权威演示会话。渲染工具返回与数据工具一致的结构化快照，但在工具定义中以 `_meta.ui.resourceUri` 关联固定资源；资源由同一 MCP 服务器用 MCP App HTML MIME 类型提供。UI 的实际 React 交互与 CSP 留给第 5 阶段。

**Tech Stack:** TypeScript、Vitest、`@modelcontextprotocol/sdk`、MCP Apps 2026-01-26 元数据约定。

## Global Constraints

- 仅使用本地 stdio MCP 服务；不得启动网页服务、外部浏览器或桌面窗口。
- 不调用网络、真实 LLM、SWE-bench、GitHub、终端代码执行器或真实项目文件操作。
- UI 资源 URI 固定为 `ui://plantree/plan-tree.html`，MIME 类型固定为 `text/html;profile=mcp-app`。
- 只有 `render_plan_tree` 可以带 `_meta.ui.resourceUri`；数据工具维持纯结构化结果。
- 测试通过 SDK 内存传输运行；先写失败测试，再写最小实现。

---

### Task 1: 渲染工具与资源注册

**Files:**
- Create: `plugins/plantree/server/src/ui-resource.ts`
- Modify: `plugins/plantree/server/src/server.ts`
- Modify: `plugins/plantree/server/test/server.test.ts`

**Interfaces:**
- Consumes: `DemoSession.read(): { snapshot: PlanSnapshot; summary: string }`。
- Produces: `PLAN_TREE_UI_RESOURCE_URI`、`PLAN_TREE_UI_MIME_TYPE`、`renderPlanTreeToolResponse(snapshot?: PlanSnapshot)`。
- Produces: MCP 工具 `render_plan_tree`，输入为可选 `snapshot: PlanSnapshot` 的 JSON 对象；未传入时读取当前会话，输出为 `{ summary, snapshot }`。

- [ ] **Step 1: 写入失败的协议级测试**

```ts
const renderTool = (await client.listTools()).tools.find(({ name }) => name === "render_plan_tree");
expect(renderTool?._meta).toMatchObject({ ui: { resourceUri: "ui://plantree/plan-tree.html" } });

const rendered = await client.callTool({ name: "render_plan_tree", arguments: {} });
expect(rendered.structuredContent).toMatchObject({
  summary: expect.any(String),
  snapshot: { id: "demo-import-wizard-crash" },
});

const resource = await client.readResource({ uri: "ui://plantree/plan-tree.html" });
expect(resource.contents).toContainEqual(expect.objectContaining({
  uri: "ui://plantree/plan-tree.html",
  mimeType: "text/html;profile=mcp-app",
}));
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- test/server.test.ts`

Expected: FAIL，因为工具列表中不存在 `render_plan_tree`，资源读取也没有注册处理器。

- [ ] **Step 3: 写入最小服务端实现**

```ts
export const PLAN_TREE_UI_RESOURCE_URI = "ui://plantree/plan-tree.html";
export const PLAN_TREE_UI_MIME_TYPE = "text/html;profile=mcp-app";

server.registerResource("PlanTree 小窗", PLAN_TREE_UI_RESOURCE_URI, {
  mimeType: PLAN_TREE_UI_MIME_TYPE,
}, () => ({ contents: [{
  uri: PLAN_TREE_UI_RESOURCE_URI,
  mimeType: PLAN_TREE_UI_MIME_TYPE,
  text: planTreeUiHtml,
}] }));

server.registerTool("render_plan_tree", {
  description: "在 Codex 内嵌小窗中渲染当前 PlanTree 计划。",
  inputSchema: { snapshot: z.record(z.string(), z.unknown()).optional() },
  outputSchema: planToolOutputSchema,
  _meta: { ui: { resourceUri: PLAN_TREE_UI_RESOURCE_URI } },
}, ({ snapshot }) => renderPlanTreeToolResponse(snapshot as PlanSnapshot | undefined));
```

- [ ] **Step 4: 运行定向测试与类型检查**

Run: `npm test -- test/server.test.ts; npm run build`

Expected: PASS，且 TypeScript 无诊断。

- [ ] **Step 5: 更新 OpenSpec 任务清单**

将 `openspec/changes/interactive-plantree-prototype/tasks.md` 中第 4.4 项更新为已完成。

- [ ] **Step 6: 提交变更**

该项目当前未初始化 Git；记录“无可用 Git 仓库，无法提交”，不执行初始化或替代性提交。
