import type { PlanSnapshot } from "./plan-types";

const acceptanceLabels = { test: "测试", metric: "指标", evaluation: "评价" } as const;

export type NodePromptState = { text: string; source: "derived" | "custom"; stale: boolean };

export function deriveNodePrompt(snapshot: PlanSnapshot, nodeId: string): string | undefined {
  const node = snapshot.nodes[nodeId];
  if (!node) return undefined;
  const sections = [`### 任务\n\n仅完成：${node.objective}`];
  if (node.method) sections.push(`### 方法\n\n${node.method}`);
  if (node.acceptance?.length) {
    sections.push(`### 验收\n\n${node.acceptance.map((item) => `- **${acceptanceLabels[item.type]}**：${item.criterion}`).join("\n")}`);
  } else {
    sections.push("### 验收\n\n完成后自行评价当前任务是否完成，并简要说明判断依据。");
  }
  return sections.join("\n\n");
}

export function getNodePromptState(snapshot: PlanSnapshot, nodeId: string): NodePromptState | undefined {
  const text = deriveNodePrompt(snapshot, nodeId);
  return text === undefined ? undefined : { text, source: "derived", stale: false };
}

export function validateCustomPrompt(value: string): string | undefined {
  return value.trim() ? undefined : "提示词不能为空。";
}
