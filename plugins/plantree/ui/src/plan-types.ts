export type NodeStatus = "pending_planning" | "pending" | "in_progress" | "completed" | "skipped" | "invalid";
export type NodeKind = "goal" | "phase" | "task" | "checkpoint";
export type AcceptanceCriterion = { type: "test" | "metric" | "evaluation"; criterion: string };

export type PlanNode = { id: string; title: string; objective: string; kind: NodeKind; status: NodeStatus; parentId: string | null; childIds: readonly string[]; dependsOn: readonly string[]; version: number; source: "demo" | "user" | "planner"; method?: string; acceptance?: readonly AcceptanceCriterion[]; customPrompt?: string; customPromptBaseVersion?: number };
export type PlanSnapshot = { id: string; version: number; rootNodeId: string; nodes: Readonly<Record<string, PlanNode>>; validation: { valid: boolean; issues: readonly string[] }; audit: readonly { id: string; summary: string }[] };
export type ExecutionTaskEnvelope = { sequence: number; nodeId: string; status: NodeStatus; parentTasks: readonly { id: string; task: string }[]; childTasks: readonly { id: string; task: string }[]; prompt: string };
export type ExecutionChain = { schemaVersion: "1.0"; chainId: string; sourceTreeId: string; traversal: "depth-first-leaves"; taskCount: number; tasks: readonly ExecutionTaskEnvelope[] };
