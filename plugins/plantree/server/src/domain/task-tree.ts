import { validatePlan } from "./plan-validation.js";
import type { AcceptanceCriterion, PlanNode, PlanSnapshot } from "./types.js";

export interface TaskTreeNode {
  readonly id: string;
  readonly task: string;
  readonly method?: string;
  readonly acceptance?: readonly AcceptanceCriterion[];
}

export interface TaskTreeEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly order: number;
}

export interface TaskTree {
  readonly schemaVersion: "1.0";
  readonly treeId: string;
  readonly rootId: string;
  readonly nodes: readonly TaskTreeNode[];
  readonly edges: readonly TaskTreeEdge[];
}

const acceptanceTypes = new Set(["test", "metric", "evaluation"]);

export function validateTaskTree(value: unknown): { valid: boolean; issues: readonly string[] } {
  const issues: string[] = [];
  if (!isObject(value)) return { valid: false, issues: ["任务树必须是 JSON 对象。"] };
  if (value.schemaVersion !== "1.0") issues.push('schemaVersion 必须为 "1.0"。');
  if (!nonEmpty(value.treeId)) issues.push("treeId 不能为空。");
  if (!nonEmpty(value.rootId)) issues.push("rootId 不能为空。");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) issues.push("nodes 必须是非空数组。");
  if (!Array.isArray(value.edges)) issues.push("edges 必须是数组。");

  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const [index, raw] of nodes.entries()) {
    if (!isObject(raw)) { issues.push(`nodes[${index}] 必须是对象。`); continue; }
    if (!nonEmpty(raw.id)) issues.push(`nodes[${index}].id 不能为空。`);
    else if (nodeIds.has(raw.id)) issues.push(`节点 ID 重复：${raw.id}。`);
    else nodeIds.add(raw.id);
    if (!nonEmpty(raw.task)) issues.push(`nodes[${index}].task 不能为空。`);
    if (raw.method !== undefined && !nonEmpty(raw.method)) issues.push(`nodes[${index}].method 必须省略或为非空字符串。`);
    if (raw.acceptance !== undefined) {
      if (!Array.isArray(raw.acceptance) || raw.acceptance.length === 0) issues.push(`nodes[${index}].acceptance 必须省略或为非空数组。`);
      else for (const [criterionIndex, criterion] of raw.acceptance.entries()) {
        if (!isObject(criterion) || !acceptanceTypes.has(String(criterion.type)) || !nonEmpty(criterion.criterion)) {
          issues.push(`nodes[${index}].acceptance[${criterionIndex}] 必须包含合法 type 和非空 criterion。`);
        }
      }
    }
  }

  const incoming = new Map([...nodeIds].map((id) => [id, 0]));
  const children = new Map([...nodeIds].map((id) => [id, [] as TaskTreeEdge[]]));
  for (const [index, raw] of edges.entries()) {
    if (!isObject(raw)) { issues.push(`edges[${index}] 必须是对象。`); continue; }
    if (!nonEmpty(raw.id)) issues.push(`edges[${index}].id 不能为空。`);
    else if (edgeIds.has(raw.id)) issues.push(`边 ID 重复：${raw.id}。`);
    else edgeIds.add(raw.id);
    if (!nonEmpty(raw.source) || !nodeIds.has(raw.source)) issues.push(`edges[${index}].source 引用了不存在的节点。`);
    if (!nonEmpty(raw.target) || !nodeIds.has(raw.target)) issues.push(`edges[${index}].target 引用了不存在的节点。`);
    if (!Number.isInteger(raw.order) || Number(raw.order) < 0) issues.push(`edges[${index}].order 必须是非负整数。`);
    if (nonEmpty(raw.source) && nonEmpty(raw.target) && nodeIds.has(raw.source) && nodeIds.has(raw.target)) {
      incoming.set(raw.target, (incoming.get(raw.target) ?? 0) + 1);
      children.get(raw.source)?.push(raw as unknown as TaskTreeEdge);
    }
  }

  if (nonEmpty(value.rootId) && !nodeIds.has(value.rootId)) issues.push("rootId 引用了不存在的节点。");
  if (nodeIds.size > 0 && edges.length !== nodeIds.size - 1) issues.push("有向树的边数必须等于节点数减一。");
  for (const id of nodeIds) {
    const count = incoming.get(id) ?? 0;
    if (id === value.rootId ? count !== 0 : count !== 1) issues.push(`节点 "${id}" 的父节点数量无效。`);
  }
  for (const [parentId, values] of children) {
    values.sort((a, b) => a.order - b.order);
    values.forEach((edge, index) => { if (edge.order !== index) issues.push(`节点 "${parentId}" 的子节点 order 必须从 0 连续编号。`); });
  }

  if (nonEmpty(value.rootId) && nodeIds.has(value.rootId)) {
    const reached = new Set<string>();
    const visit = (id: string): void => {
      if (reached.has(id)) { issues.push(`父子关系存在循环：${id}。`); return; }
      reached.add(id);
      for (const edge of children.get(id) ?? []) visit(edge.target);
    };
    visit(value.rootId);
    for (const id of nodeIds) if (!reached.has(id)) issues.push(`节点 "${id}" 不可从根节点到达。`);
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function taskTreeToPlanSnapshot(tree: TaskTree, version = 1): PlanSnapshot {
  const validation = validateTaskTree(tree);
  if (!validation.valid) throw new Error(`无法导入无效任务树：${validation.issues[0]}`);
  const children = new Map<string, TaskTreeEdge[]>();
  const parents = new Map<string, string>();
  for (const edge of tree.edges) {
    const values = children.get(edge.source) ?? [];
    values.push(edge);
    children.set(edge.source, values);
    parents.set(edge.target, edge.source);
  }
  for (const values of children.values()) values.sort((a, b) => a.order - b.order);
  const nodes: Record<string, PlanNode> = {};
  for (const source of tree.nodes) {
    const childIds = (children.get(source.id) ?? []).map((edge) => edge.target);
    nodes[source.id] = {
      id: source.id,
      title: source.task,
      objective: source.task,
      kind: source.id === tree.rootId ? "goal" : childIds.length ? "phase" : source.acceptance?.length ? "checkpoint" : "task",
      status: "pending",
      parentId: parents.get(source.id) ?? null,
      childIds,
      dependsOn: [],
      version: 1,
      source: "planner",
      ...(source.method ? { method: source.method } : {}),
      ...(source.acceptance ? { acceptance: structuredClone(source.acceptance) } : {}),
    };
  }
  const snapshot: PlanSnapshot = {
    id: tree.treeId,
    version,
    rootNodeId: tree.rootId,
    nodes,
    validation: { valid: true, issues: [] },
    audit: [{
      id: `audit-import-${version}`,
      timestamp: new Date().toISOString(),
      type: "tree_imported",
      nodeIds: [tree.rootId],
      versionBefore: Math.max(0, version - 1),
      versionAfter: version,
      affectedNodeIds: tree.nodes.map((node) => node.id),
      outcome: "success",
      summary: `已导入任务树“${tree.treeId}”。`,
    }],
  };
  const planValidation = validatePlan(snapshot);
  if (!planValidation.valid) throw new Error(`无法导入无效计划：${planValidation.issues[0]}`);
  return snapshot;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
