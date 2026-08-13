import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createOrLoadDemo, DemoSession } from "./application/demo-session.js";
import { PlanVersionConflictError } from "./application/persistent-plan-store.js";
import type { EditCommand } from "./domain/plan-editor.js";
import type { PlanSnapshot } from "./domain/types.js";
import { PLAN_TREE_UI_MIME_TYPE, PLAN_TREE_UI_METADATA, PLAN_TREE_UI_RESOURCE_URI, planTreeUiHtml } from "./ui-resource.js";

export const planToolOutputSchema = z.object({ summary: z.string(), snapshot: z.record(z.string(), z.unknown()) });
export const serverMetadata = { name: "plantree-mcp", version: "0.1.0", transport: "stdio" } as const;

export function createPlanTreeServer(session = new DemoSession()): McpServer {
  const server = new McpServer({ name: serverMetadata.name, version: serverMetadata.version });
  server.registerResource("PlanTree 小窗", PLAN_TREE_UI_RESOURCE_URI, { mimeType: PLAN_TREE_UI_MIME_TYPE, _meta: PLAN_TREE_UI_METADATA }, () => ({ contents: [{ uri: PLAN_TREE_UI_RESOURCE_URI, mimeType: PLAN_TREE_UI_MIME_TYPE, text: planTreeUiHtml, _meta: PLAN_TREE_UI_METADATA }] }));
  server.registerTool("create_or_load_demo", { description: "创建或加载 PlanTree 预置缺陷修复演示会话。", outputSchema: planToolOutputSchema }, () => createOrLoadDemoToolResponse(session));
  server.registerTool("edit_node", { description: "添加、改写、展开、裁剪节点或保存人工提示词。", outputSchema: planToolOutputSchema, inputSchema: { operation: z.enum(["add", "rewrite", "expand", "prune", "prompt"]), nodeId: z.string().optional(), parentId: z.string().optional(), objective: z.string().optional(), customPrompt: z.string().optional(), node: z.object({ id: z.string(), title: z.string(), objective: z.string(), kind: z.enum(["goal", "phase", "task", "checkpoint"]), dependsOn: z.array(z.string()) }).optional(), expectedVersion: z.number().int().nonnegative() } }, (input) => editDemoToolResponse(session, toEditCommand(input), input.expectedVersion));
  server.registerTool("simulate_execution", { description: "模拟执行一个可执行叶节点。", inputSchema: { nodeId: z.string(), expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ nodeId, expectedVersion }) => simulateDemoToolResponse(session, nodeId, expectedVersion));
  server.registerTool("move_node", { description: "调整同一父节点下任务的显示顺序。", inputSchema: { nodeId: z.string(), parentId: z.string(), position: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ nodeId, parentId, position, expectedVersion }) => dataToolResponse(session.move(nodeId, parentId, position, expectedVersion)));
  server.registerTool("undo_last_edit", { description: "撤销最近一次编辑。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => undoDemoToolResponse(session, expectedVersion));
  server.registerTool("redo_last_edit", { description: "重做最近一次被撤销的编辑。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => redoDemoToolResponse(session, expectedVersion));
  server.registerTool("reset_demo", { description: "重置 PlanTree 演示会话。", inputSchema: { expectedVersion: z.number().int().nonnegative() }, outputSchema: planToolOutputSchema }, ({ expectedVersion }) => resetDemoToolResponse(session, expectedVersion));
  server.registerTool("render_plan_tree", { description: "在 Codex 内嵌小窗中渲染当前 PlanTree 计划。", inputSchema: { snapshot: z.record(z.string(), z.unknown()).optional() }, outputSchema: planToolOutputSchema, _meta: { ui: { resourceUri: PLAN_TREE_UI_RESOURCE_URI } } }, ({ snapshot }) => renderPlanTreeToolResponse(session, snapshot as PlanSnapshot | undefined));
  return server;
}

export async function createOrLoadDemoToolResponse(session: DemoSession) { return dataToolResponse(session.read()); }
export async function editDemoToolResponse(session: DemoSession, command: EditCommand, expectedVersion: number) { return dataToolResponse(session.edit(command, expectedVersion)); }
export async function undoDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.undo(expectedVersion)); }
export async function redoDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.redo(expectedVersion)); }
export async function resetDemoToolResponse(session: DemoSession, expectedVersion: number) { return dataToolResponse(session.reset(expectedVersion)); }
export async function simulateDemoToolResponse(session: DemoSession, nodeId: string, expectedVersion: number) { return dataToolResponse(session.simulate(nodeId, expectedVersion)); }
export async function renderPlanTreeToolResponse(session: DemoSession, snapshot?: PlanSnapshot) { return dataToolResponse(Promise.resolve(snapshot ? { snapshot, summary: "已准备 PlanTree 小窗渲染快照。" } : await session.read())); }

async function dataToolResponse(resultPromise: Promise<{ snapshot: PlanSnapshot; summary: string }>) {
  try { const result = await resultPromise; return { content: [{ type: "text" as const, text: result.summary }], structuredContent: { snapshot: result.snapshot, summary: result.summary } }; }
  catch (error) { if (error instanceof PlanVersionConflictError) return { isError: true, content: [{ type: "text" as const, text: error.message }], structuredContent: { snapshot: error.snapshot, summary: error.message } }; throw error; }
}

export function toEditCommand(input: { operation: "add" | "rewrite" | "expand" | "prune" | "prompt"; nodeId?: string; parentId?: string; objective?: string; customPrompt?: string; node?: { id: string; title: string; objective: string; kind: "goal" | "phase" | "task" | "checkpoint"; dependsOn: string[] } }): EditCommand {
  if (input.operation === "add" && input.parentId && input.node) return { type: "add", parentId: input.parentId, node: input.node };
  if (input.operation === "rewrite" && input.nodeId && input.objective) return { type: "rewrite", nodeId: input.nodeId, objective: input.objective };
  if (input.operation === "expand" && input.nodeId) return { type: "expand", nodeId: input.nodeId };
  if (input.operation === "prune" && input.nodeId) return { type: "prune", nodeId: input.nodeId };
  if (input.operation === "prompt" && input.nodeId) return { type: "prompt", nodeId: input.nodeId, customPrompt: input.customPrompt };
  throw new Error("编辑参数不完整。");
}
