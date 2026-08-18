import { getExecutionBlocker } from "./plan-validation.js";
import type { NodeStatus, PlanNode, PlanSnapshot } from "./types.js";

export interface ExecutionSimulationResult {
  readonly inProgress: PlanSnapshot;
  readonly completed: PlanSnapshot;
  readonly blocker: string | null;
}

export function simulateExecution(
  plan: PlanSnapshot,
  nodeId: string,
): ExecutionSimulationResult {
  const blocker = getExecutionBlocker(plan, nodeId);
  if (blocker) {
    return { inProgress: plan, completed: plan, blocker };
  }

  const inProgress = beginExecution(plan, nodeId);
  return {
    inProgress,
    completed: completeExecution(inProgress, nodeId),
    blocker: null,
  };
}

export function beginExecution(plan: PlanSnapshot, nodeId: string): PlanSnapshot {
  const blocker = getExecutionBlocker(plan, nodeId);
  if (blocker) throw new Error(blocker);
  return updateExecutionStatus(plan, nodeId, "in_progress");
}

export function completeExecution(plan: PlanSnapshot, nodeId: string): PlanSnapshot {
  const node = plan.nodes[nodeId];
  if (!node) throw new Error(`计划中不存在节点 "${nodeId}"。`);
  if (node.status !== "in_progress") throw new Error(`节点 "${nodeId}" 尚未开始执行。`);
  return updateExecutionStatus(plan, nodeId, "completed");
}

function updateExecutionStatus(
  plan: PlanSnapshot,
  nodeId: string,
  status: Extract<NodeStatus, "in_progress" | "completed">,
): PlanSnapshot {
  const next = structuredClone(plan) as {
    version: number;
    nodes: Record<string, PlanNode>;
  };
  const node = next.nodes[nodeId];
  next.nodes[nodeId] = { ...node, status, version: node.version + 1 };
  summarizeAncestors(next, node.parentId);
  next.version += 1;
  return next as PlanSnapshot;
}

function summarizeAncestors(
  plan: { nodes: Record<string, PlanNode> },
  parentId: string | null,
): void {
  let currentId = parentId;
  while (currentId) {
    const node = plan.nodes[currentId];
    const nextStatus = summarizeChildStatuses(
      node.childIds.map((childId) => plan.nodes[childId]).filter(Boolean),
      node.status,
    );
    if (node.status !== nextStatus) {
      plan.nodes[currentId] = { ...node, status: nextStatus, version: node.version + 1 };
    }
    currentId = node.parentId;
  }
}

function summarizeChildStatuses(
  children: readonly PlanNode[],
  fallback: NodeStatus,
): NodeStatus {
  const activeChildren = children.filter((child) => child.status !== "skipped");
  if (activeChildren.length === 0) {
    return fallback;
  }
  if (activeChildren.some((child) => child.status === "invalid")) {
    return "invalid";
  }
  if (activeChildren.every((child) => child.status === "completed")) {
    return "completed";
  }
  if (activeChildren.some((child) => child.status === "in_progress")) {
    return "in_progress";
  }
  return "pending";
}
