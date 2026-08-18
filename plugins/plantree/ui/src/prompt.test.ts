import { describe, expect, it } from "vitest";

import { deriveNodePrompt, getNodePromptState, validateCustomPrompt } from "./prompt";

const snapshot = { id: "plan", version: 1, rootNodeId: "root", nodes: {
  root: { id: "root", title: "目标", objective: "交付", kind: "goal" as const, status: "pending" as const, parentId: null, childIds: ["phase"], dependsOn: [], version: 1, source: "demo" as const },
  phase: { id: "phase", title: "阶段", objective: "分析", kind: "phase" as const, status: "pending" as const, parentId: "root", childIds: ["task"], dependsOn: [], version: 1, source: "demo" as const, method: "对现有实现做静态检查", acceptance: [{ type: "test" as const, criterion: "测试全部通过" }] },
  task: { id: "task", title: "任务", objective: "实施", kind: "task" as const, status: "pending" as const, parentId: "phase", childIds: [], dependsOn: ["phase"], version: 1, source: "demo" as const },
}, validation: { valid: true, issues: [] }, audit: [] };

describe("deriveNodePrompt", () => {
  it("只展示任务、方法和验收，不把图结构元数据写入正文", () => {
    const prompt = deriveNodePrompt(snapshot, "phase");
    expect(prompt).toBe("### 任务\n\n仅完成：分析\n\n### 方法\n\n对现有实现做静态检查\n\n### 验收\n\n- **测试**：测试全部通过");
    expect(prompt).not.toMatch(/节点：|类型：|状态：|父节点：|直接子节点：|前置依赖：/);
    expect(deriveNodePrompt(snapshot, "missing")).toBeUndefined();
  });

  it("没有显式验收时仅补充 Agent 自评要求", () => {
    expect(deriveNodePrompt(snapshot, "task")).toBe("### 任务\n\n仅完成：实施\n\n### 验收\n\n完成后自行评价当前任务是否完成，并简要说明判断依据。");
  });

  it("始终由节点结构化内容生成提示词，旧人工文本不再覆盖", () => {
    expect(getNodePromptState(snapshot, "phase")).toMatchObject({
      source: "derived",
      stale: false,
      text: expect.stringContaining("仅完成：分析"),
    });
    const customized = {
      ...snapshot,
      nodes: {
        ...snapshot.nodes,
        phase: { ...snapshot.nodes.phase, version: 3, customPrompt: "人工文本", customPromptBaseVersion: 2 },
      },
    };
    expect(getNodePromptState(customized, "phase")).toMatchObject({ source: "derived", stale: false, text: expect.stringContaining("仅完成：分析") });
  });

  it.each([
    { value: "   ", error: "提示词不能为空。" },
    { value: "有效提示词", error: undefined },
  ])("校验人工提示词 %#", ({ value, error }) => {
    expect(validateCustomPrompt(value)).toBe(error);
  });
});
