import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DemoSession, getDefaultStorePath } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";

describe("创建或加载演示会话", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  async function session(): Promise<DemoSession> { directory = await mkdtemp(join(tmpdir(), "plantree-session-")); return new DemoSession(new PersistentPlanStore(join(directory, "plan.json"))); }

  it("默认状态文件位于插件 data 目录", () => {
    expect(getDefaultStorePath().replace(/\\/g, "/")).toMatch(/plugins\/plantree\/data\/plantree-plan\.json$/);
  });

  it("编辑、撤销和重置均写入状态文件", async () => {
    const value = await session(); const initial = await value.read();
    const edited = await value.edit({ type: "expand", nodeId: "repair" }, initial.snapshot.version);
    expect(edited.snapshot.nodes.repair.childIds).toContain("repair-locate-code");
    expect((await value.undo(edited.snapshot.version)).snapshot.nodes.repair.childIds).toEqual([]);
    const current = await value.read();
    expect((await value.reset(current.snapshot.version)).snapshot.id).toBe("demo-import-wizard-crash");
  });

  it("按线性历史连续撤销重做并在新分支或重置后清空重做", async () => {
    const value = await session(); const initial = await value.read();
    const first = await value.edit({ type: "prompt", nodeId: "repair", customPrompt: "第一版" }, initial.snapshot.version);
    const second = await value.edit({ type: "prompt", nodeId: "repair", customPrompt: "第二版" }, first.snapshot.version);
    expect(second.snapshot.audit.at(-1)).toMatchObject({ type: "edited", nodeIds: ["repair"], versionBefore: 2, versionAfter: 3 });

    const undoSecond = await value.undo(second.snapshot.version);
    expect(undoSecond.snapshot.nodes.repair.customPrompt).toBe("第一版");
    expect(undoSecond.snapshot.version).toBeGreaterThan(second.snapshot.version);
    const undoFirst = await value.undo(undoSecond.snapshot.version);
    expect(undoFirst.snapshot.nodes.repair.customPrompt).toBeUndefined();
    expect(undoFirst.snapshot.version).toBeGreaterThan(undoSecond.snapshot.version);
    const redoFirst = await value.redo(undoFirst.snapshot.version);
    expect(redoFirst.snapshot.nodes.repair.customPrompt).toBe("第一版");
    expect(redoFirst.snapshot.version).toBeGreaterThan(undoFirst.snapshot.version);
    const redoSecond = await value.redo(redoFirst.snapshot.version);
    expect(redoSecond.snapshot.nodes.repair.customPrompt).toBe("第二版");
    expect(redoSecond.snapshot.version).toBeGreaterThan(redoFirst.snapshot.version);

    const branchedFrom = await value.undo(redoSecond.snapshot.version);
    const branched = await value.edit({ type: "prompt", nodeId: "repair", customPrompt: "新分支" }, branchedFrom.snapshot.version);
    await expect(value.redo(branched.snapshot.version)).rejects.toThrow("没有可重做的编辑。");
    const reset = await value.reset(branched.snapshot.version);
    expect(reset.snapshot.version).toBeGreaterThan(branched.snapshot.version);
    await expect(value.undo(reset.snapshot.version)).rejects.toThrow("没有可撤销的编辑。");
    await expect(value.redo(reset.snapshot.version)).rejects.toThrow("没有可重做的编辑。");
  });

  it("新会话读取已保存的更新，过期版本不会覆盖", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-session-")); const path = join(directory, "plan.json");
    const first = new DemoSession(new PersistentPlanStore(path)); const second = new DemoSession(new PersistentPlanStore(path));
    const version = (await first.read()).snapshot.version;
    await first.move("verify", "goal", 0, version);
    expect((await second.read()).snapshot.nodes.goal.childIds[0]).toBe("verify");
    await expect(second.move("test", "goal", 0, version)).rejects.toThrow("任务树已被其他入口更新，请刷新后重试。");
  });

  it("拒绝用本会话历史覆盖其他入口的后续更新", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-session-")); const path = join(directory, "plan.json");
    const first = new DemoSession(new PersistentPlanStore(path)); const second = new DemoSession(new PersistentPlanStore(path));
    const initial = await first.read();
    const firstEdit = await first.edit({ type: "prompt", nodeId: "repair", customPrompt: "入口一" }, initial.snapshot.version);
    const secondEdit = await second.edit({ type: "prompt", nodeId: "test", customPrompt: "入口二" }, firstEdit.snapshot.version);

    await expect(first.undo(secondEdit.snapshot.version)).rejects.toMatchObject({
      message: "任务树已被其他入口更新，请刷新后重试。",
      snapshot: expect.objectContaining({ version: secondEdit.snapshot.version }),
    });
    expect((await first.read()).snapshot.nodes.test.customPrompt).toBe("入口二");
  });

  it("阻断依赖未完成的模拟执行但不写入状态", async () => {
    const value = await session(); const initial = await value.read(); const result = await value.simulate("verify", initial.snapshot.version);
    expect(result.summary).toBe('节点 "verify" 的依赖 "test" 尚未完成。');
    expect(result.snapshot.nodes.verify.status).toBe("pending");
  });
});
