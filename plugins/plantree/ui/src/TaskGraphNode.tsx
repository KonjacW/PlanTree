import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { TaskGraphNodeData } from "./graph-model";
import { getGraphStatusLabel, getKindLabel } from "./presentation";

export function TaskGraphNode({ data, selected }: NodeProps & { data: TaskGraphNodeData }) {
  const { task, blocked, executable } = data;
  return <article className={`plantree-graph-node ${task.status === "completed" ? "done" : ""} ${blocked ? "blocked" : ""} ${task.parentId === null ? "root" : ""} ${selected ? "selected" : ""}`} aria-label={`${task.title}，${getGraphStatusLabel(task, blocked)}`}>
    <Handle type="target" position={Position.Left} />
    <div className="node-top"><span className="node-type">{getKindLabel(task)}</span><i className="node-state" /></div>
    <strong>{task.title}</strong><span title={task.objective}>{task.objective}</span>
    <Handle type="source" position={Position.Right} />
  </article>;
}
