import type { IncomingMessage, ServerResponse } from "node:http";

import { DemoSession } from "./application/demo-session.js";
import { PlanVersionConflictError } from "./application/persistent-plan-store.js";
import { toEditCommand } from "./server.js";

export type WebApi = { handle(request: IncomingMessage, response: ServerResponse): Promise<void> };
export function createWebApi(session = new DemoSession()): WebApi {
  return { async handle(request, response) { try { respond(response, 200, await route(request)); } catch (error) { if (error instanceof PlanVersionConflictError) return respond(response, 409, { error: error.message, snapshot: error.snapshot }); const message = error instanceof Error ? error.message : "请求处理失败。"; respond(response, message === "未找到请求的资源。" ? 404 : 400, { error: message }); } } };
  async function route(request: IncomingMessage) {
    const url = request.url ?? "";
    if (request.method === "GET" && url === "/api/plan") return session.read();
    if (request.method !== "POST") throw new Error("未找到请求的资源。");
    const input = await readJson(request); const expectedVersion = requireExpectedVersion(input);
    if (url === "/api/demo/load" || url === "/api/demo/reset") return session.reset(expectedVersion);
    if (url === "/api/undo") return session.undo(expectedVersion);
    if (url === "/api/redo") return session.redo(expectedVersion);
    if (url === "/api/nodes/edit") return session.edit(toEditCommand(input as Parameters<typeof toEditCommand>[0]), expectedVersion);
    if (url === "/api/nodes/move") { if (!isMoveInput(input)) throw new Error("移动参数不完整。"); return session.move(input.nodeId, input.parentId, input.position, expectedVersion); }
    const simulation = url.match(/^\/api\/nodes\/([^/]+)\/simulate$/);
    if (simulation) return session.simulate(decodeURIComponent(simulation[1]), expectedVersion);
    throw new Error("未找到请求的资源。");
  }
}
function requireExpectedVersion(input: unknown): number { if (typeof input !== "object" || input === null) throw new Error("版本参数不完整。"); const value = (input as { expectedVersion?: unknown }).expectedVersion; if (!Number.isInteger(value) || typeof value !== "number" || value < 0) throw new Error("版本参数不完整。"); return value; }
function isMoveInput(input: unknown): input is { nodeId: string; parentId: string; position: number; expectedVersion: number } { return typeof input === "object" && input !== null && "nodeId" in input && typeof input.nodeId === "string" && "parentId" in input && typeof input.parentId === "string" && "position" in input && typeof input.position === "number"; }
async function readJson(request: IncomingMessage): Promise<unknown> { let body = ""; for await (const chunk of request) body += chunk; if (!body) throw new Error("请求体必须是 JSON。"); try { return JSON.parse(body); } catch { throw new Error("请求体必须是 JSON。"); } }
function respond(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
