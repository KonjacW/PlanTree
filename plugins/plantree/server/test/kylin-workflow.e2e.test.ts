import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { DemoSession } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { buildPlannerPrompt } from "../src/domain/planner-prompt.js";
import type { TaskTree } from "../src/domain/task-tree.js";
import { createPlanTreeServer } from "../src/server.js";

describe("麒麟 OS 记忆系统完整工作流", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("从总目标、人工调树到按序执行，全程不使用模拟执行", async () => {
    const goal = "制定麒麟OS手动偏好配置系统的实施计划";
    const plannerPrompt = buildPlannerPrompt(goal);
    expect(plannerPrompt).toContain(goal);
    expect(plannerPrompt).toContain('"schemaVersion": "1.0"');

    directory = await mkdtemp(join(tmpdir(), "plantree-kylin-"));
    const session = new DemoSession(new PersistentPlanStore(join(directory, "plan.json")));
    const fixtureUrl = new URL("../../data/kylin-memory-task-tree.example.json", import.meta.url);
    const tree = JSON.parse(await readFile(fixtureUrl, "utf8")) as TaskTree;
    const initial = await session.read();
    let current = await session.importTaskTree(tree, initial.snapshot.version);

    for (const nodeId of ["n3", "n10", "n11"]) {
      current = await session.edit({ type: "prune", nodeId }, current.snapshot.version);
    }
    current = await session.edit({
      type: "rewrite",
      nodeId: "n12",
      title: "生成麒麟OS手动偏好配置系统的 mock_plan.md",
      objective: "生成麒麟OS手动偏好配置系统的 mock_plan.md",
      method: "将已确认的Codex资料、配置模型、冲突协议和接入链路整理为可评审的Markdown实施计划",
      acceptance: [
        { type: "test", criterion: "工作区中存在可读取的 mock_plan.md" },
        { type: "evaluation", criterion: "文档说明手动配置与短期、中期、长期记忆之间的冲突处理方式" },
      ],
    }, current.snapshot.version);

    const compiled = await session.compileExecutionChain();
    expect(compiled.chain.tasks.map((task) => task.nodeId)).toEqual(["n4", "n5", "n7", "n8", "n9", "n12"]);
    expect(compiled.chain.tasks.map((task) => task.nodeId)).not.toEqual(expect.arrayContaining(["n3", "n10", "n11"]));
    expect(compiled.chain.tasks.at(-1)?.prompt).toContain("mock_plan.md");
    expect(compiled.chain.tasks.at(-1)?.prompt).toContain("工作区中存在可读取的 mock_plan.md");

    for (const expectedNodeId of ["n4", "n5", "n7", "n8", "n9", "n12"]) {
      const started = await session.startNext(current.snapshot.version);
      expect(started.done).toBe(false);
      expect(started.task?.nodeId).toBe(expectedNodeId);
      expect(started.task?.status).toBe("in_progress");
      expect(started.task?.prompt).toContain("### 任务");
      expect(started.task?.prompt).not.toMatch(/节点 n\d+|第 \d+\/\d+ 个任务|父节点：|子节点：|前置依赖：/);
      const completed = await session.complete(expectedNodeId, started.snapshot.version);
      expect(completed.snapshot.nodes[expectedNodeId].status).toBe("completed");
      current = completed;
    }

    const finished = await session.startNext(current.snapshot.version);
    expect(finished.done).toBe(true);
    expect(finished.snapshot.nodes.n1.status).toBe("completed");
    expect(finished.snapshot.nodes.n2.status).toBe("completed");
    expect(finished.snapshot.nodes.n6.status).toBe("completed");
    expect(finished.snapshot.nodes.n3.status).toBe("skipped");
    expect(finished.snapshot.audit.filter((entry) => entry.type === "execution_started")).toHaveLength(6);
    expect(finished.snapshot.audit.filter((entry) => entry.type === "execution_completed")).toHaveLength(6);
  });

  it("Codex 可只通过 MCP 工具完成同一条非模拟链路", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-kylin-mcp-"));
    const session = new DemoSession(new PersistentPlanStore(join(directory, "plan.json")));
    const server = createPlanTreeServer(session);
    const client = new Client({ name: "kylin-e2e", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tree = JSON.parse(await readFile(new URL("../../data/kylin-memory-task-tree.example.json", import.meta.url), "utf8")) as TaskTree;
      const prompt = await client.callTool({ name: "build_planner_prompt", arguments: { goal: "制定麒麟OS手动偏好配置系统的实施计划" } });
      expect((prompt.structuredContent as { plannerPrompt: string }).plannerPrompt).toContain("只输出一个合法 JSON 对象");
      let version = (await session.read()).snapshot.version;
      const imported = await client.callTool({ name: "import_task_tree", arguments: { tree, expectedVersion: version } });
      version = (imported.structuredContent as any).snapshot.version;
      for (const nodeId of ["n3", "n10", "n11"]) {
        const edited = await client.callTool({ name: "edit_node", arguments: { operation: "prune", nodeId, expectedVersion: version } });
        version = (edited.structuredContent as any).snapshot.version;
      }
      const rewritten = await client.callTool({ name: "edit_node", arguments: { operation: "rewrite", nodeId: "n12", title: "生成麒麟OS手动偏好配置系统的 mock_plan.md", objective: "生成麒麟OS手动偏好配置系统的 mock_plan.md", method: "整理已确认设计为Markdown实施计划", acceptance: [{ type: "test", criterion: "工作区中存在可读取的 mock_plan.md" }], expectedVersion: version } });
      version = (rewritten.structuredContent as any).snapshot.version;
      const compiled = await client.callTool({ name: "compile_execution_chain", arguments: {} });
      expect((compiled.structuredContent as any).chain.tasks.map((task: { nodeId: string }) => task.nodeId)).toEqual(["n4", "n5", "n7", "n8", "n9", "n12"]);

      for (const nodeId of ["n4", "n5", "n7", "n8", "n9", "n12"]) {
        const started = await client.callTool({ name: "start_next_task", arguments: { expectedVersion: version } });
        expect((started.structuredContent as any).task.nodeId).toBe(nodeId);
        version = (started.structuredContent as any).snapshot.version;
        const completed = await client.callTool({ name: "complete_task", arguments: { nodeId, expectedVersion: version } });
        version = (completed.structuredContent as any).snapshot.version;
      }
      const done = await client.callTool({ name: "start_next_task", arguments: { expectedVersion: version } });
      expect((done.structuredContent as any).done).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
