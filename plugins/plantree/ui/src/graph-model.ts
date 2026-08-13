import { Position, type Edge, type Node, type NodeHandle } from "@xyflow/react";

import type { PlanNode, PlanSnapshot } from "./plan-types";

export type TaskGraphNodeData = { task: PlanNode; blocked: boolean; executable: boolean };
export type TaskGraphEdge = Edge<{ relation: "tree" | "dependency" }>;
export type TaskGraph = { nodes: Node<TaskGraphNodeData>[]; edges: TaskGraphEdge[] };

const nodeWidth = 151;
const nodeHeight = 75;
const firstLevelGap = 128;
const expandedFirstLevelGap = 188;
const childGap = 126;
const nodeHandles: NodeHandle[] = [
  { id: null, type: "target", position: Position.Left, x: 0, y: nodeHeight / 2, width: 1, height: 1 },
  { id: null, type: "source", position: Position.Right, x: nodeWidth, y: nodeHeight / 2, width: 1, height: 1 },
];

function isVisible(node: PlanNode | undefined): node is PlanNode { return Boolean(node && node.status !== "skipped"); }

function xForDepth(depth: number): number {
  if (depth === 0) return 34;
  return 276 + (depth - 1) * 244;
}

type PositionedNode = { id: string; depth: number; y: number };

function shiftLayout(layout: PositionedNode[], offset: number): PositionedNode[] {
  return offset === 0 ? layout : layout.map((item) => ({ ...item, y: item.y + offset }));
}

function requiredLayoutShift(existing: PositionedNode[], incoming: PositionedNode[]): number {
  let shift = 0;
  const depths = new Set(incoming.map((item) => item.depth));
  for (const depth of depths) {
    const existingAtDepth = existing.filter((item) => item.depth === depth).map((item) => item.y);
    const incomingAtDepth = incoming.filter((item) => item.depth === depth).map((item) => item.y);
    if (!existingAtDepth.length || !incomingAtDepth.length) continue;
    shift = Math.max(shift, Math.max(...existingAtDepth) + childGap - Math.min(...incomingAtDepth));
  }
  return Math.max(0, shift);
}

function layoutSubtree(snapshot: PlanSnapshot, nodeId: string, depth: number, y: number): PositionedNode[] {
  const node = snapshot.nodes[nodeId];
  if (!isVisible(node)) return [];
  let layout: PositionedNode[] = [{ id: node.id, depth, y }];
  const children = node.childIds.filter((childId) => isVisible(snapshot.nodes[childId]));
  children.forEach((childId, childOrder) => {
    const incoming = layoutSubtree(snapshot, childId, depth + 1, y - 20 + childOrder * childGap);
    layout = layout.concat(shiftLayout(incoming, requiredLayoutShift(layout, incoming)));
  });
  return layout;
}

export function isExecutable(node: PlanNode, nodes: Readonly<Record<string, PlanNode>>): boolean {
  return node.kind === "task" && node.status === "pending" && node.dependsOn.every((id) => nodes[id]?.status === "completed");
}

export function snapshotToGraph(snapshot: PlanSnapshot): TaskGraph {
  const positions = new Map<string, { x: number; y: number }>();
  const root = snapshot.nodes[snapshot.rootNodeId];
  if (isVisible(root)) positions.set(root.id, { x: 34, y: 268 });
  let layout: PositionedNode[] = [];
  let firstLevelY = 66;
  root?.childIds.filter((childId) => isVisible(snapshot.nodes[childId])).forEach((childId) => {
    const child = snapshot.nodes[childId];
    const incoming = layoutSubtree(snapshot, childId, 1, firstLevelY);
    const shifted = shiftLayout(incoming, requiredLayoutShift(layout, incoming));
    layout = layout.concat(shifted);
    firstLevelY = shifted[0].y + (child.childIds.some((grandchildId) => isVisible(snapshot.nodes[grandchildId])) ? expandedFirstLevelGap : firstLevelGap);
  });
  layout.forEach((item) => positions.set(item.id, { x: xForDepth(item.depth), y: item.y }));
  const visibleIds = new Set(positions.keys());
  const nodes = [...visibleIds].map((id) => {
    const task = snapshot.nodes[id];
    return { id, type: "task", width: nodeWidth, height: nodeHeight, handles: nodeHandles, position: positions.get(id)!, data: { task, blocked: task.dependsOn.some((dependency) => snapshot.nodes[dependency]?.status !== "completed"), executable: isExecutable(task, snapshot.nodes) } };
  });
  const edges: TaskGraphEdge[] = [];
  for (const sourceId of visibleIds) {
    const node = snapshot.nodes[sourceId];
    for (const targetId of node.childIds) if (visibleIds.has(targetId)) edges.push({ id: `tree:${sourceId}:${targetId}`, source: sourceId, target: targetId, type: "taskRelation", className: "edge-tree", data: { relation: "tree" } });
    for (const dependencyId of node.dependsOn) if (visibleIds.has(dependencyId)) edges.push({ id: `dependency:${dependencyId}:${sourceId}`, source: dependencyId, target: sourceId, type: "taskRelation", className: "edge-dependency", data: { relation: "dependency" } });
  }
  return { nodes, edges };
}
