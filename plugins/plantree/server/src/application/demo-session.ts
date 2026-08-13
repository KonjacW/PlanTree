import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { analyzeImpact } from "../domain/impact-analysis.js";
import { appendAuditEntry } from "../domain/audit-log.js";
import { initialDemoPlan } from "../domain/demo.js";
import { type EditCommand, PlanEditor } from "../domain/plan-editor.js";
import { synchronizeDependencies } from "../domain/plan-validation.js";
import { simulateExecution } from "../domain/execution-simulator.js";
import { replan } from "../domain/simulated-planner.js";
import type { PlanSnapshot } from "../domain/types.js";
import { PersistentPlanStore, PlanVersionConflictError } from "./persistent-plan-store.js";

export interface DemoLoadResult { readonly snapshot: PlanSnapshot; readonly summary: string; }

export function createOrLoadDemo(): DemoLoadResult {
  return { snapshot: structuredClone(initialDemoPlan), summary: "已加载 PlanTree 缺陷修复演示任务。" };
}

export function getDefaultStorePath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/plantree-plan.json");
}

export class DemoSession {
  #undoStack: PlanSnapshot[] = [];
  #redoStack: PlanSnapshot[] = [];
  #historyHeadVersion: number | undefined;

  constructor(private readonly store = new PersistentPlanStore(getDefaultStorePath())) {}

  async read(): Promise<DemoLoadResult> { return { snapshot: await this.store.read(), summary: "已读取 PlanTree 演示会话。" }; }

  async edit(command: EditCommand, expectedVersion: number): Promise<DemoLoadResult> {
    const before = await this.store.read();
    const editor = new PlanEditor(before);
    const edited = editor.apply(command);
    const nodeId = command.type === "add" ? command.node.id : command.nodeId;
    const replanned = command.type === "move" || command.type === "prompt" ? edited : replan(edited, command).snapshot;
    const prepared = command.type === "prompt" ? appendAuditEntry(replanned, {
      timestamp: new Date().toISOString(),
      type: "edited",
      nodeIds: [command.nodeId],
      versionBefore: before.version,
      versionAfter: replanned.version,
      affectedNodeIds: [command.nodeId],
      outcome: "success",
      summary: command.customPrompt === undefined ? "已恢复自动提示词。" : "已保存人工提示词。",
    }) : replanned;
    const snapshot = await this.store.write(synchronizeDependencies(prepared), expectedVersion);
    if (this.#historyHeadVersion !== undefined && before.version !== this.#historyHeadVersion) this.#undoStack = [];
    this.#undoStack.push(before);
    this.#redoStack = [];
    this.#historyHeadVersion = snapshot.version;
    const impact = analyzeImpact(snapshot, nodeId);
    return { snapshot, summary: `已更新计划，影响节点：${impact.affectedNodeIds.join("、")}。` };
  }

  async move(nodeId: string, parentId: string, position: number, expectedVersion: number): Promise<DemoLoadResult> {
    return this.edit({ type: "move", nodeId, parentId, position }, expectedVersion);
  }

  async undo(expectedVersion: number): Promise<DemoLoadResult> {
    const previous = this.#undoStack.at(-1);
    if (!previous) throw new Error("没有可撤销的编辑。");
    const current = await this.store.read();
    this.#assertHistoryCurrent(current, expectedVersion);
    const snapshot = await this.store.write({ ...previous, version: current.version + 1 }, expectedVersion);
    this.#undoStack.pop();
    this.#redoStack.push(current);
    this.#historyHeadVersion = snapshot.version;
    return { snapshot, summary: "已撤销上一次编辑。" };
  }

  async redo(expectedVersion: number): Promise<DemoLoadResult> {
    const next = this.#redoStack.at(-1);
    if (!next) throw new Error("没有可重做的编辑。");
    const current = await this.store.read();
    this.#assertHistoryCurrent(current, expectedVersion);
    const snapshot = await this.store.write({ ...next, version: current.version + 1 }, expectedVersion);
    this.#redoStack.pop();
    this.#undoStack.push(current);
    this.#historyHeadVersion = snapshot.version;
    return { snapshot, summary: "已重做上一次编辑。" };
  }

  async reset(expectedVersion: number): Promise<DemoLoadResult> {
    const snapshot = await this.store.reset(expectedVersion);
    this.#undoStack = [];
    this.#redoStack = [];
    this.#historyHeadVersion = snapshot.version;
    return { snapshot, summary: "已加载 PlanTree 缺陷修复演示任务。" };
  }

  async simulate(nodeId: string, expectedVersion: number): Promise<DemoLoadResult> {
    const before = await this.store.read();
    const result = simulateExecution(before, nodeId);
    if (result.blocker) return { snapshot: before, summary: result.blocker };
    const snapshot = await this.store.write(result.completed, expectedVersion);
    if (this.#historyHeadVersion !== undefined && before.version !== this.#historyHeadVersion) this.#undoStack = [];
    this.#undoStack.push(before);
    this.#redoStack = [];
    this.#historyHeadVersion = snapshot.version;
    return { snapshot, summary: `已完成节点 "${nodeId}" 的模拟执行。` };
  }

  #assertHistoryCurrent(current: PlanSnapshot, expectedVersion: number): void {
    if (current.version !== expectedVersion || current.version !== this.#historyHeadVersion) {
      throw new PlanVersionConflictError(current);
    }
  }
}
