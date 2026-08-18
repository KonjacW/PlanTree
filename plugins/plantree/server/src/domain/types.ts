export type NodeKind = "goal" | "phase" | "task" | "checkpoint";

export type NodeStatus =
  | "pending_planning"
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped"
  | "invalid";

export type AcceptanceType = "test" | "metric" | "evaluation";

export interface AcceptanceCriterion {
  readonly type: AcceptanceType;
  readonly criterion: string;
}

export interface PlanNode {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly kind: NodeKind;
  readonly status: NodeStatus;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly version: number;
  readonly source: "demo" | "user" | "planner";
  readonly method?: string;
  readonly acceptance?: readonly AcceptanceCriterion[];
  readonly customPrompt?: string;
  readonly customPromptBaseVersion?: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly type:
    | "initialized"
    | "edit_attempted"
    | "edited"
    | "impact_calculated"
    | "replanned"
    | "validated"
    | "execution_simulated"
    | "tree_imported"
    | "execution_started"
    | "execution_completed"
    | "undone"
    | "reset";
  readonly nodeIds: readonly string[];
  readonly versionBefore: number;
  readonly versionAfter: number;
  readonly affectedNodeIds: readonly string[];
  readonly outcome: "success" | "rejected" | "blocked";
  readonly summary: string;
}

export interface PlanSnapshot {
  readonly id: string;
  readonly version: number;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, PlanNode>>;
  readonly validation: ValidationResult;
  readonly audit: readonly AuditEntry[];
}
