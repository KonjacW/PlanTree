import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";

describe("预置缺陷修复演示", () => {
  it("提供带调查、修复、测试和验证分支的稳定初始任务树", () => {
    const root = initialDemoPlan.nodes[initialDemoPlan.rootNodeId];

    expect(root.title).toBe("修复导入向导在空白配置下崩溃的问题");
    expect(root.childIds).toEqual([
      "investigate",
      "repair",
      "test",
      "verify",
    ]);
    expect(initialDemoPlan.validation).toEqual({ valid: true, issues: [] });
    expect(initialDemoPlan.audit).toHaveLength(1);
  });
});
