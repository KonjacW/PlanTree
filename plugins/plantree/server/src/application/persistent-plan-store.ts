import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { initialDemoPlan } from "../domain/demo.js";
import type { PlanSnapshot } from "../domain/types.js";

const conflictMessage = "任务树已被其他入口更新，请刷新后重试。";

export class PlanVersionConflictError extends Error {
  constructor(readonly snapshot: PlanSnapshot) {
    super(conflictMessage);
    this.name = "PlanVersionConflictError";
  }
}

export class PersistentPlanStore {
  constructor(private readonly filePath: string, private readonly initialPlan: PlanSnapshot = initialDemoPlan) {}

  async read(): Promise<PlanSnapshot> {
    try {
      await access(this.filePath);
    } catch {
      const initial = structuredClone(this.initialPlan);
      await this.writeAtomically(initial);
      return initial;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!isPlanSnapshot(parsed)) throw new Error();
      return structuredClone(parsed);
    } catch {
      throw new Error("任务树状态文件无效。");
    }
  }

  async write(snapshot: PlanSnapshot, expectedVersion: number): Promise<PlanSnapshot> {
    const current = await this.read();
    if (current.version !== expectedVersion) throw new PlanVersionConflictError(current);
    await this.writeAtomically(snapshot);
    return structuredClone(snapshot);
  }

  async reset(expectedVersion: number): Promise<PlanSnapshot> {
    return this.write({ ...structuredClone(this.initialPlan), version: expectedVersion + 1 }, expectedVersion);
  }

  private async writeAtomically(snapshot: PlanSnapshot): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Partial<PlanSnapshot>;
  const version = snapshot.version;
  return typeof snapshot.id === "string" && typeof snapshot.rootNodeId === "string"
    && Number.isInteger(version) && typeof version === "number" && version >= 0
    && typeof snapshot.nodes === "object" && snapshot.nodes !== null
    && snapshot.rootNodeId in snapshot.nodes
    && typeof snapshot.validation === "object" && snapshot.validation !== null
    && Array.isArray(snapshot.audit);
}
