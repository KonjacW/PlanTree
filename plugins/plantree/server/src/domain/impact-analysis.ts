import { listDescendantIds } from "./plan-repository.js";
import type { PlanSnapshot } from "./types.js";

export interface ImpactAnalysis {
  readonly affectedNodeIds: readonly string[];
}

export function analyzeImpact(
  plan: PlanSnapshot,
  editedNodeId: string,
): ImpactAnalysis {
  const affectedNodeIds: string[] = [];
  const affected = new Set<string>();
  const add = (nodeId: string): void => {
    if (!affected.has(nodeId)) {
      affected.add(nodeId);
      affectedNodeIds.push(nodeId);
    }
  };

  add(editedNodeId);
  for (const descendantId of listDescendantIds(plan, editedNodeId)) {
    if (plan.nodes[descendantId].status !== "skipped") {
      add(descendantId);
    }
  }

  for (let index = 0; index < affectedNodeIds.length; index += 1) {
    const dependencyId = affectedNodeIds[index];
    for (const [nodeId, node] of Object.entries(plan.nodes)) {
      if (
        node.dependsOn.includes(dependencyId) &&
        node.status !== "completed" &&
        node.status !== "skipped"
      ) {
        add(nodeId);
      }
    }
  }

  return { affectedNodeIds };
}
