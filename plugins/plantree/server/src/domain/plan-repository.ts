import type { PlanNode, PlanSnapshot } from "./types.js";

export class PlanRepository {
  #snapshot: PlanSnapshot;

  constructor(initialSnapshot: PlanSnapshot) {
    this.#snapshot = clonePlan(initialSnapshot);
  }

  read(): PlanSnapshot {
    return clonePlan(this.#snapshot);
  }

  write(snapshot: PlanSnapshot): void {
    this.#snapshot = clonePlan(snapshot);
  }
}

export function getNode(plan: PlanSnapshot, nodeId: string): PlanNode {
  const node = plan.nodes[nodeId];

  if (!node) {
    throw new Error(`计划中不存在节点 "${nodeId}"。`);
  }

  return node;
}

export function listDescendantIds(
  plan: PlanSnapshot,
  nodeId: string,
): readonly string[] {
  const descendants: string[] = [];
  const visit = (currentNodeId: string): void => {
    for (const childId of getNode(plan, currentNodeId).childIds) {
      descendants.push(childId);
      visit(childId);
    }
  };

  visit(nodeId);
  return descendants;
}

function clonePlan(plan: PlanSnapshot): PlanSnapshot {
  return structuredClone(plan);
}
