import type { IncomingMessage, ServerResponse } from "node:http";

import { DemoSession } from "./application/demo-session.js";
import { CodexConversationBridge } from "./application/codex-conversation-bridge.js";
import { ConversationBindingStore } from "./application/conversation-binding-store.js";
import { ExecutionRequestStore } from "./application/execution-request-store.js";
import { PlanVersionConflictError } from "./application/persistent-plan-store.js";
import { buildPlannerPrompt } from "./domain/planner-prompt.js";
import type { TaskTree } from "./domain/task-tree.js";
import { PLANTREE_RUNTIME_VERSION } from "./runtime-version.js";
import { toEditCommand } from "./server.js";

export type WebApi = { handle(request: IncomingMessage, response: ServerResponse): Promise<void> };
export function createWebApi(session = new DemoSession(), executionRequests = new ExecutionRequestStore(), conversationBindings = new ConversationBindingStore(), conversationBridge = new CodexConversationBridge()): WebApi {
  return { async handle(request, response) { try { respond(response, 200, await route(request)); } catch (error) { if (error instanceof PlanVersionConflictError) return respond(response, 409, { error: error.message, snapshot: error.snapshot }); const message = error instanceof Error ? error.message : "请求处理失败。"; respond(response, message === "未找到请求的资源。" ? 404 : 400, { error: message }); } } };
  async function route(request: IncomingMessage) {
    const url = request.url ?? "";
    if (request.method === "GET" && url === "/api/health") return { service: "plantree", version: PLANTREE_RUNTIME_VERSION };
    if (request.method === "GET" && url === "/api/plan") return session.read();
    if (request.method !== "POST") throw new Error("未找到请求的资源。");
    const input = await readJson(request);
    if (url === "/api/planner/prompt") {
      const goal = requireString(input, "goal");
      return { summary: "已生成任务树规划提示词。", plannerPrompt: buildPlannerPrompt(goal) };
    }
    if (url === "/api/execution/chain") return session.compileExecutionChain();
    if (url === "/api/execution/request") {
      const { snapshot, chain } = await session.compileExecutionChain();
      const requestedPlanId = requireString(input, "planId");
      const requestedVersion = requireNonnegativeInteger(input, "snapshotVersion");
      if (requestedPlanId !== snapshot.id || requestedVersion !== snapshot.version) {
        throw new PlanVersionConflictError(snapshot);
      }
      const binding = await conversationBindings.read();
      if (!binding) throw new Error("当前任务树尚未绑定 Codex 对话，请在创建它的对话中重新打开 PlanTree。");
      const executionRequest = await executionRequests.create(snapshot.id, snapshot.version);
      const launch = await conversationBridge.launchExecution(executionRequest, binding);
      return { summary: `已在原 Codex 对话启动新回合，将执行 ${chain.tasks.filter((task) => task.status !== "completed").length} 个剩余任务。`, request: executionRequest, launch, snapshot, chain };
    }
    const expectedVersion = requireExpectedVersion(input);
    if (url === "/api/plan/import") return session.importTaskTree(requireTree(input), expectedVersion);
    if (url === "/api/execution/next") return session.startNext(expectedVersion);
    if (url === "/api/demo/load" || url === "/api/demo/reset") return session.reset(expectedVersion);
    if (url === "/api/undo") return session.undo(expectedVersion);
    if (url === "/api/redo") return session.redo(expectedVersion);
    if (url === "/api/nodes/edit") return session.edit(toEditCommand(input as Parameters<typeof toEditCommand>[0]), expectedVersion);
    if (url === "/api/nodes/move") { if (!isMoveInput(input)) throw new Error("移动参数不完整。"); return session.move(input.nodeId, input.parentId, input.position, expectedVersion); }
    const simulation = url.match(/^\/api\/nodes\/([^/]+)\/simulate$/);
    if (simulation) return session.simulate(decodeURIComponent(simulation[1]), expectedVersion);
    const completion = url.match(/^\/api\/execution\/([^/]+)\/complete$/);
    if (completion) return session.complete(decodeURIComponent(completion[1]), expectedVersion);
    throw new Error("未找到请求的资源。");
  }
}
function requireString(input: unknown, key: string): string { if (typeof input !== "object" || input === null) throw new Error(`参数 ${key} 不完整。`); const value = (input as Record<string, unknown>)[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`参数 ${key} 不完整。`); return value; }
function requireNonnegativeInteger(input: unknown, key: string): number { if (typeof input !== "object" || input === null) throw new Error(`参数 ${key} 不完整。`); const value = (input as Record<string, unknown>)[key]; if (!Number.isInteger(value) || typeof value !== "number" || value < 0) throw new Error(`参数 ${key} 不完整。`); return value; }
function requireTree(input: unknown): TaskTree { if (typeof input !== "object" || input === null || !("tree" in input)) throw new Error("任务树参数不完整。"); return (input as { tree: TaskTree }).tree; }
function requireExpectedVersion(input: unknown): number { if (typeof input !== "object" || input === null) throw new Error("版本参数不完整。"); const value = (input as { expectedVersion?: unknown }).expectedVersion; if (!Number.isInteger(value) || typeof value !== "number" || value < 0) throw new Error("版本参数不完整。"); return value; }
function isMoveInput(input: unknown): input is { nodeId: string; parentId: string; position: number; expectedVersion: number } { return typeof input === "object" && input !== null && "nodeId" in input && typeof input.nodeId === "string" && "parentId" in input && typeof input.parentId === "string" && "position" in input && typeof input.position === "number"; }
async function readJson(request: IncomingMessage): Promise<unknown> { let body = ""; for await (const chunk of request) body += chunk; if (!body) throw new Error("请求体必须是 JSON。"); try { return JSON.parse(body); } catch { throw new Error("请求体必须是 JSON。"); } }
function respond(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
