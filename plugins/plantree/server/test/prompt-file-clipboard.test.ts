import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoSession } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { buildPromptFile, PromptFileClipboard } from "../src/application/prompt-file-clipboard.js";

describe("提示文件剪贴板", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("只写入剩余任务，并把 Markdown 文件对象交给剪贴板写入器", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-clipboard-"));
    const filePath = join(directory, "plantree-prompt.md");
    const writer = vi.fn().mockResolvedValue(undefined);
    const session = new DemoSession(new PersistentPlanStore(join(directory, "plan.json")));
    const { snapshot, chain } = await session.compileExecutionChain();

    await expect(new PromptFileClipboard(filePath, writer).copy(snapshot, chain)).resolves.toMatchObject({ fileName: "plantree-prompt.md", filePath, taskCount: 1 });
    expect(writer).toHaveBeenCalledWith(filePath);
    const markdown = await readFile(filePath, "utf8");
    expect(markdown).toContain("# 任务执行要求");
    expect(markdown).toContain("## 子任务 1");
    expect(markdown).not.toContain("节点：");
    expect(markdown).not.toContain("快照版本");
    expect(markdown).toContain("## 执行协议");
    expect(markdown).toContain("不得虚假宣称完成");
    expect(markdown).toContain("### 验收");
  });

  it("排除已完成节点并保留节点提示词", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-clipboard-filter-"));
    const session = new DemoSession(new PersistentPlanStore(join(directory, "plan.json")));
    const { snapshot, chain } = await session.compileExecutionChain();
    const completedNodeId = chain.tasks[0].nodeId;
    const completedSnapshot = { ...snapshot, nodes: { ...snapshot.nodes, [completedNodeId]: { ...snapshot.nodes[completedNodeId], status: "completed" as const } } };
    const completedChain = { ...chain, tasks: chain.tasks.map((task) => task.nodeId === completedNodeId ? { ...task, status: "completed" as const } : task) };
    const markdown = buildPromptFile(completedSnapshot, completedChain);
    expect(markdown).not.toContain(`\`${completedNodeId}\``);
    expect(markdown).toContain("没有显式验收时，由 Agent 自行评价");
  });
});
