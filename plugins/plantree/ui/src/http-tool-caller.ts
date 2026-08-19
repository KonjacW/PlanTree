import type { PromptFileCopier, ToolCaller } from "./PlanTreeWindow";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PlanVersionConflictClientError extends Error {
  constructor(message: string, readonly snapshot: unknown) { super(message); }
}

export function createHttpToolCaller(baseUrl: string, fetcher: FetchLike = fetch): ToolCaller {
  return async (name, args = {}) => {
    const request = toRequest(name, args);
    const response = await fetcher(`${baseUrl}${request.path}`, request.init);
    const body = await response.json() as { error?: string };
    if (response.status === 409) throw new PlanVersionConflictClientError(body.error ?? "任务树已被其他入口更新，请刷新后重试。", (body as { snapshot?: unknown }).snapshot);
    if (!response.ok) throw new Error(body.error ?? "本地 PlanTree 服务请求失败。");
    return body;
  };
}

export function createHttpPromptFileCopier(baseUrl: string, fetcher: FetchLike = fetch): PromptFileCopier {
  return async ({ snapshot }) => {
    const response = await fetcher(`${baseUrl}/api/execution/copy`, post("/api/execution/copy", { planId: snapshot.id, snapshotVersion: snapshot.version }).init);
    const body = await response.json() as { error?: string; copied?: { fileName?: string } };
    if (!response.ok) throw new Error(body.error ?? "无法复制执行提示文件。");
    return { fileName: body.copied?.fileName ?? "plantree-prompt.md" };
  };
}

function toRequest(name: string, args: Record<string, unknown>): { path: string; init: RequestInit } {
  if (name === "move_node") return post("/api/nodes/move", args);
  if (name === "edit_node") return post("/api/nodes/edit", args);
  if (name === "compile_execution_chain") return post("/api/execution/chain", {});
  if (name === "start_next_task") return post("/api/execution/next", { expectedVersion: args.expectedVersion });
  if (name === "complete_task" && typeof args.nodeId === "string") {
    return post(`/api/execution/${encodeURIComponent(args.nodeId)}/complete`, { expectedVersion: args.expectedVersion });
  }
  if (name === "simulate_execution" && typeof args.nodeId === "string") {
    return post(`/api/nodes/${encodeURIComponent(args.nodeId)}/simulate`, { expectedVersion: args.expectedVersion });
  }
  if (name === "undo_last_edit") return post("/api/undo", { expectedVersion: args.expectedVersion });
  if (name === "redo_last_edit") return post("/api/redo", { expectedVersion: args.expectedVersion });
  if (name === "reset_demo") return post("/api/demo/reset", { expectedVersion: args.expectedVersion });
  throw new Error(`不支持的 PlanTree 命令：${name}`);
}

function post(path: string, body?: Record<string, unknown>): { path: string; init: RequestInit } {
  return {
    path,
    init: {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  };
}
