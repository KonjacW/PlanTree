import { describe, expect, it } from "vitest";

import { analyzeImpact } from "../src/domain/impact-analysis.js";
import { initialDemoPlan } from "../src/domain/demo.js";
import type { PlanSnapshot } from "../src/domain/types.js";

describe("局部影响范围分析", () => {
  it("纳入未裁剪后代和反向依赖闭包，但保持无关文档分支不变", () => {
    const plan = planWithUnrelatedDocumentationBranch();

    const result = analyzeImpact(plan, "investigate");

    expect(result.affectedNodeIds).toEqual([
      "investigate",
      "inspect-log",
      "repair",
      "test",
      "verify",
    ]);
    expect(result.affectedNodeIds).not.toContain("pruned-note");
    expect(result.affectedNodeIds).not.toContain("documentation");
    expect(plan.nodes.documentation).toEqual({
      id: "documentation",
      title: "整理文档说明",
      objective: "记录已确认的用户可见行为。",
      kind: "checkpoint",
      status: "pending",
      parentId: "goal",
      childIds: [],
      dependsOn: [],
      version: 1,
      source: "demo",
    });
  });
});

function planWithUnrelatedDocumentationBranch(): PlanSnapshot {
  const investigate = {
    ...initialDemoPlan.nodes.investigate,
    childIds: ["inspect-log", "pruned-note"],
  };

  return {
    ...initialDemoPlan,
    nodes: {
      ...initialDemoPlan.nodes,
      goal: {
        ...initialDemoPlan.nodes.goal,
        childIds: ["investigate", "repair", "test", "verify", "documentation"],
      },
      investigate,
      "inspect-log": {
        ...investigate,
        id: "inspect-log",
        title: "检查日志",
        parentId: "investigate",
        childIds: [],
        status: "pending",
      },
      "pruned-note": {
        ...investigate,
        id: "pruned-note",
        title: "已裁剪说明",
        parentId: "investigate",
        childIds: [],
        status: "skipped",
      },
      documentation: {
        id: "documentation",
        title: "整理文档说明",
        objective: "记录已确认的用户可见行为。",
        kind: "checkpoint",
        status: "pending",
        parentId: "goal",
        childIds: [],
        dependsOn: [],
        version: 1,
        source: "demo",
      },
    },
  };
}
