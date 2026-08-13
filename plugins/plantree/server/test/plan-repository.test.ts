import { describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import {
  PlanRepository,
  getNode,
  listDescendantIds,
} from "../src/domain/plan-repository.js";

describe("PlanRepository", () => {
  it("写入后的快照不受调用方后续修改影响", () => {
    const repository = new PlanRepository(initialDemoPlan);
    const writableCopy = structuredClone(initialDemoPlan);
    Reflect.set(writableCopy.nodes.investigate, "title", "调用方修改");

    repository.write(writableCopy);
    Reflect.set(writableCopy.nodes.investigate, "title", "错误泄漏");

    expect(repository.read().nodes.investigate.title).toBe("调用方修改");
  });
});

describe("任务树查询", () => {
  it("按子节点声明顺序以前序方式返回全部后代", () => {
    const plan = structuredClone(initialDemoPlan);
    const nodes = plan.nodes as Record<string, (typeof plan.nodes)[string]>;
    Reflect.set(nodes.investigate, "childIds", ["inspect-log", "inspect-config"]);
    nodes["inspect-log"] = {
      ...plan.nodes.investigate,
      id: "inspect-log",
      title: "检查日志",
      parentId: "investigate",
      childIds: ["locate-null"],
    };
    nodes["locate-null"] = {
      ...plan.nodes.investigate,
      id: "locate-null",
      title: "定位空值",
      parentId: "inspect-log",
      childIds: [],
    };
    nodes["inspect-config"] = {
      ...plan.nodes.investigate,
      id: "inspect-config",
      title: "检查配置",
      parentId: "investigate",
      childIds: [],
    };

    expect(listDescendantIds(plan, "investigate")).toEqual([
      "inspect-log",
      "locate-null",
      "inspect-config",
    ]);
  });

  it("拒绝查询不存在的节点", () => {
    expect(() => getNode(initialDemoPlan, "missing-node")).toThrow(
      '计划中不存在节点 "missing-node"。',
    );
  });
});
