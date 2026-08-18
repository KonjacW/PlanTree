import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import { PlanEditor } from "../src/domain/plan-editor.js";

describe("PlanEditor", () => {
  it("在阶段末尾添加子节点，并可撤销至原有结构", () => {
    const editor = new PlanEditor(initialDemoPlan);

    editor.apply({
      type: "add",
      parentId: "investigate",
      node: {
        id: "inspect-log",
        title: "检查日志",
        objective: "确认崩溃发生前的输入状态。",
        kind: "task",
        dependsOn: [],
      },
    });

    expect(editor.read().nodes.investigate.childIds).toEqual(["inspect-log"]);
    expect(editor.read().nodes["inspect-log"].parentId).toBe("investigate");

    editor.undo();

    expect(editor.read().nodes.investigate.childIds).toEqual([]);
    expect(editor.read().nodes["inspect-log"]).toBeUndefined();
  });

  it("改写非空目标并将节点标记为待规划", () => {
    const editor = new PlanEditor(initialDemoPlan);

    editor.apply({
      type: "rewrite",
      nodeId: "investigate",
      objective: "定位空白配置未被保护的入口。",
    });

    expect(editor.read().nodes.investigate).toMatchObject({
      objective: "定位空白配置未被保护的入口。",
      status: "pending_planning",
      version: 2,
    });
  });

  it("结构化改写可清除方法和验收，并移除旧人工提示词", () => {
    const withLegacyPrompt = {
      ...initialDemoPlan,
      nodes: {
        ...initialDemoPlan.nodes,
        repair: {
          ...initialDemoPlan.nodes.repair,
          method: "旧方法",
          acceptance: [{ type: "test" as const, criterion: "旧验收" }],
          customPrompt: "旧人工提示词",
          customPromptBaseVersion: 1,
        },
      },
    };
    const rewritten = new PlanEditor(withLegacyPrompt).apply({
      type: "rewrite",
      nodeId: "repair",
      title: "新任务",
      objective: "新任务",
      method: null,
      acceptance: [],
    });

    expect(rewritten.nodes.repair).toMatchObject({ title: "新任务", objective: "新任务", acceptance: [] });
    expect(rewritten.nodes.repair).not.toHaveProperty("method");
    expect(rewritten.nodes.repair).not.toHaveProperty("customPrompt");
    expect(rewritten.nodes.repair).not.toHaveProperty("customPromptBaseVersion");
  });

  it("展开阶段节点时标记为待规划", () => {
    const editor = new PlanEditor(initialDemoPlan);

    editor.apply({ type: "expand", nodeId: "investigate" });

    expect(editor.read().nodes.investigate.status).toBe("pending_planning");
  });

  it("裁剪非根节点及其后代，并可撤销", () => {
    const editor = new PlanEditor(initialDemoPlan);

    editor.apply({ type: "prune", nodeId: "repair" });
    expect(editor.read().nodes.repair.status).toBe("skipped");

    editor.undo();
    expect(editor.read().nodes.repair.status).toBe("pending_planning");
  });

  it("拒绝裁剪根节点且不改变计划版本", () => {
    const editor = new PlanEditor(initialDemoPlan);

    expect(() => editor.apply({ type: "prune", nodeId: "goal" })).toThrow(
      "不能裁剪根节点。",
    );
    expect(editor.read().version).toBe(1);
  });

  it("拒绝向可执行叶节点添加子节点且不改变计划版本", () => {
    const editor = new PlanEditor(initialDemoPlan);
    editor.apply({
      type: "add",
      parentId: "investigate",
      node: {
        id: "inspect-log",
        title: "检查日志",
        objective: "确认崩溃发生前的输入状态。",
        kind: "task",
        dependsOn: [],
      },
    });

    expect(() =>
      editor.apply({
        type: "add",
        parentId: "inspect-log",
        node: {
          id: "nested-task",
          title: "无效子任务",
          objective: "此操作不应成功。",
          kind: "task",
          dependsOn: [],
        },
      }),
    ).toThrow("不能向可执行叶节点添加子节点。");
    expect(editor.read().version).toBe(2);
  });

  it("拒绝具有自循环依赖的新节点且不改变计划版本", () => {
    const editor = new PlanEditor(initialDemoPlan);

    expect(() =>
      editor.apply({
        type: "add",
        parentId: "investigate",
        node: {
          id: "cyclic-task",
          title: "循环任务",
          objective: "此操作不应成功。",
          kind: "task",
          dependsOn: ["cyclic-task"],
        },
      }),
    ).toThrow("编辑会产生循环依赖。");
    expect(editor.read().version).toBe(1);
  });

  it("重新排列同一父节点下的兄弟节点并可撤销", () => {
    const editor = new PlanEditor(initialDemoPlan);

    const moved = editor.apply({ type: "move", nodeId: "verify", parentId: "goal", position: 0 });
    expect(moved.nodes.goal.childIds).toEqual(["verify", "investigate", "repair", "test"]);
    expect(moved.version).toBe(2);

    expect(editor.undo().nodes.goal.childIds).toEqual(["investigate", "repair", "test", "verify"]);
  });

  it("保存与清除人工提示词时不改变计划结构", () => {
    const editor = new PlanEditor(initialDemoPlan);
    const saved = editor.apply({ type: "prompt", nodeId: "repair", customPrompt: "  人工提示词  " });

    expect(saved.nodes.repair).toMatchObject({ customPrompt: "人工提示词", customPromptBaseVersion: 2, version: 2 });
    expect(saved.nodes.repair.childIds).toEqual([]);
    expect(saved.version).toBe(2);

    const cleared = new PlanEditor(saved).apply({ type: "prompt", nodeId: "repair" });
    expect(cleared.nodes.repair).not.toHaveProperty("customPrompt");
    expect(cleared.nodes.repair).not.toHaveProperty("customPromptBaseVersion");
    expect(cleared.nodes.repair.childIds).toEqual([]);
    expect(() => new PlanEditor(initialDemoPlan).apply({ type: "prompt", nodeId: "repair", customPrompt: " " })).toThrow("提示词不能为空。");
  });

  it.each([
    { nodeId: "repair-locate-code", parentId: "goal", position: 0 },
    { nodeId: "verify", parentId: "missing", position: 0 },
    { nodeId: "verify", parentId: "goal", position: 4 },
  ])("拒绝非法同级移动 %#", (command) => {
    const editor = new PlanEditor(initialDemoPlan);

    expect(() => editor.apply({ type: "move", ...command })).toThrow();
    expect(editor.read().nodes.goal.childIds).toEqual(["investigate", "repair", "test", "verify"]);
  });
});
