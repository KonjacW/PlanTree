import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createOrLoadDemo, DemoSession } from "./application/demo-session.js";
import { CodexConversationBridge } from "./application/codex-conversation-bridge.js";
import { ConversationBindingStore } from "./application/conversation-binding-store.js";
import { ExecutionRequestStore } from "./application/execution-request-store.js";
import { PlanVersionConflictError } from "./application/persistent-plan-store.js";
import { buildPlannerPrompt } from "./domain/planner-prompt.js";
import type { EditCommand } from "./domain/plan-editor.js";
import type { TaskTree } from "./domain/task-tree.js";
import type { PlanSnapshot } from "./domain/types.js";
import { ensurePlanTreeSidebar } from "./sidebar-runtime.js";

export const planToolOutputSchema = z.object({ summary: z.string(), snapshot: z.record(z.string(), z.unknown()) });
export const executionToolOutputSchema = planToolOutputSchema.extend({
  chain: z.record(z.string(), z.unknown()),
  task: z.record(z.string(), z.unknown()).optional(),
  done: z.boolean().optional(),
});
export const plannerPromptOutputSchema = z.object({ summary: z.string(), plannerPrompt: z.string() });
export const sidebarToolOutputSchema = planToolOutputSchema.extend({ url: z.string().url(), requestId: z.number().int().nonnegative() });
export const executionRequestOutputSchema = z.object({
  summary: z.string(),
  requested: z.boolean(),
  requestId: z.number().int().nonnegative(),
  planId: z.string().optional(),
  snapshotVersion: z.number().int().nonnegative().optional(),
});
const acceptanceSchema = z.object({ type: z.enum(["test", "metric", "evaluation"]), criterion: z.string().min(1) });
const taskTreeSchema = z.object({
  schemaVersion: z.literal("1.0"),
  treeId: z.string().min(1),
  rootId: z.string().min(1),
  nodes: z.array(z.object({ id: z.string().min(1), task: z.string().min(1), method: z.string().min(1).optional(), acceptance: z.array(acceptanceSchema).min(1).optional() })).min(1),
  edges: z.array(z.object({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1), order: z.number().int().nonnegative() })),
});
const editableNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  kind: z.enum(["goal", "phase", "task", "checkpoint"]),
  dependsOn: z.array(z.string()),
  method: z.string().optional(),
  acceptance: z.array(acceptanceSchema).optional(),
});
export const serverMetadata = { name: "plantree-mcp", version: "0.1.0", transport: "stdio" } as const;

type SidebarOpener = (session: DemoSession, requestStore: ExecutionRequestStore, bindingStore: ConversationBindingStore, bridge: CodexConversationBridge) => Promise<string>;

export function createPlanTreeServer(
  session = new DemoSession(),
  executionRequests = new ExecutionRequestStore(),
  openSidebar: SidebarOpener = ensurePlanTreeSidebar,
  conversationBindings = new ConversationBindingStore(),
  conversationBridge = new CodexConversationBridge(),
): McpServer {
  const server = new McpServer({ name: serverMetadata.name, version: serverMetadata.version });
  server.registerTool("build_planner_prompt", { description: "根据用户总目标生成 TaskTree JSON 规划提示词。", inputSchema: { goal: z.string().min(1) }, outputSchema: plannerPromptOutputSchema }, ({ goal }) => plannerPromptToolResponse(goal));
  server.registerTool("import_task_tree", { description: "导入 Codex 生成的 TaskTree JSON，供用户在 PlanTree UI 中调整。", inputSchema: { tree: taskTreeSchema, expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ tree, expectedVersion }) => dataToolResponse(session.importTaskTree(tree as TaskTree, expectedVersion)));
  server.registerTool("create_or_load_demo", { description: "创建或加载 PlanTree 预置缺陷修复演示会话。", outputSchema: planToolOutputSchema }, () => createOrLoadDemoToolResponse(session));
  server.registerTool("edit_node", { description: "添加、改写、展开或裁剪节点内容。rewrite 可编辑任务、方法和验收；method=null 表示清除方法。", outputSchema: planToolOutputSchema, inputSchema: { operation: z.enum(["add", "rewrite", "expand", "prune", "prompt"]), nodeId: z.string().optional(), parentId: z.string().optional(), title: z.string().optional(), objective: z.string().optional(), method: z.string().nullable().optional(), acceptance: z.array(acceptanceSchema).optional(), customPrompt: z.string().optional(), node: editableNodeSchema.optional(), expectedVersion: z.number().int().nonnegative() } }, (input) => editDemoToolResponse(session, toEditCommand(input), input.expectedVersion));
  server.registerTool("compile_execution_chain", { description: "把用户确认后的树按深度优先叶节点顺序编译成可依次注入 Codex 的任务链。", outputSchema: executionToolOutputSchema }, () => executionToolResponse(session.compileExecutionChain()));
  server.registerTool("start_next_task", { description: "领取执行链中的下一项，并将对应节点标记为执行中。返回的 task.prompt 是当前应执行的唯一提示词。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: executionToolOutputSchema }, ({ expectedVersion }) => executionToolResponse(session.startNext(expectedVersion)));
  server.registerTool("complete_task", { description: "在 Codex 完成当前任务后确认该节点完成，并推进到下一任务。", inputSchema: { nodeId: z.string(), expectedVersion: z.number().int().nonnegative() }, outputSchema: executionToolOutputSchema }, ({ nodeId, expectedVersion }) => executionToolResponse(session.complete(nodeId, expectedVersion)));
  server.registerTool("simulate_execution", { description: "模拟执行一个可执行叶节点。", inputSchema: { nodeId: z.string(), expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ nodeId, expectedVersion }) => simulateDemoToolResponse(session, nodeId, expectedVersion));
  server.registerTool("move_node", { description: "调整同一父节点下任务的显示顺序。", inputSchema: { nodeId: z.string(), parentId: z.string(), position: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ nodeId, parentId, position, expectedVersion }) => dataToolResponse(session.move(nodeId, parentId, position, expectedVersion)));
  server.registerTool("undo_last_edit", { description: "撤销最近一次编辑。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => undoDemoToolResponse(session, expectedVersion));
  server.registerTool("redo_last_edit", { description: "重做最近一次被撤销的编辑。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => redoDemoToolResponse(session, expectedVersion));
  server.registerTool("reset_demo", { description: "重置 PlanTree 演示会话。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => resetDemoToolResponse(session, expectedVersion));
  server.registerTool("render_plan_tree", { description: "启动 PlanTree 侧栏任务树，并把计划绑定到当前 Codex 对话；用户点击执行后会在同一对话启动新回合。", inputSchema: { snapshot: z.record(z.string(), z.unknown()).optional() }, outputSchema: sidebarToolOutputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }, (_input, extra) => renderPlanTreeToolResponse(session, executionRequests, conversationBindings, conversationBridge, extra, openSidebar));
  server.registerTool("wait_for_execution_request", { description: "兼容旧客户端：等待侧栏提交执行请求。正常流程由按钮自动恢复原 Codex 对话，无需调用本工具。", inputSchema: { afterRequestId: z.number().int().nonnegative(), timeoutSeconds: z.number().int().min(1).max(55).default(55) }, outputSchema: executionRequestOutputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, ({ afterRequestId, timeoutSeconds }) => waitForExecutionRequestToolResponse(executionRequests, afterRequestId, timeoutSeconds));
  return server;
}

export async function createOrLoadDemoToolResponse(session: DemoSession) { return dataToolResponse(session.read()); }
export async function editDemoToolResponse(session: DemoSession, command: EditCommand, expectedVersion: number) { return dataToolResponse(session.edit(command, expectedVersion)); }
export async function undoDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.undo(expectedVersion)); }
export async function redoDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.redo(expectedVersion)); }
export async function resetDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.reset(expectedVersion)); }
export async function simulateDemoToolResponse(session: DemoSession, nodeId: string, expectedVersion: number) { return dataToolResponse(session.simulate(nodeId, expectedVersion)); }
export async function renderPlanTreeToolResponse(
  session: DemoSession,
  executionRequests: ExecutionRequestStore,
  conversationBindings: ConversationBindingStore,
  conversationBridge: CodexConversationBridge,
  requestContext: unknown,
  openSidebar: SidebarOpener = ensurePlanTreeSidebar,
) {
  const { snapshot } = await session.read();
  const binding = extractConversationBinding(requestContext);
  if (!binding) throw new Error("Codex 未向 PlanTree 提供当前对话标识，无法保证执行回复进入正确对话。");
  await conversationBindings.bind(snapshot.id, binding.threadId, binding.cwd);
  const [request, url] = await Promise.all([
    executionRequests.read(),
    openSidebar(session, executionRequests, conversationBindings, conversationBridge),
  ]);
  const summary = "PlanTree 本地 UI 已启动并绑定当前 Codex 对话；请编辑任务树，确认后点击开始自动执行。";
  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "resource_link" as const, name: "打开 PlanTree 交互任务树", uri: url, description: "在 Codex 侧栏查看、编辑并确认任务树。", mimeType: "text/html" },
    ],
    structuredContent: { snapshot, summary, url, requestId: request.requestId },
  };
}

export function extractConversationBinding(requestContext: unknown): { threadId: string; cwd: string } | undefined {
  if (typeof requestContext !== "object" || requestContext === null) return undefined;
  const context = requestContext as Record<string, unknown>;
  const meta = typeof context._meta === "object" && context._meta !== null ? context._meta as Record<string, unknown> : {};
  const turnMeta = typeof meta["x-codex-turn-metadata"] === "object" && meta["x-codex-turn-metadata"] !== null
    ? meta["x-codex-turn-metadata"] as Record<string, unknown>
    : {};
  const threadId = firstNonemptyString(meta.threadId, meta.thread_id, turnMeta.thread_id, turnMeta.threadId);
  if (!threadId) return undefined;
  return { threadId, cwd: firstNonemptyString(turnMeta.cwd, meta.cwd) ?? process.cwd() };
}

function firstNonemptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

export async function waitForExecutionRequestToolResponse(executionRequests: ExecutionRequestStore, afterRequestId: number, timeoutSeconds: number) {
  const request = await executionRequests.waitAfter(afterRequestId, timeoutSeconds);
  if (!request) {
    const summary = "尚未收到侧栏的自动执行请求。";
    return { content: [{ type: "text" as const, text: summary }], structuredContent: { summary, requested: false, requestId: afterRequestId } };
  }
  const summary = `已收到计划“${request.planId}”的自动执行请求。`;
  return { content: [{ type: "text" as const, text: summary }], structuredContent: { summary, requested: true, requestId: request.requestId, planId: request.planId, snapshotVersion: request.snapshotVersion } };
}

export function plannerPromptToolResponse(goal: string) {
  const plannerPrompt = buildPlannerPrompt(goal);
  return { content: [{ type: "text" as const, text: plannerPrompt }], structuredContent: { summary: "已生成任务树规划提示词。", plannerPrompt } };
}

export async function executionToolResponse(resultPromise: ReturnType<DemoSession["compileExecutionChain"]> | ReturnType<DemoSession["startNext"]> | ReturnType<DemoSession["complete"]>) {
  return richDataToolResponse(resultPromise);
}

async function dataToolResponse(resultPromise: Promise<{ snapshot: PlanSnapshot; summary: string }>) {
  try { const result = await resultPromise; return { content: [{ type: "text" as const, text: result.summary }], structuredContent: { snapshot: result.snapshot, summary: result.summary } }; }
  catch (error) { if (error instanceof PlanVersionConflictError) return { isError: true, content: [{ type: "text" as const, text: error.message }], structuredContent: { snapshot: error.snapshot, summary: error.message } }; throw error; }
}

async function richDataToolResponse(resultPromise: Promise<{ snapshot: PlanSnapshot; summary: string; chain: unknown; task?: unknown; done?: boolean }>) {
  try { const result = await resultPromise; return { content: [{ type: "text" as const, text: result.summary }], structuredContent: result }; }
  catch (error) { if (error instanceof PlanVersionConflictError) return { isError: true, content: [{ type: "text" as const, text: error.message }], structuredContent: { snapshot: error.snapshot, summary: error.message, chain: {} } }; throw error; }
}

export function toEditCommand(input: { operation: "add" | "rewrite" | "expand" | "prune" | "prompt"; nodeId?: string; parentId?: string; title?: string; objective?: string; method?: string | null; acceptance?: readonly { type: "test" | "metric" | "evaluation"; criterion: string }[]; customPrompt?: string; node?: { id: string; title: string; objective: string; kind: "goal" | "phase" | "task" | "checkpoint"; dependsOn: string[]; method?: string; acceptance?: readonly { type: "test" | "metric" | "evaluation"; criterion: string }[] } }): EditCommand {
  if (input.operation === "add" && input.parentId && input.node) return { type: "add", parentId: input.parentId, node: input.node };
  if (input.operation === "rewrite" && input.nodeId && input.objective) return { type: "rewrite", nodeId: input.nodeId, objective: input.objective, ...(input.title === undefined ? {} : { title: input.title }), ...(input.method === undefined ? {} : { method: input.method }), ...(input.acceptance === undefined ? {} : { acceptance: input.acceptance }) };
  if (input.operation === "expand" && input.nodeId) return { type: "expand", nodeId: input.nodeId };
  if (input.operation === "prune" && input.nodeId) return { type: "prune", nodeId: input.nodeId };
  if (input.operation === "prompt" && input.nodeId) return { type: "prompt", nodeId: input.nodeId, customPrompt: input.customPrompt };
  throw new Error("编辑参数不完整。");
}
