import { validatePlan } from "./plan-validation.js";
import type { AcceptanceType, PlanNode, PlanSnapshot } from "./types.js";

const acceptanceLabels: Record<AcceptanceType, string> = {
  test: "测试",
  metric: "指标",
  evaluation: "评价",
};

export interface ExecutionTaskEnvelope {
  readonly sequence: number;
  readonly nodeId: string;
  readonly status: PlanNode["status"];
  readonly parentTasks: readonly { readonly id: string; readonly task: string }[];
  readonly childTasks: readonly { readonly id: string; readonly task: string }[];
  readonly prompt: string;
}

export interface ExecutionChain {
  readonly schemaVersion: "1.0";
  readonly chainId: string;
  readonly sourceTreeId: string;
  readonly traversal: "depth-first-leaves";
  readonly taskCount: number;
  readonly tasks: readonly ExecutionTaskEnvelope[];
}

export function getOrderedExecutableNodeIds(plan: PlanSnapshot): readonly string[] {
  const ids: string[] = [];
  const visit = (nodeId: string): void => {
    const node = plan.nodes[nodeId];
    if (!node || node.status === "skipped") return;
    if (node.childIds.length === 0) {
      if ((node.kind === "task" || node.kind === "checkpoint") && node.status !== "invalid") ids.push(node.id);
      return;
    }
    for (const childId of node.childIds) visit(childId);
  };
  visit(plan.rootNodeId);
  return ids;
}

export function buildExecutionChain(plan: PlanSnapshot): ExecutionChain {
  const validation = validatePlan(plan);
  if (!validation.valid) throw new Error(`无法从无效计划编译执行链：${validation.issues[0]}`);
  const nodeIds = getOrderedExecutableNodeIds(plan);
  const taskCount = nodeIds.length;
  const tasks = nodeIds.map((nodeId, index): ExecutionTaskEnvelope => {
    const node = plan.nodes[nodeId];
    const sequence = index + 1;
    const parent = node.parentId ? plan.nodes[node.parentId] : undefined;
    return {
      sequence,
      nodeId,
      status: node.status,
      parentTasks: parent ? [{ id: parent.id, task: parent.objective }] : [],
      childTasks: node.childIds.map((id) => plan.nodes[id]).filter(Boolean).map((child) => ({ id: child.id, task: child.objective })),
      prompt: deriveExecutionPrompt(node),
    };
  });
  return {
    schemaVersion: "1.0",
    chainId: `${plan.id}-execution`,
    sourceTreeId: plan.id,
    traversal: "depth-first-leaves",
    taskCount,
    tasks,
  };
}

function deriveExecutionPrompt(node: PlanNode): string {
  const sections = [`### 任务\n\n仅完成：${node.objective}`];
  if (node.method) sections.push(`### 方法\n\n${node.method}`);
  if (node.acceptance?.length) {
    sections.push(`### 验收\n\n${node.acceptance.map((item) => `- **${acceptanceLabels[item.type]}**：${item.criterion}`).join("\n")}`);
  } else {
    sections.push("### 验收\n\n完成后自行评价当前任务是否完成，并简要说明判断依据。");
  }
  return sections.join("\n\n");
}
