import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { analyzeImpact } from "../domain/impact-analysis.js";
import { appendAuditEntry } from "../domain/audit-log.js";
import { initialDemoPlan } from "../domain/demo.js";
import { buildExecutionChain, type ExecutionChain, type ExecutionTaskEnvelope } from "../domain/execution-chain.js";
import { type EditCommand, PlanEditor } from "../domain/plan-editor.js";
import { synchronizeDependencies } from "../domain/plan-validation.js";
import { beginExecution, completeExecution, simulateExecution } from "../domain/execution-simulator.js";
import { replan } from "../domain/simulated-planner.js";
import { taskTreeToPlanSnapshot, type TaskTree } from "../domain/task-tree.js";
import type { PlanSnapshot } from "../domain/types.js";
import { PersistentPlanStore, PlanVersionConflictError } from "./persistent-plan-store.js";

export interface DemoLoadResult { readonly snapshot: PlanSnapshot; readonly summary: string; }
export interface ExecutionChainResult extends DemoLoadResult { readonly chain: ExecutionChain; }
export interface ExecutionStepResult extends ExecutionChainResult {
  readonly task?: ExecutionTaskEnvelope;
  readonly done: boolean;
}

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

  async importTaskTree(tree: TaskTree, expectedVersion: number): Promise<DemoLoadResult> {
    const before = await this.store.read();
    const imported = taskTreeToPlanSnapshot(tree, before.version + 1);
    const snapshot = await this.store.write(imported, expectedVersion);
    this.#undoStack = [];
    this.#redoStack = [];
    this.#historyHeadVersion = snapshot.version;
    return { snapshot, summary: `已导入任务树“${tree.treeId}”，共 ${tree.nodes.length} 个节点。` };
  }

  async compileExecutionChain(): Promise<ExecutionChainResult> {
    const snapshot = await this.store.read();
    const chain = buildExecutionChain(snapshot);
    return { snapshot, chain, summary: `已按深度优先叶节点顺序生成 ${chain.taskCount} 个执行任务。` };
  }

  async startNext(expectedVersion: number): Promise<ExecutionStepResult> {
    const before = await this.store.read();
    this.#assertExpectedVersion(before, expectedVersion);
    const currentChain = buildExecutionChain(before);
    const active = currentChain.tasks.find((task) => task.status === "in_progress");
    if (active) return { snapshot: before, chain: currentChain, task: active, done: false, summary: `节点“${active.nodeId}”正在执行。` };
    const nextTask = currentChain.tasks.find((task) => task.status !== "completed");
    if (!nextTask) return { snapshot: before, chain: currentChain, done: true, summary: "执行链中的任务已全部完成。" };

    const started = beginExecution(before, nextTask.nodeId);
    const prepared = appendAuditEntry(started, {
      timestamp: new Date().toISOString(),
      type: "execution_started",
      nodeIds: [nextTask.nodeId],
      versionBefore: before.version,
      versionAfter: started.version,
      affectedNodeIds: [nextTask.nodeId],
      outcome: "success",
      summary: `已开始执行节点“${nextTask.nodeId}”。`,
    });
    const snapshot = await this.store.write(prepared, expectedVersion);
    this.#recordMutation(before, snapshot);
    const chain = buildExecutionChain(snapshot);
    const task = chain.tasks.find((item) => item.nodeId === nextTask.nodeId);
    return { snapshot, chain, task, done: false, summary: `已领取执行链中的第 ${nextTask.sequence} 个任务。` };
  }

  async complete(nodeId: string, expectedVersion: number): Promise<ExecutionStepResult> {
    const before = await this.store.read();
    this.#assertExpectedVersion(before, expectedVersion);
    const beforeChain = buildExecutionChain(before);
    const active = beforeChain.tasks.find((task) => task.status === "in_progress");
    if (!active) throw new Error("当前没有正在执行的任务。");
    if (active.nodeId !== nodeId) throw new Error(`当前应完成节点“${active.nodeId}”，不能跳过执行顺序。`);

    const completed = completeExecution(before, nodeId);
    const prepared = appendAuditEntry(completed, {
      timestamp: new Date().toISOString(),
      type: "execution_completed",
      nodeIds: [nodeId],
      versionBefore: before.version,
      versionAfter: completed.version,
      affectedNodeIds: [nodeId],
      outcome: "success",
      summary: `已完成执行节点“${nodeId}”。`,
    });
    const snapshot = await this.store.write(prepared, expectedVersion);
    this.#recordMutation(before, snapshot);
    const chain = buildExecutionChain(snapshot);
    const nextTask = chain.tasks.find((task) => task.status !== "completed");
    return {
      snapshot,
      chain,
      ...(nextTask ? { task: nextTask } : {}),
      done: nextTask === undefined,
      summary: nextTask ? `已完成节点“${nodeId}”；下一任务为“${nextTask.nodeId}”。` : "执行链中的任务已全部完成。",
    };
  }

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

  #recordMutation(before: PlanSnapshot, snapshot: PlanSnapshot): void {
    if (this.#historyHeadVersion !== undefined && before.version !== this.#historyHeadVersion) this.#undoStack = [];
    this.#undoStack.push(before);
    this.#redoStack = [];
    this.#historyHeadVersion = snapshot.version;
  }

  #assertExpectedVersion(current: PlanSnapshot, expectedVersion: number): void {
    if (current.version !== expectedVersion) throw new PlanVersionConflictError(current);
  }

  #assertHistoryCurrent(current: PlanSnapshot, expectedVersion: number): void {
    if (current.version !== expectedVersion || current.version !== this.#historyHeadVersion) {
      throw new PlanVersionConflictError(current);
    }
  }
}
