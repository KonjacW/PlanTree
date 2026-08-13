import { describe, expect, it } from "vitest";

import { deriveNodePrompt, getNodePromptState, validateCustomPrompt } from "./prompt";

const snapshot = { id: "plan", version: 1, rootNodeId: "root", nodes: {
  root: { id: "root", title: "目标", objective: "交付", kind: "goal" as const, status: "pending" as const, parentId: null, childIds: ["phase"], dependsOn: [], version: 1, source: "demo" as const },
  phase: { id: "phase", title: "阶段", objective: "分析", kind: "phase" as const, status: "pending" as const, parentId: "root", childIds: ["task"], dependsOn: [], version: 1, source: "demo" as const },
  task: { id: "task", title: "任务", objective: "实施", kind: "task" as const, status: "pending" as const, parentId: "phase", childIds: [], dependsOn: ["phase"], version: 1, source: "demo" as const },
}, validation: { valid: true, issues: [] }, audit: [] };

describe("deriveNodePrompt", () => {
  it("只从当前快照派生完整的单节点规划上下文", () => {
    expect(deriveNodePrompt(snapshot, "phase")).toBe("你正在处理 PlanTree 中的节点。\n\n节点：阶段\n类型：阶段\n状态：待执行\n目标：分析\n父节点：目标\n直接子节点：任务\n前置依赖：无\n\n请保持任务树的结构、依赖和版本一致性，只提出与该节点相关的下一步建议。");
    expect(deriveNodePrompt(snapshot, "missing")).toBeUndefined();
  });

  it("依赖未完成时按 Preview 显示等待前置任务", () => {
    expect(deriveNodePrompt(snapshot, "task")).toContain("状态：等待前置任务");
  });

  it("在自动与人工提示词之间选择并识别过期覆盖", () => {
    expect(getNodePromptState(snapshot, "phase")).toMatchObject({
      source: "derived",
      stale: false,
      text: expect.stringContaining("节点：阶段"),
    });
    const customized = {
      ...snapshot,
      nodes: {
        ...snapshot.nodes,
        phase: { ...snapshot.nodes.phase, version: 3, customPrompt: "人工文本", customPromptBaseVersion: 2 },
      },
    };
    expect(getNodePromptState(customized, "phase")).toEqual({ source: "custom", stale: true, text: "人工文本" });
  });

  it.each([
    { value: "   ", error: "提示词不能为空。" },
    { value: "有效提示词", error: undefined },
  ])("校验人工提示词 %#", ({ value, error }) => {
    expect(validateCustomPrompt(value)).toBe(error);
  });
});
