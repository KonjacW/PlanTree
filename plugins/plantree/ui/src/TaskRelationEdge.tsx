import { BaseEdge, type EdgeProps } from "@xyflow/react";

export function getTaskRelationPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  sourceX = Math.round(sourceX);
  sourceY = Math.round(sourceY);
  targetX = Math.round(targetX);
  targetY = Math.round(targetY);
  const bend = Math.max(58, (targetX - sourceX) * 0.48);
  return `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`;
}

export function TaskRelationEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  const path = getTaskRelationPath(sourceX, sourceY, targetX, targetY);
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}
