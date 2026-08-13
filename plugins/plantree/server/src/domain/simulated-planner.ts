import type { EditCommand } from "./plan-editor.js";
import type { PlanNode, PlanSnapshot } from "./types.js";

export interface ReplanResult {
  readonly snapshot: PlanSnapshot;
  readonly summary: string;
}

type MutablePlan = {
  id: string;
  version: number;
  rootNodeId: string;
  nodes: Record<string, PlanNode>;
  validation: PlanSnapshot["validation"];
  audit: PlanSnapshot["audit"];
};

export function replan(plan: PlanSnapshot, command: EditCommand): ReplanResult {
  if (command.type === "prune" || command.type === "prompt" || command.type === "move") {
    return {
      snapshot: structuredClone(plan),
      summary: "裁剪操作不生成新的模拟子任务。",
    };
  }

  const targetNodeId = command.type === "add" ? command.node.id : command.nodeId;
  const next = structuredClone(plan) as MutablePlan;
  const target = next.nodes[targetNodeId];

  if (!target || target.kind === "task" || target.kind === "checkpoint") {
    return {
      snapshot: next,
      summary: "目标节点不需要生成模拟子任务。",
    };
  }

  const retainedChildIds = target.childIds.filter(
    (childId) => next.nodes[childId]?.source !== "planner",
  );
  replacePlannerChildren(next, targetNodeId);
  const template = createTemplate(target);
  for (const node of template) {
    next.nodes[node.id] = node;
  }
  next.nodes[targetNodeId] = {
    ...target,
    childIds: [...retainedChildIds, ...template.map((node) => node.id)],
    status: "pending",
    version: target.version + 1,
  };
  next.version += 1;

  return {
    snapshot: next,
    summary: `已为“${target.title}”生成固定模拟子任务。`,
  };
}

function replacePlannerChildren(plan: MutablePlan, targetNodeId: string): void {
  const target = plan.nodes[targetNodeId];
  for (const childId of target.childIds) {
    if (plan.nodes[childId]?.source === "planner") {
      removeSubtree(plan, childId);
    }
  }
}

function removeSubtree(plan: MutablePlan, nodeId: string): void {
  const node = plan.nodes[nodeId];
  if (!node) {
    return;
  }
  for (const childId of node.childIds) {
    removeSubtree(plan, childId);
  }
  delete plan.nodes[nodeId];
}

function createTemplate(parent: PlanNode): readonly PlanNode[] {
  if (parent.id === "repair") {
    return [
      plannerTask(parent, "repair-locate-code", "定位相关代码", "定位需要保护的配置读取位置。", parent.dependsOn),
      plannerTask(parent, "repair-implement-fix", "实施修复", "为缺失配置加入安全处理。", ["repair-locate-code"]),
      plannerTask(parent, "repair-review-fix", "代码审查", "检查修复是否覆盖预期路径。", ["repair-implement-fix"]),
    ];
  }

  const gatherId = `${parent.id}-gather-context`;
  return [
    plannerTask(parent, gatherId, "收集上下文", "整理该阶段所需的已知信息。", parent.dependsOn),
    plannerTask(parent, `${parent.id}-outline-work`, "整理实施方案", "形成下一步的可执行方案。", [gatherId]),
  ];
}

function plannerTask(
  parent: PlanNode,
  id: string,
  title: string,
  objective: string,
  dependsOn: readonly string[],
): PlanNode {
  return {
    id,
    title,
    objective,
    kind: "task",
    status: "pending",
    parentId: parent.id,
    childIds: [],
    dependsOn: [...dependsOn],
    version: 1,
    source: "planner",
  };
}
