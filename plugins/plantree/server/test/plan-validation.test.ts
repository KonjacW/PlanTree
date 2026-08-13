import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import {
  getExecutionBlocker,
  synchronizeDependencies,
  validatePlan,
} from "../src/domain/plan-validation.js";
import type { PlanSnapshot } from "../src/domain/types.js";

describe("计划依赖同步与有效性检查", () => {
  it("清除指向已裁剪节点的依赖并使下游节点失效", () => {
    const plan = withNodeStatus(initialDemoPlan, "repair", "skipped");

    const result = synchronizeDependencies(plan);

    expect(result.nodes.test).toMatchObject({
      dependsOn: [],
      status: "invalid",
    });
    expect(result.nodes.verify).toMatchObject({
      dependsOn: [],
      status: "invalid",
    });
    expect(result.validation).toEqual({
      valid: false,
      issues: [
        '节点 "test" 的依赖 "repair" 不可用。',
        '节点 "verify" 的依赖 "test" 不可用。',
      ],
    });
  });

  it("报告父子循环、依赖循环和不可达节点", () => {
    const result = validatePlan({
      ...initialDemoPlan,
      nodes: {
        ...initialDemoPlan.nodes,
        investigate: {
          ...initialDemoPlan.nodes.investigate,
          childIds: ["goal"],
          dependsOn: ["repair"],
        },
        repair: {
          ...initialDemoPlan.nodes.repair,
          dependsOn: ["investigate"],
        },
        verify: {
          ...initialDemoPlan.nodes.verify,
          parentId: "missing-parent",
        },
      },
    });

    expect(result).toEqual({
      valid: false,
      issues: [
        '父子关系存在循环：节点 "goal"。',
        '节点 "verify" 不可从根节点到达。',
        '依赖关系存在循环：节点 "investigate"。',
      ],
    });
  });

  it("在叶节点未完成依赖或已失效时阻断模拟执行", () => {
    expect(getExecutionBlocker(initialDemoPlan, "verify")).toBe(
      '节点 "verify" 的依赖 "test" 尚未完成。',
    );

    const invalidPlan = withNodeStatus(initialDemoPlan, "verify", "invalid");
    expect(getExecutionBlocker(invalidPlan, "verify")).toBe(
      '节点 "verify" 处于失效状态。',
    );
  });
});

function withNodeStatus(
  plan: PlanSnapshot,
  nodeId: string,
  status: PlanSnapshot["nodes"][string]["status"],
): PlanSnapshot {
  return {
    ...plan,
    nodes: {
      ...plan.nodes,
      [nodeId]: {
        ...plan.nodes[nodeId],
        status,
      },
    },
  };
}
