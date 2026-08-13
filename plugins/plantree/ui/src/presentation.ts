import type { PlanNode, PlanSnapshot } from "./plan-types";

const kindLabels = {
  goal: "目标",
  phase: "阶段",
  task: "任务",
  checkpoint: "检查点",
} as const;

const statusLabels = {
  pending_planning: "待规划",
  pending: "待执行",
  in_progress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
  invalid: "失效",
} as const;

export function getKindLabel(node: PlanNode): string {
  return kindLabels[node.kind];
}

export function isBlocked(node: PlanNode, snapshot: Pick<PlanSnapshot, "nodes">): boolean {
  return node.dependsOn.some((dependencyId) => snapshot.nodes[dependencyId]?.status !== "completed");
}

export function getStatusLabel(node: PlanNode, snapshot: Pick<PlanSnapshot, "nodes">): string {
  return isBlocked(node, snapshot) ? "等待前置任务" : statusLabels[node.status];
}

export function getGraphStatusLabel(node: PlanNode, blocked: boolean): string {
  return blocked ? "等待前置任务" : statusLabels[node.status];
}
