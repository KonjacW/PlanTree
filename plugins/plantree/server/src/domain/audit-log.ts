import type { AuditEntry, PlanSnapshot } from "./types.js";

export type NewAuditEntry = Omit<AuditEntry, "id">;

export function appendAuditEntry(
  plan: PlanSnapshot,
  entry: NewAuditEntry,
): PlanSnapshot {
  const id = `audit-${String(plan.audit.length + 1).padStart(3, "0")}`;
  return {
    ...plan,
    audit: [...plan.audit, { id, ...entry }],
  };
}
