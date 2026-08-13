import type { PlanSnapshot } from "./plan-types";
import { getKindLabel, getStatusLabel } from "./presentation";

export type NodePromptState = { text: string; source: "derived" | "custom"; stale: boolean };

export function deriveNodePrompt(snapshot: PlanSnapshot, nodeId: string): string | undefined {
  const node = snapshot.nodes[nodeId];
  if (!node) return undefined;
  const names = (ids: readonly string[]) => ids.map((id) => snapshot.nodes[id]?.title ?? id).join("、") || "无";
  return [
    "你正在处理 PlanTree 中的节点。",
    "",
    `节点：${node.title}`,
    `类型：${getKindLabel(node)}`,
    `状态：${getStatusLabel(node, snapshot)}`,
    `目标：${node.objective}`,
    `父节点：${node.parentId ? snapshot.nodes[node.parentId]?.title ?? node.parentId : "无（根任务）"}`,
    `直接子节点：${names(node.childIds)}`,
    `前置依赖：${names(node.dependsOn)}`,
    "",
    "请保持任务树的结构、依赖和版本一致性，只提出与该节点相关的下一步建议。",
  ].join("\n");
}

export function getNodePromptState(snapshot: PlanSnapshot, nodeId: string): NodePromptState | undefined {
  const node = snapshot.nodes[nodeId];
  if (!node) return undefined;
  if (node.customPrompt !== undefined) {
    return {
      text: node.customPrompt,
      source: "custom",
      stale: node.customPromptBaseVersion !== undefined && node.version > node.customPromptBaseVersion,
    };
  }
  const text = deriveNodePrompt(snapshot, nodeId);
  return text === undefined ? undefined : { text, source: "derived", stale: false };
}

export function validateCustomPrompt(value: string): string | undefined {
  return value.trim() ? undefined : "提示词不能为空。";
}
