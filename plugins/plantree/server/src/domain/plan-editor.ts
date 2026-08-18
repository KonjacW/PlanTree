import { listDescendantIds, PlanRepository } from "./plan-repository.js";
import type { AcceptanceCriterion, NodeKind, PlanNode, PlanSnapshot } from "./types.js";

type NewNode = {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly kind: NodeKind;
  readonly dependsOn: readonly string[];
  readonly method?: string;
  readonly acceptance?: readonly AcceptanceCriterion[];
};

export type EditCommand =
  | { readonly type: "add"; readonly parentId: string; readonly node: NewNode }
  | {
      readonly type: "rewrite";
      readonly nodeId: string;
      readonly objective: string;
      readonly title?: string;
      readonly method?: string | null;
      readonly acceptance?: readonly AcceptanceCriterion[];
    }
  | { readonly type: "expand"; readonly nodeId: string }
  | { readonly type: "prune"; readonly nodeId: string }
  | { readonly type: "prompt"; readonly nodeId: string; readonly customPrompt?: string }
  | { readonly type: "move"; readonly nodeId: string; readonly parentId: string; readonly position: number };

type MutablePlan = {
  id: string;
  version: number;
  rootNodeId: string;
  nodes: Record<string, PlanNode>;
  validation: PlanSnapshot["validation"];
  audit: PlanSnapshot["audit"];
};

export class PlanEditor {
  readonly #repository: PlanRepository;
  readonly #undoStack: PlanSnapshot[] = [];

  constructor(initialSnapshot: PlanSnapshot) {
    this.#repository = new PlanRepository(initialSnapshot);
  }

  read(): PlanSnapshot {
    return this.#repository.read();
  }

  apply(command: EditCommand): PlanSnapshot {
    const before = this.#repository.read();
    const next = structuredClone(before) as MutablePlan;

    switch (command.type) {
      case "add":
        applyAdd(next, command);
        break;
      case "rewrite":
        applyRewrite(next, command);
        break;
      case "expand":
        applyExpand(next, command);
        break;
      case "prune":
        applyPrune(next, command);
        break;
      case "prompt":
        applyPrompt(next, command);
        break;
      case "move":
        applyMove(next, command);
        break;
    }

    assertNoDependencyCycles(next);
    next.version += 1;
    this.#undoStack.push(before);
    this.#repository.write(next);
    return this.read();
  }

  undo(): PlanSnapshot {
    const previous = this.#undoStack.pop();
    if (!previous) {
      throw new Error("没有可撤销的编辑。");
    }

    this.#repository.write(previous);
    return this.read();
  }
}

function applyAdd(plan: MutablePlan, command: Extract<EditCommand, { type: "add" }>): void {
  const parent = requireNode(plan, command.parentId);
  if (parent.kind === "task") {
    throw new Error("不能向可执行叶节点添加子节点。");
  }
  if (plan.nodes[command.node.id]) {
    throw new Error(`节点 "${command.node.id}" 已存在。`);
  }
  if (!command.node.title.trim() || !command.node.objective.trim()) {
    throw new Error("新节点的标题和目标不能为空。");
  }
  for (const dependencyId of command.node.dependsOn) {
    if (dependencyId !== command.node.id && !plan.nodes[dependencyId]) {
      throw new Error(`计划中不存在依赖节点 "${dependencyId}"。`);
    }
  }

  plan.nodes[command.node.id] = {
    id: command.node.id,
    title: command.node.title.trim(),
    objective: command.node.objective.trim(),
    kind: command.node.kind,
    status: "pending",
    parentId: parent.id,
    childIds: [],
    dependsOn: [...command.node.dependsOn],
    version: 1,
    source: "user",
    ...(command.node.method ? { method: command.node.method.trim() } : {}),
    ...(command.node.acceptance ? { acceptance: structuredClone(command.node.acceptance) } : {}),
  };
  plan.nodes[parent.id] = bumpNode(parent, {
    childIds: [...parent.childIds, command.node.id],
  });
}

function applyRewrite(
  plan: MutablePlan,
  command: Extract<EditCommand, { type: "rewrite" }>,
): void {
  if (!command.objective.trim()) {
    throw new Error("节点目标不能为空。");
  }
  if (command.title !== undefined && !command.title.trim()) {
    throw new Error("节点标题不能为空。");
  }
  if (typeof command.method === "string" && !command.method.trim()) {
    throw new Error("节点方法不能为空。");
  }
  const node = requireNode(plan, command.nodeId);
  const { customPrompt: _customPrompt, customPromptBaseVersion: _customPromptBaseVersion, ...structuredNode } = node;
  const rewritten = bumpNode(structuredNode, {
    ...(command.title === undefined ? {} : { title: command.title.trim() }),
    objective: command.objective.trim(),
    ...(typeof command.method === "string" ? { method: command.method.trim() } : {}),
    ...(command.acceptance === undefined ? {} : { acceptance: structuredClone(command.acceptance) }),
    status: "pending_planning",
  });
  if (command.method === null) {
    const { method: _method, ...withoutMethod } = rewritten;
    plan.nodes[node.id] = withoutMethod;
  } else {
    plan.nodes[node.id] = rewritten;
  }
}

function applyExpand(
  plan: MutablePlan,
  command: Extract<EditCommand, { type: "expand" }>,
): void {
  const node = requireNode(plan, command.nodeId);
  if (node.kind === "task") {
    throw new Error("可执行叶节点不能展开。");
  }
  plan.nodes[node.id] = bumpNode(node, { status: "pending_planning" });
}

function applyPrune(
  plan: MutablePlan,
  command: Extract<EditCommand, { type: "prune" }>,
): void {
  if (command.nodeId === plan.rootNodeId) {
    throw new Error("不能裁剪根节点。");
  }
  const nodeIds = [command.nodeId, ...listDescendantIds(plan, command.nodeId)];
  for (const nodeId of nodeIds) {
    const node = requireNode(plan, nodeId);
    plan.nodes[nodeId] = bumpNode(node, { status: "skipped" });
  }
}

function applyPrompt(
  plan: MutablePlan,
  command: Extract<EditCommand, { type: "prompt" }>,
): void {
  const node = requireNode(plan, command.nodeId);
  if (command.customPrompt !== undefined && !command.customPrompt.trim()) {
    throw new Error("提示词不能为空。");
  }
  if (command.customPrompt === undefined) {
    const { customPrompt: _customPrompt, customPromptBaseVersion: _customPromptBaseVersion, ...rest } = node;
    plan.nodes[node.id] = { ...rest, version: node.version + 1 };
    return;
  }
  const version = node.version + 1;
  plan.nodes[node.id] = {
    ...node,
    customPrompt: command.customPrompt.trim(),
    customPromptBaseVersion: version,
    version,
  };
}

function applyMove(
  plan: MutablePlan,
  command: Extract<EditCommand, { type: "move" }>,
): void {
  const parent = requireNode(plan, command.parentId);
  requireNode(plan, command.nodeId);
  const currentPosition = parent.childIds.indexOf(command.nodeId);
  if (currentPosition < 0) {
    throw new Error("节点不是指定父节点的直接子节点。");
  }
  if (!Number.isInteger(command.position) || command.position < 0 || command.position >= parent.childIds.length) {
    throw new Error("目标排序位置无效。");
  }

  const childIds = [...parent.childIds];
  childIds.splice(currentPosition, 1);
  childIds.splice(command.position, 0, command.nodeId);
  plan.nodes[parent.id] = bumpNode(parent, { childIds });
}

function requireNode(plan: MutablePlan, nodeId: string): PlanNode {
  const node = plan.nodes[nodeId];
  if (!node) {
    throw new Error(`计划中不存在节点 "${nodeId}"。`);
  }
  return node;
}

function bumpNode(node: PlanNode, updates: Partial<PlanNode>): PlanNode {
  return { ...node, ...updates, version: node.version + 1 };
}

function assertNoDependencyCycles(plan: MutablePlan): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      throw new Error("编辑会产生循环依赖。");
    }
    if (visited.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);
    for (const dependencyId of requireNode(plan, nodeId).dependsOn) {
      if (plan.nodes[dependencyId]) {
        visit(dependencyId);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of Object.keys(plan.nodes)) {
    visit(nodeId);
  }
}
