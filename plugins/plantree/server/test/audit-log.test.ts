import { describe, expect, it } from "vitest";

import { appendAuditEntry } from "../src/domain/audit-log.js";
import { initialDemoPlan } from "../src/domain/demo.js";

describe("只追加审计日志", () => {
  it("追加重规划事件而不修改现有日志，并保留完整可追溯字段", () => {
    const result = appendAuditEntry(initialDemoPlan, {
      timestamp: "2026-08-11T00:01:00.000Z",
      type: "replanned",
      nodeIds: ["repair"],
      versionBefore: 1,
      versionAfter: 2,
      affectedNodeIds: ["repair", "test", "verify"],
      outcome: "success",
      summary: "已为修复阶段生成固定子任务。",
    });

    expect(initialDemoPlan.audit).toHaveLength(1);
    expect(result.audit).toHaveLength(2);
    expect(result.audit[0]).toEqual(initialDemoPlan.audit[0]);
    expect(result.audit[1]).toEqual({
      id: "audit-002",
      timestamp: "2026-08-11T00:01:00.000Z",
      type: "replanned",
      nodeIds: ["repair"],
      versionBefore: 1,
      versionAfter: 2,
      affectedNodeIds: ["repair", "test", "verify"],
      outcome: "success",
      summary: "已为修复阶段生成固定子任务。",
    });
  });
});
