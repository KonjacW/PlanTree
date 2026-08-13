import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import { simulateExecution } from "../src/domain/execution-simulator.js";
import type { PlanSnapshot } from "../src/domain/types.js";

describe("单步模拟执行", () => {
  it("将已就绪的叶节点依次变为执行中和已完成，并汇总祖先阶段", () => {
    const plan = withReadyTask(initialDemoPlan);

    const result = simulateExecution(plan, "inspect-log");

    expect(result.blocker).toBeNull();
    expect(result.inProgress.nodes["inspect-log"].status).toBe("in_progress");
    expect(result.completed.nodes["inspect-log"].status).toBe("completed");
    expect(result.completed.nodes.investigate.status).toBe("completed");
    expect(result.completed.nodes.goal.status).toBe("pending");
  });

  it("在依赖未完成时保持计划不变并返回阻断原因", () => {
    const result = simulateExecution(initialDemoPlan, "verify");

    expect(result).toEqual({
      inProgress: initialDemoPlan,
      completed: initialDemoPlan,
      blocker: '节点 "verify" 的依赖 "test" 尚未完成。',
    });
  });
});

function withReadyTask(plan: PlanSnapshot): PlanSnapshot {
  return {
    ...plan,
    nodes: {
      ...plan.nodes,
      investigate: {
        ...plan.nodes.investigate,
        childIds: ["inspect-log"],
      },
      "inspect-log": {
        id: "inspect-log",
        title: "检查日志",
        objective: "确认崩溃发生前的输入状态。",
        kind: "task",
        status: "pending",
        parentId: "investigate",
        childIds: [],
        dependsOn: [],
        version: 1,
        source: "user",
      },
    },
  };
}
