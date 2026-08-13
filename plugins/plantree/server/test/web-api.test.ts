import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DemoSession } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { createWebApi } from "../src/web-api.js";

describe("PlanTree Web API", () => {
  let server: ReturnType<typeof createServer> | undefined; let directory: string | undefined;
  afterEach(async () => { if (server?.listening) { server.close(); await once(server, "close"); } if (directory) await rm(directory, { recursive: true, force: true }); });
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
  async function start() { directory = await mkdtemp(join(tmpdir(), "plantree-api-")); const api = createWebApi(new DemoSession(new PersistentPlanStore(join(directory, "plan.json")))); server = createServer((request, response) => void api.handle(request, response)); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("未获得端口"); return `http://127.0.0.1:${address.port}`; }
});
async function request(url: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> { const response = await fetch(`${url}${path}`, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
