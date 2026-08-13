import { describe, expect, it } from "vitest";

import { snapshotToGraph } from "./graph-model";

const snapshot = {
  id: "plan", version: 4, rootNodeId: "root",
  nodes: {
    root: { id: "root", title: "根", objective: "交付", kind: "goal" as const, status: "pending" as const, parentId: null, childIds: ["phase", "skipped"], dependsOn: [], version: 4, source: "demo" as const },
    phase: { id: "phase", title: "阶段", objective: "分析", kind: "phase" as const, status: "pending" as const, parentId: "root", childIds: ["first", "second"], dependsOn: [], version: 4, source: "demo" as const },
    first: { id: "first", title: "第一项", objective: "准备", kind: "task" as const, status: "completed" as const, parentId: "phase", childIds: [], dependsOn: [], version: 4, source: "demo" as const },
    second: { id: "second", title: "第二项", objective: "实施", kind: "task" as const, status: "pending" as const, parentId: "phase", childIds: [], dependsOn: ["first"], version: 4, source: "demo" as const },
    skipped: { id: "skipped", title: "跳过", objective: "忽略", kind: "task" as const, status: "skipped" as const, parentId: "root", childIds: [], dependsOn: [], version: 4, source: "demo" as const },
  }, validation: { valid: true, issues: [] }, audit: [],
};

describe("snapshotToGraph", () => {
  it("按 childIds 生成稳定的根向右位置并过滤跳过节点", () => {
    const first = snapshotToGraph(snapshot);
    const second = snapshotToGraph(snapshot);

    expect(first.nodes.map((node) => node.id)).toEqual(["root", "phase", "first", "second"]);
    expect(first.nodes).toEqual(second.nodes);
    expect(first.nodes.find((node) => node.id === "root")?.position).toEqual({ x: 34, y: 268 });
    expect(first.nodes.find((node) => node.id === "phase")?.position).toEqual({ x: 276, y: 66 });
    expect(first.nodes.find((node) => node.id === "first")?.position).toEqual({ x: 520, y: 46 });
    expect(first.nodes.find((node) => node.id === "second")?.position).toEqual({ x: 520, y: 172 });
    expect(first.nodes.find((node) => node.id === "phase")?.handles).toEqual([
      expect.objectContaining({ type: "target", position: "left", x: 0, y: 37.5 }),
      expect.objectContaining({ type: "source", position: "right", x: 151, y: 37.5 }),
    ]);
  });

  it("分别生成父子实线和显式依赖虚线，不生成同级顺序边", () => {
    const { edges } = snapshotToGraph(snapshot);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tree:root:phase", source: "root", target: "phase", type: "taskRelation", className: "edge-tree" }),
      expect.objectContaining({ id: "dependency:first:second", source: "first", target: "second", type: "taskRelation", className: "edge-dependency" }),
    ]));
    expect(edges).toHaveLength(4);
    expect(edges.filter((edge) => edge.data?.relation === "dependency")).toHaveLength(1);
  });

  it("多个展开分支在同一深度保持至少一个 Preview 行距", () => {
    const expanded = {
      ...snapshot,
      nodes: {
        ...snapshot.nodes,
        root: { ...snapshot.nodes.root, childIds: ["phase", "other"] },
        other: { id: "other", title: "另一阶段", objective: "并行", kind: "phase" as const, status: "pending" as const, parentId: "root", childIds: ["third", "fourth"], dependsOn: [], version: 4, source: "demo" as const },
        third: { id: "third", title: "第三项", objective: "验证", kind: "task" as const, status: "pending" as const, parentId: "other", childIds: [], dependsOn: [], version: 4, source: "demo" as const },
        fourth: { id: "fourth", title: "第四项", objective: "整理", kind: "task" as const, status: "pending" as const, parentId: "other", childIds: [], dependsOn: [], version: 4, source: "demo" as const },
      },
    };
    const depthTwo = snapshotToGraph(expanded).nodes.filter((node) => ["first", "second", "third", "fourth"].includes(node.id)).map((node) => node.position.y).sort((a, b) => a - b);

    expect(depthTwo.slice(1).every((y, index) => y - depthTwo[index] >= 126)).toBe(true);
  });
});
