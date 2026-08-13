import type { PlanNode, PlanSnapshot, ValidationResult } from "./types.js";

type MutablePlan = {
  id: string;
  version: number;
  rootNodeId: string;
  nodes: Record<string, PlanNode>;
  validation: ValidationResult;
  audit: PlanSnapshot["audit"];
};

export function synchronizeDependencies(plan: PlanSnapshot): PlanSnapshot {
  const next = structuredClone(plan) as MutablePlan;
  const issues: string[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of Object.values(next.nodes)) {
      const unavailableDependencies = node.dependsOn.filter((dependencyId) => {
        const dependency = next.nodes[dependencyId];
        return !dependency || dependency.status === "skipped" || dependency.status === "invalid";
      });
      if (unavailableDependencies.length === 0) {
        continue;
      }

      for (const dependencyId of unavailableDependencies) {
        issues.push(`节点 "${node.id}" 的依赖 "${dependencyId}" 不可用。`);
      }
      next.nodes[node.id] = {
        ...node,
        dependsOn: node.dependsOn.filter((dependencyId) => !unavailableDependencies.includes(dependencyId)),
        status: "invalid",
        version: node.version + 1,
      };
      changed = true;
    }
  }

  const structural = validatePlan(next);
  next.validation = {
    valid: structural.valid && issues.length === 0,
    issues: [...issues, ...structural.issues],
  };
  return next;
}

export function validatePlan(plan: PlanSnapshot): ValidationResult {
  const issues: string[] = [];
  const root = plan.nodes[plan.rootNodeId];
  const rootIds = Object.values(plan.nodes)
    .filter((node) => node.parentId === null)
    .map((node) => node.id);

  if (!root || root.parentId !== null || rootIds.length !== 1) {
    issues.push("计划必须恰有一个根节点。");
  }

  detectParentChildCycles(plan, issues);
  detectUnreachableNodes(plan, issues);
  detectDependencyCycles(plan, issues);

  return { valid: issues.length === 0, issues };
}

export function getExecutionBlocker(plan: PlanSnapshot, nodeId: string): string | null {
  const node = plan.nodes[nodeId];
  if (!node) {
    return `计划中不存在节点 "${nodeId}"。`;
  }
  if (node.status === "invalid") {
    return `节点 "${nodeId}" 处于失效状态。`;
  }
  if (node.status === "skipped") {
    return `节点 "${nodeId}" 已被裁剪。`;
  }
  if (node.childIds.length > 0) {
    return `节点 "${nodeId}" 不是可执行叶节点。`;
  }
  if (node.kind !== "task" && node.kind !== "checkpoint") {
    return `节点 "${nodeId}" 不是可执行节点。`;
  }
  for (const dependencyId of node.dependsOn) {
    const dependency = plan.nodes[dependencyId];
    if (!dependency || dependency.status !== "completed") {
      return `节点 "${nodeId}" 的依赖 "${dependencyId}" 尚未完成。`;
    }
  }
  return null;
}

function detectParentChildCycles(plan: PlanSnapshot, issues: string[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      issues.push(`父子关系存在循环：节点 "${nodeId}"。`);
      return;
    }
    if (visited.has(nodeId) || !plan.nodes[nodeId]) {
      return;
    }
    visiting.add(nodeId);
    for (const childId of plan.nodes[nodeId].childIds) {
      visit(childId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of Object.keys(plan.nodes)) {
    visit(nodeId);
  }
}

function detectUnreachableNodes(plan: PlanSnapshot, issues: string[]): void {
  const reachable = new Set<string>();
  const visit = (nodeId: string): void => {
    if (reachable.has(nodeId)) {
      return;
    }
    reachable.add(nodeId);
    const node = plan.nodes[nodeId];
    if (!node) {
      return;
    }
    for (const childId of node.childIds) {
      if (plan.nodes[childId]?.parentId === node.id) {
        visit(childId);
      }
    }
  };

  if (plan.nodes[plan.rootNodeId]) {
    visit(plan.rootNodeId);
  }
  for (const nodeId of Object.keys(plan.nodes)) {
    if (!reachable.has(nodeId)) {
      issues.push(`节点 "${nodeId}" 不可从根节点到达。`);
    }
  }
}

function detectDependencyCycles(plan: PlanSnapshot, issues: string[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      issues.push(`依赖关系存在循环：节点 "${nodeId}"。`);
      return;
    }
    if (visited.has(nodeId) || !plan.nodes[nodeId]) {
      return;
    }
    visiting.add(nodeId);
    for (const dependencyId of plan.nodes[nodeId].dependsOn) {
      visit(dependencyId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of Object.keys(plan.nodes)) {
    visit(nodeId);
  }
}
