import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildExecutionPrompt, CodexConversationBridge } from "../src/application/codex-conversation-bridge.js";
import { ConversationBindingStore } from "../src/application/conversation-binding-store.js";

const threadId = "019ff54b-adcb-7982-880f-15db0ce32449";

describe("Codex 原对话桥接", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("持久化计划到创建它的 Codex 对话", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-binding-"));
    const store = new ConversationBindingStore(join(directory, "binding.json"));
    await store.bind("plan-1", threadId, "C:\\workspace");
    await expect(store.read()).resolves.toMatchObject({ planId: "plan-1", threadId, cwd: "C:\\workspace" });
  });

  it("使用 resume 和精确 threadId 启动新回合", async () => {
    const spawner = vi.fn(async () => undefined);
    const bridge = new CodexConversationBridge(async () => "C:\\Codex\\codex.exe", spawner);
    const request = { requestId: 4, planId: "plan-1", snapshotVersion: 9, requestedAt: new Date().toISOString() };
    await expect(bridge.launchExecution(request, { planId: "plan-1", threadId, cwd: "C:\\workspace", boundAt: new Date().toISOString() })).resolves.toEqual({ threadId, requestId: 4 });
    expect(spawner).toHaveBeenCalledOnce();
    expect(spawner).toHaveBeenCalledWith("C:\\Codex\\codex.exe", ["exec", "resume", "--skip-git-repo-check", threadId, expect.stringContaining("start_next_task(expectedVersion=9)")], { cwd: "C:\\workspace" });
  });

  it("拒绝把计划发送到其他对话", async () => {
    const bridge = new CodexConversationBridge(async () => "codex", async () => undefined);
    const request = { requestId: 1, planId: "plan-new", snapshotVersion: 1, requestedAt: new Date().toISOString() };
    await expect(bridge.launchExecution(request, { planId: "plan-old", threadId, cwd: "C:\\workspace", boundAt: new Date().toISOString() })).rejects.toThrow("创建它的 Codex 对话");
  });

  it("自动执行提示词禁止重新规划和虚假完成", () => {
    const prompt = buildExecutionPrompt({ requestId: 2, planId: "p", snapshotVersion: 3, requestedAt: "now" });
    expect(prompt).toContain("不要重新规划");
    expect(prompt).toContain("complete_task");
    expect(prompt).toContain("不要虚假标记完成");
  });
});
