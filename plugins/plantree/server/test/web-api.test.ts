import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DemoSession } from "../src/application/demo-session.js";
import { CodexConversationBridge } from "../src/application/codex-conversation-bridge.js";
import { ConversationBindingStore } from "../src/application/conversation-binding-store.js";
import { ExecutionRequestStore } from "../src/application/execution-request-store.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { PLANTREE_RUNTIME_VERSION } from "../src/runtime-version.js";
import { createWebApi } from "../src/web-api.js";

describe("PlanTree Web API", () => {
  let server: ReturnType<typeof createServer> | undefined; let directory: string | undefined;
  const launched: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
  afterEach(async () => { if (server?.listening) { server.close(); await once(server, "close"); } if (directory) await rm(directory, { recursive: true, force: true }); });
  it("健康检查包含当前插件版本，避免复用旧侧栏进程", async () => {
    const url = await start();
    const health = await request(url, "GET", "/api/health");
    expect(health.body).toEqual({ service: "plantree", version: PLANTREE_RUNTIME_VERSION });
  });
  it("读取、编辑和撤销使用版本化快照", async () => {
    const url = await start(); const initial = await request(url, "GET", "/api/plan"); const version = initial.body.snapshot.version;
    const edited = await request(url, "POST", "/api/nodes/edit", { operation: "prompt", nodeId: "repair", customPrompt: "人工提示词", expectedVersion: version });
    expect(edited.body.snapshot.nodes.repair.customPrompt).toBe("人工提示词");
    const undone = await request(url, "POST", "/api/undo", { expectedVersion: edited.body.snapshot.version });
    expect(undone.body.snapshot.nodes.repair.customPrompt).toBeUndefined();
    const redone = await request(url, "POST", "/api/redo", { expectedVersion: undone.body.snapshot.version });
    expect(redone.body.snapshot.nodes.repair.customPrompt).toBe("人工提示词");
  });
  it("拒绝过期写入并返回当前快照", async () => {
    const url = await start(); const initial = await request(url, "GET", "/api/plan"); const version = initial.body.snapshot.version;
    const first = await request(url, "POST", "/api/nodes/move", { nodeId: "verify", parentId: "goal", position: 0, expectedVersion: version });
    const stale = await request(url, "POST", "/api/nodes/move", { nodeId: "test", parentId: "goal", position: 0, expectedVersion: version });
    expect(first.status).toBe(200); expect(stale.status).toBe(409); expect(stale.body.snapshot).toEqual(first.body.snapshot);
  });
  it("通过 HTTP 完成目标、导入树、编译、领取和完成链式任务", async () => {
    const url = await start(); const initial = await request(url, "GET", "/api/plan");
    const prompt = await request(url, "POST", "/api/planner/prompt", { goal: "生成 mock_plan.md" });
    expect(prompt.body.plannerPrompt).toContain("生成 mock_plan.md");
    const tree = { schemaVersion: "1.0", treeId: "http-tree", rootId: "n1", nodes: [{ id: "n1", task: "生成计划" }, { id: "n2", task: "生成 mock_plan.md" }], edges: [{ id: "e1", source: "n1", target: "n2", order: 0 }] };
    const imported = await request(url, "POST", "/api/plan/import", { tree, expectedVersion: initial.body.snapshot.version });
    const compiled = await request(url, "POST", "/api/execution/chain", {});
    expect(compiled.body.chain.tasks.map((task: { nodeId: string }) => task.nodeId)).toEqual(["n2"]);
    const started = await request(url, "POST", "/api/execution/next", { expectedVersion: imported.body.snapshot.version });
    expect(started.body.task).toMatchObject({ nodeId: "n2", status: "in_progress" });
    const completed = await request(url, "POST", "/api/execution/n2/complete", { expectedVersion: started.body.snapshot.version });
    expect(completed.body).toMatchObject({ done: true, snapshot: { nodes: { n1: { status: "completed" }, n2: { status: "completed" } } } });
  });
  it("侧栏点击开始执行后写入兼容执行请求", async () => {
    const url = await start();
    const result = await request(url, "POST", "/api/execution/request", { planId: "demo-import-wizard-crash", snapshotVersion: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ request: { requestId: 1, planId: "demo-import-wizard-crash", snapshotVersion: 1 } });
    expect(result.body.launch.threadId).toBe("019ff54b-adcb-7982-880f-15db0ce32449");
    expect(launched.at(-1)?.args).toContain("019ff54b-adcb-7982-880f-15db0ce32449");
  });
  it("拒绝用过期的侧栏快照启动 Codex", async () => {
    const url = await start();
    const result = await request(url, "POST", "/api/execution/request", { planId: "stale", snapshotVersion: 0 });
    expect(result.status).toBe(409);
    expect(result.body.snapshot.id).toBe("demo-import-wizard-crash");
  });
  async function start() { directory = await mkdtemp(join(tmpdir(), "plantree-api-")); const bindings = new ConversationBindingStore(join(directory, "binding.json")); await bindings.bind("demo-import-wizard-crash", "019ff54b-adcb-7982-880f-15db0ce32449", directory); const bridge = new CodexConversationBridge(async () => "codex-test", async (command, args, options) => { launched.push({ command, args, cwd: options.cwd }); }); const api = createWebApi(new DemoSession(new PersistentPlanStore(join(directory, "plan.json"))), new ExecutionRequestStore(join(directory, "execution-request.json")), bindings, bridge); server = createServer((request, response) => void api.handle(request, response)); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("未获得端口"); return `http://127.0.0.1:${address.port}`; }
});
async function request(url: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> { const response = await fetch(`${url}${path}`, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
