import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoSession } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { createPlanTreeServer, planToolOutputSchema, serverMetadata } from "../src/server.js";
import { planTreeUiHtml } from "../src/ui-resource.js";

describe("PlanTree MCP 服务配置", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("发布构建提供可直接启动的 JavaScript 入口", async () => {
    const serverDirectory = fileURLToPath(new URL("..", import.meta.url));
    await expect(access(join(serverDirectory, "dist", "index.js"))).resolves.toBeUndefined();
  });
  it("声明仅使用本地 stdio 通信", () => { expect(serverMetadata).toEqual({ name: "plantree-mcp", version: "0.1.0", transport: "stdio" }); });
  it("变更工具要求版本，读取与版本化编辑返回结构化快照", async () => {
    const { client, close } = await connect();
    try {
      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "move_node")?.inputSchema).toMatchObject({ properties: { expectedVersion: expect.any(Object) }, required: expect.arrayContaining(["expectedVersion"]) });
      expect(tools.tools.find((tool) => tool.name === "redo_last_edit")?.inputSchema).toMatchObject({ properties: { expectedVersion: expect.any(Object) }, required: expect.arrayContaining(["expectedVersion"]) });
      const initial = await client.callTool({ name: "create_or_load_demo", arguments: {} });
      const version = (initial.structuredContent as any).snapshot.version;
      expect(planToolOutputSchema.safeParse(initial.structuredContent).success).toBe(true);
      const edited = await client.callTool({ name: "edit_node", arguments: { operation: "prompt", nodeId: "repair", customPrompt: "人工提示词", expectedVersion: version } });
      expect((edited.structuredContent as any).snapshot.nodes.repair.customPrompt).toBe("人工提示词");
      const undone = await client.callTool({ name: "undo_last_edit", arguments: { expectedVersion: (edited.structuredContent as any).snapshot.version } });
      const redone = await client.callTool({ name: "redo_last_edit", arguments: { expectedVersion: (undone.structuredContent as any).snapshot.version } });
      expect((redone.structuredContent as any).snapshot.nodes.repair.customPrompt).toBe("人工提示词");
    } finally { await close(); }
  });
  it("过期版本的 MCP 变更返回最新快照而不覆盖", async () => {
    const { client, close } = await connect();
    try {
      const initial = await client.callTool({ name: "create_or_load_demo", arguments: {} }); const version = (initial.structuredContent as any).snapshot.version;
      const first = await client.callTool({ name: "move_node", arguments: { nodeId: "verify", parentId: "goal", position: 0, expectedVersion: version } });
      const stale = await client.callTool({ name: "move_node", arguments: { nodeId: "test", parentId: "goal", position: 0, expectedVersion: version } });
      expect(stale.isError).toBe(true); expect(stale.content).toContainEqual(expect.objectContaining({ text: "任务树已被其他入口更新，请刷新后重试。" }));
      expect((stale.structuredContent as any).snapshot).toEqual((first.structuredContent as any).snapshot);
    } finally { await close(); }
  });
  it("只由渲染工具关联 PlanTree 小窗资源", async () => {
    const { client, close } = await connect();
    try { const tools = await client.listTools(); const render = tools.tools.find((tool) => tool.name === "render_plan_tree"); expect(render?._meta).toMatchObject({ ui: { resourceUri: "ui://plantree/plan-tree.html" } }); expect((await client.callTool({ name: "render_plan_tree", arguments: {} })).isError).not.toBe(true); } finally { await close(); }
  });
  it("MCP 小窗资源内嵌同一 React 任务图应用", () => {
    expect(planTreeUiHtml).toContain("PlanTree · 任务树");
    expect(planTreeUiHtml).toContain("<script type=\"module\">");
    expect(planTreeUiHtml).toContain("plantree-window");
  });
  it("MCP 路径不发起外部网络请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("不应调用外部网络")); const { client, close } = await connect();
    try { await client.callTool({ name: "create_or_load_demo", arguments: {} }); expect(fetchSpy).not.toHaveBeenCalled(); } finally { await close(); fetchSpy.mockRestore(); }
  });
  async function connect() {
    directory = await mkdtemp(join(tmpdir(), "plantree-mcp-")); const server = createPlanTreeServer(new DemoSession(new PersistentPlanStore(join(directory, "plan.json")))); const client = new Client({ name: "test", version: "1" }); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]); return { client, close: async () => Promise.all([client.close(), server.close()]) };
  }
});
