import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import { replan } from "../src/domain/simulated-planner.js";
import type { PlanSnapshot } from "../src/domain/types.js";

describe("确定性模拟规划器", () => {
  it("展开修复阶段时稳定生成定位、实施和审查子任务", () => {
    const first = replan(initialDemoPlan, {
      type: "expand",
      nodeId: "repair",
    });
    const second = replan(initialDemoPlan, {
      type: "expand",
      nodeId: "repair",
    });

    expect(first).toEqual(second);
    expect(first.snapshot.nodes.repair.childIds).toEqual([
      "repair-locate-code",
      "repair-implement-fix",
      "repair-review-fix",
    ]);
    expect(first.snapshot.nodes["repair-locate-code"]).toMatchObject({
      title: "定位相关代码",
      kind: "task",
      dependsOn: ["investigate"],
    });
    expect(first.snapshot.nodes["repair-implement-fix"].dependsOn).toEqual([
      "repair-locate-code",
    ]);
    expect(first.snapshot.nodes["repair-review-fix"].dependsOn).toEqual([
      "repair-implement-fix",
    ]);
  });

  it("改写阶段时替换旧的规划器子树，但保留用户添加的子节点", () => {
    const plan = planWithExistingPlannerChild();

    const result = replan(plan, {
      type: "rewrite",
      nodeId: "investigate",
      objective: "重新调查空白配置的错误路径。",
    });

    expect(result.snapshot.nodes.investigate.childIds).toEqual([
      "user-note",
      "investigate-gather-context",
      "investigate-outline-work",
    ]);
    expect(result.snapshot.nodes["old-planner-task"]).toBeUndefined();
    expect(result.snapshot.nodes["user-note"].source).toBe("user");
  });

  it("添加阶段节点时为新增节点生成固定模板，裁剪操作不生成新节点", () => {
    const withAddedPhase = planWithAddedPhase();
    const added = replan(withAddedPhase, {
      type: "add",
      parentId: "goal",
      node: {
        id: "documentation",
        title: "整理文档",
        objective: "记录最终行为。",
        kind: "phase",
        dependsOn: [],
      },
    });
    const pruned = replan(added.snapshot, { type: "prune", nodeId: "documentation" });

    expect(added.snapshot.nodes.documentation.childIds).toEqual([
      "documentation-gather-context",
      "documentation-outline-work",
    ]);
    expect(pruned.snapshot).toEqual(added.snapshot);
  });
});

function planWithExistingPlannerChild(): PlanSnapshot {
  const investigate = {
    ...initialDemoPlan.nodes.investigate,
    childIds: ["user-note", "old-planner-task"],
  };
  return {
    ...initialDemoPlan,
    nodes: {
      ...initialDemoPlan.nodes,
      investigate,
      "user-note": {
        ...investigate,
        id: "user-note",
        title: "用户备注",
        objective: "保留这项人工补充。",
        kind: "task",
        parentId: "investigate",
        childIds: [],
        source: "user",
      },
      "old-planner-task": {
        ...investigate,
        id: "old-planner-task",
        title: "旧规划任务",
        objective: "此节点应被替换。",
        kind: "task",
        parentId: "investigate",
        childIds: [],
        source: "planner",
      },
    },
  };
}

function planWithAddedPhase(): PlanSnapshot {
  return {
    ...initialDemoPlan,
    nodes: {
      ...initialDemoPlan.nodes,
      goal: {
        ...initialDemoPlan.nodes.goal,
        childIds: [...initialDemoPlan.nodes.goal.childIds, "documentation"],
      },
      documentation: {
        id: "documentation",
        title: "整理文档",
        objective: "记录最终行为。",
        kind: "phase",
        status: "pending_planning",
        parentId: "goal",
        childIds: [],
        dependsOn: [],
        version: 1,
        source: "user",
      },
    },
  };
}
