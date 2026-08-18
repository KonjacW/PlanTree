import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import { buildExecutionChain } from "../src/domain/execution-chain.js";

describe("buildExecutionChain", () => {
  it("只从节点任务、方法和验收生成正文，忽略遗留人工提示词", () => {
    const plan = {
      ...initialDemoPlan,
      nodes: {
        ...initialDemoPlan.nodes,
        verify: {
          ...initialDemoPlan.nodes.verify,
          objective: "结构化任务",
          method: "结构化方法",
          acceptance: [{ type: "metric" as const, criterion: "错误数为 0" }],
          customPrompt: "不应进入执行链的旧文本",
          customPromptBaseVersion: 1,
        },
      },
    };

    const task = buildExecutionChain(plan).tasks.find((item) => item.nodeId === "verify");
    expect(task?.prompt).toContain("仅完成：结构化任务");
    expect(task?.prompt).toContain("结构化方法");
    expect(task?.prompt).toContain("错误数为 0");
    expect(task?.prompt).not.toContain("不应进入执行链的旧文本");
    expect(task?.prompt).not.toMatch(/节点：|类型：|状态：|父节点：|直接子节点：|前置依赖：/);
  });
});
