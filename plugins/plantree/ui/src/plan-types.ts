export type NodeStatus = "pending_planning" | "pending" | "in_progress" | "completed" | "skipped" | "invalid";
export type NodeKind = "goal" | "phase" | "task" | "checkpoint";

export type PlanNode = { id: string; title: string; objective: string; kind: NodeKind; status: NodeStatus; parentId: string | null; childIds: readonly string[]; dependsOn: readonly string[]; version: number; source: "demo" | "user" | "planner"; customPrompt?: string; customPromptBaseVersion?: number };
export type PlanSnapshot = { id: string; version: number; rootNodeId: string; nodes: Readonly<Record<string, PlanNode>>; validation: { valid: boolean; issues: readonly string[] }; audit: readonly { id: string; summary: string }[] };
