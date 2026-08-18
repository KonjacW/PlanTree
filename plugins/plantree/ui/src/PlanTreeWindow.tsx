import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, applyNodeChanges, useReactFlow, type NodeChange, type OnNodesChange, type Viewport } from "@xyflow/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import "@xyflow/react/dist/style.css";

import { snapshotToGraph } from "./graph-model";
import type { AcceptanceCriterion, ExecutionChain, ExecutionTaskEnvelope, PlanNode, PlanSnapshot } from "./plan-types";
import { getNodePromptState } from "./prompt";
import { getKindLabel, getStatusLabel } from "./presentation";
import { TaskGraphNode } from "./TaskGraphNode";
import { TaskRelationEdge } from "./TaskRelationEdge";
import "./PlanTreeWindow.css";

const nodeTypes = { task: TaskGraphNode };
const edgeTypes = { taskRelation: TaskRelationEdge };
export const previewInteractionProps = {
  panOnDrag: [0, 2] as number[],
  selectionOnDrag: false,
  selectionKeyCode: "Control+Shift",
};
export function getPreviewViewport(width: number, height: number) {
  const zoom = Math.max(0.38, Math.min(1, (width - 44) / 980, (height - 42) / 620));
  return { x: (width - 980 * zoom) / 2, y: (height - 620 * zoom) / 2 + 10, zoom };
}
function clampPreviewZoom(zoom: number): number { return Math.max(0.52, Math.min(1.35, zoom)); }
export type PreviewBounds = { minX: number; minY: number; maxX: number; maxY: number };
export function getFittedPreviewViewport(width: number, height: number, bounds: PreviewBounds): Viewport {
  const padding = 24;
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const zoom = Math.max(0.5, Math.min(1.05, (width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight));
  return {
    x: (width - contentWidth * zoom) / 2 - bounds.minX * zoom,
    y: (height - contentHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}
export function getPreviewControlViewport(viewport: Viewport, direction: "in" | "out"): Viewport {
  return { ...viewport, zoom: clampPreviewZoom(direction === "in" ? viewport.zoom * 1.15 : viewport.zoom / 1.15) };
}
export function getPreviewWheelViewport(viewport: Viewport, pointer: { x: number; y: number }, deltaY: number): Viewport {
  const before = { x: (pointer.x - viewport.x) / viewport.zoom, y: (pointer.y - viewport.y) / viewport.zoom };
  const zoom = clampPreviewZoom(viewport.zoom * (deltaY < 0 ? 1.1 : 0.9));
  return { x: pointer.x - before.x * zoom, y: pointer.y - before.y * zoom, zoom };
}
type LegacyPlan = { title: string; root: { id: string; title: string; status: "pending" | "running" | "complete" | "blocked" } };
export type PlanTreeWindowProps = { plan: PlanSnapshot | LegacyPlan };
export type ToolCaller = (name: string, args?: Record<string, unknown>) => Promise<unknown>;
export type CodexExecutionHandoff = { message: string; snapshot: PlanSnapshot; chain: ExecutionChain };
export type MessageSender = (handoff: CodexExecutionHandoff) => Promise<void>;
type PendingPromptAction =
  | { type: "close" }
  | { type: "selection"; ids: string[] }
  | { type: "help" }
  | { type: "chain" }
  | { type: "handoff" }
  | { type: "prune"; ids: string[] }
  | { type: "command"; name: string; args?: Record<string, unknown> };
type NodeContentDraft = {
  task: string;
  method: string;
  acceptance: AcceptanceCriterion[];
};
function createNodeContentDraft(node: PlanNode): NodeContentDraft {
  return {
    task: node.objective,
    method: node.method ?? "",
    acceptance: node.acceptance?.map((item) => ({ ...item })) ?? [],
  };
}
function sameNodeContent(left: NodeContentDraft, right: NodeContentDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function validateNodeContent(draft: NodeContentDraft): string | undefined {
  if (!draft.task.trim()) return "任务不能为空。";
  if (draft.acceptance.some((item) => !item.criterion.trim())) return "验收要求不能为空；不需要时请删除该条。";
  return undefined;
}
export function createAppToolCaller(app: Pick<App, "callServerTool">): ToolCaller {
  return async (name, args = {}) => {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) {
      const message = result.content.find((item) => item.type === "text")?.text ?? "PlanTree MCP 工具调用失败。";
      const error = new Error(message) as Error & { snapshot?: unknown };
      error.snapshot = result.structuredContent?.snapshot;
      throw error;
    }
    return result;
  };
}
type AppMessageBridge = Pick<App, "sendMessage"> & Partial<Pick<App, "getHostCapabilities" | "updateModelContext">>;
export function createAppMessageSender(app: AppMessageBridge): MessageSender {
  return async ({ message, snapshot, chain }) => {
    const capabilities = app.getHostCapabilities?.();
    if (capabilities && !capabilities.message?.text) {
      throw new Error("当前 Codex 宿主不支持从 PlanTree 启动自动执行，请更新 Codex 后重试。");
    }
    if (app.updateModelContext && capabilities?.updateModelContext?.text) {
      await app.updateModelContext({
        content: [{ type: "text", text: `PlanTree 已确认计划 ${snapshot.id} 的执行链，快照版本 ${snapshot.version}。` }],
        ...(capabilities.updateModelContext.structuredContent ? { structuredContent: { planTreeExecution: { planId: snapshot.id, snapshotVersion: snapshot.version, chain } } } : {}),
      });
    }
    const result = await app.sendMessage({ role: "user", content: [{ type: "text", text: message }] });
    if (result.isError) throw new Error("Codex 宿主拒绝接收 PlanTree 执行消息。");
  };
}
export function buildCodexExecutionMessage(snapshot: PlanSnapshot, chain: ExecutionChain): string {
  const remaining = chain.tasks.filter((task) => task.status !== "completed");
  return [
    "执行我刚刚在 PlanTree UI 中确认的剩余任务链。不要重新规划，也不要调用 simulate_execution。",
    `当前计划：${snapshot.id}，快照版本：${snapshot.version}。`,
    `确认的剩余顺序：${remaining.map((task) => task.nodeId).join(" → ") || "无"}。`,
    "执行协议：",
    "1. 调用 start_next_task，并以工具返回的 task.prompt 作为当前唯一任务要求。若已有 in_progress 节点，继续该节点。",
    "2. 实际完成任务并按 task.prompt 的验收要求检查；没有显式验收时做 Agent 自评。不要只复述计划。",
    "3. 只有任务确实完成且验收通过后，才调用 complete_task；随后再次调用 start_next_task。",
    "4. 重复直到 start_next_task 返回 done=true。若失败、被阻塞、需要用户批准或验收未通过，保留当前节点为 in_progress，停止并向我说明，不得虚假标记完成。",
    "5. 不执行 skipped 节点，不越过当前节点，不自行添加计划外任务。",
  ].join("\n");
}
function isSnapshot(plan: PlanTreeWindowProps["plan"]): plan is PlanSnapshot { return "nodes" in plan && "rootNodeId" in plan; }
function normalizePlan(plan: PlanTreeWindowProps["plan"]): PlanSnapshot {
  if (isSnapshot(plan)) return plan;
  const status = plan.root.status === "running" ? "in_progress" : plan.root.status === "complete" ? "completed" : plan.root.status === "blocked" ? "invalid" : "pending";
  return { id: "legacy-plan", version: 1, rootNodeId: plan.root.id, nodes: { [plan.root.id]: { id: plan.root.id, title: plan.root.title, objective: plan.title, kind: "goal", status, parentId: null, childIds: [], dependsOn: [], version: 1, source: "demo" } }, validation: { valid: true, issues: [] }, audit: [] };
}
function snapshotFromToolResult(result: unknown): { snapshot: PlanSnapshot; summary?: string } | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as { structuredContent?: { snapshot?: unknown; summary?: unknown }; snapshot?: unknown; summary?: unknown };
  const snapshot = value.structuredContent?.snapshot ?? value.snapshot; const summary = value.structuredContent?.summary ?? value.summary;
  return snapshot && typeof snapshot === "object" && "rootNodeId" in snapshot && "nodes" in snapshot ? { snapshot: snapshot as PlanSnapshot, summary: typeof summary === "string" ? summary : undefined } : undefined;
}
function executionFromToolResult(result: unknown): { snapshot: PlanSnapshot; summary?: string; chain: ExecutionChain; task?: ExecutionTaskEnvelope; done?: boolean } | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as { structuredContent?: Record<string, unknown> } & Record<string, unknown>;
  const data = value.structuredContent ?? value;
  const snapshot = data.snapshot; const chain = data.chain;
  if (!snapshot || typeof snapshot !== "object" || !("rootNodeId" in snapshot) || !chain || typeof chain !== "object" || !("tasks" in chain)) return undefined;
  return { snapshot: snapshot as PlanSnapshot, chain: chain as ExecutionChain, ...(typeof data.summary === "string" ? { summary: data.summary } : {}), ...(data.task && typeof data.task === "object" ? { task: data.task as ExecutionTaskEnvelope } : {}), ...(typeof data.done === "boolean" ? { done: data.done } : {}) };
}
function editableTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

async function fitPreview(setViewport: ReturnType<typeof useReactFlow>["setViewport"], bounds: PreviewBounds): Promise<boolean> {
  const canvas = document.querySelector<HTMLElement>(".plantree-canvas");
  if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return false;
  await setViewport(getFittedPreviewViewport(canvas.clientWidth, canvas.clientHeight, bounds), { duration: 0 });
  canvas.dataset.viewportReady = "true";
  return true;
}

function PreviewControls({ bounds }: { bounds: PreviewBounds }) {
  const { getViewport, setViewport } = useReactFlow();
  const zoom = (direction: "in" | "out") => void setViewport(getPreviewControlViewport(getViewport(), direction), { duration: 0 });
  return <div className="plantree-controls"><button type="button" aria-label="缩小" onClick={() => zoom("out")}>−</button><button type="button" aria-label="适配视图" onClick={() => void fitPreview(setViewport, bounds)}>⊙</button><button type="button" aria-label="放大" onClick={() => zoom("in")}>＋</button></div>;
}

function PreviewViewport({ bounds, layoutKey }: { bounds: PreviewBounds; layoutKey: string }) {
  const { getViewport, setViewport } = useReactFlow();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  useLayoutEffect(() => {
    const canvas = document.querySelector<HTMLElement>(".plantree-canvas");
    canvas?.removeAttribute("data-viewport-ready");
    let frame = 0;
    let cancelled = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (!cancelled) void fitPreview(setViewport, boundsRef.current); });
    };
    update();
    void document.fonts?.ready.then(update);
    const onWheel = (event: WheelEvent) => {
      if (!canvas) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      void setViewport(getPreviewWheelViewport(getViewport(), pointer, event.deltaY), { duration: 0 });
    };
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    const resizeObserver = canvas ? new ResizeObserver(update) : undefined;
    resizeObserver?.observe(canvas!);
    window.addEventListener("resize", update);
    return () => { cancelled = true; cancelAnimationFrame(frame); canvas?.removeEventListener("wheel", onWheel); resizeObserver?.disconnect(); window.removeEventListener("resize", update); };
  }, [getViewport, layoutKey, setViewport]);
  return null;
}

export function PlanTreeWindow({ plan, toolCaller, messageSender, webMode = false }: PlanTreeWindowProps & { toolCaller?: ToolCaller; messageSender?: MessageSender; webMode?: boolean }) {
  const previewRef = useRef<HTMLElement>(null);
  const [snapshot, setSnapshot] = useState(() => normalizePlan(plan));
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([normalizePlan(plan).rootNodeId]);
  const [promptId, setPromptId] = useState<string | null>(null); const [helpOpen, setHelpOpen] = useState(false); const [pruneIds, setPruneIds] = useState<string[] | null>(null);
  const [executionChain, setExecutionChain] = useState<ExecutionChain | null>(null); const [chainOpen, setChainOpen] = useState(false);
  const emptyDraft: NodeContentDraft = { task: "", method: "", acceptance: [] };
  const [promptEditing, setPromptEditing] = useState(false); const [promptDraft, setPromptDraft] = useState<NodeContentDraft>(emptyDraft); const [promptInitialText, setPromptInitialText] = useState<NodeContentDraft>(emptyDraft);
  const [promptError, setPromptError] = useState<string | null>(null); const [discardPromptOpen, setDiscardPromptOpen] = useState(false); const [pendingPromptAction, setPendingPromptAction] = useState<PendingPromptAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { const next = normalizePlan(plan); const ids = new Set(Object.keys(next.nodes)); setSnapshot(next); setSelectedIds((current) => current.filter((id) => ids.has(id))); setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); setPromptId((current) => { if (current && !ids.has(current)) { setPromptEditing(false); setDiscardPromptOpen(false); return null; } return current; }); }, [plan]);
  const graph = useMemo(() => snapshotToGraph(snapshot), [snapshot]);
  const nodes = useMemo(() => graph.nodes.map((node) => ({ ...node, position: overrides[node.id] ?? node.position, selected: selectedIds.includes(node.id) })), [graph.nodes, overrides, selectedIds]);
  const previewBounds = useMemo<PreviewBounds>(() => nodes.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, node.position.x), minY: Math.min(bounds.minY, node.position.y),
    maxX: Math.max(bounds.maxX, node.position.x + (node.width ?? 151)), maxY: Math.max(bounds.maxY, node.position.y + (node.height ?? 75)),
  }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }), [nodes]);
  const root = snapshot.nodes[snapshot.rootNodeId]; const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined; const selected = selectedId ? snapshot.nodes[selectedId] : undefined;
  const promptState = useMemo(() => promptId ? getNodePromptState(snapshot, promptId) : undefined, [promptId, snapshot]);
  const completed = Object.values(snapshot.nodes).filter((node) => node.status === "completed").length;
  const applySnapshot = (next: PlanSnapshot) => { const ids = new Set(Object.keys(next.nodes)); setSnapshot(next); setSelectedIds((current) => current.filter((id) => ids.has(id))); setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); setPromptId((current) => current && ids.has(current) ? current : null); };
  const runCommand = async (name: string, args: Record<string, unknown> = {}, expectedVersion = snapshot.version): Promise<PlanSnapshot | undefined> => { if (!toolCaller || loading) return undefined; setLoading(true); setError(null); try { const response = snapshotFromToolResult(await toolCaller(name, { ...args, expectedVersion })); if (!response) throw new Error("工具响应未包含计划快照。"); applySnapshot(response.snapshot); setFeedback(response.summary ?? "计划已更新。"); return response.snapshot; } catch (reason) { const conflict = reason && typeof reason === "object" && "snapshot" in reason ? snapshotFromToolResult({ snapshot: (reason as { snapshot: unknown }).snapshot })?.snapshot : undefined; if (conflict) applySnapshot(conflict); setError(reason instanceof Error ? reason.message : "请求失败。"); return undefined; } finally { setLoading(false); } };
  const runExecutionCommand = async (name: "compile_execution_chain" | "start_next_task" | "complete_task", args: Record<string, unknown> = {}) => { if (!toolCaller || loading) return; setLoading(true); setError(null); try { const response = executionFromToolResult(await toolCaller(name, name === "compile_execution_chain" ? args : { ...args, expectedVersion: snapshot.version })); if (!response) throw new Error("工具响应未包含执行链。"); applySnapshot(response.snapshot); setExecutionChain(response.chain); setChainOpen(true); setFeedback(response.summary ?? "执行链已更新。"); } catch (reason) { const conflict = reason && typeof reason === "object" && "snapshot" in reason ? snapshotFromToolResult({ snapshot: (reason as { snapshot: unknown }).snapshot })?.snapshot : undefined; if (conflict) applySnapshot(conflict); setError(reason instanceof Error ? reason.message : "请求失败。"); } finally { setLoading(false); } };
  const handoffToCodex = async () => { if (loading) return; if (!toolCaller) { setError("PlanTree 执行工具尚未连接。"); return; } if (!messageSender) { setError("当前入口未连接执行请求通道。"); return; } setLoading(true); setError(null); try { const response = executionFromToolResult(await toolCaller("compile_execution_chain", {})); if (!response) throw new Error("工具响应未包含执行链。"); applySnapshot(response.snapshot); setExecutionChain(response.chain); const remaining = response.chain.tasks.filter((task) => task.status !== "completed"); if (!remaining.length) { setChainOpen(true); setFeedback("执行链中的任务已全部完成。"); return; } await messageSender({ message: buildCodexExecutionMessage(response.snapshot, response.chain), snapshot: response.snapshot, chain: response.chain }); setChainOpen(false); setFeedback(`已在原 Codex 对话启动执行；将依次处理 ${remaining.length} 个剩余任务。`); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法提交 Codex 执行请求。"); } finally { setLoading(false); } };
  const closePrompt = () => { setPromptId(null); setPromptEditing(false); setPromptDraft(emptyDraft); setPromptInitialText(emptyDraft); setPromptError(null); };
  const hasUnsavedPrompt = promptEditing && !sameNodeContent(promptDraft, promptInitialText);
  const performPromptAction = (action: PendingPromptAction) => {
    if (action.type === "close") closePrompt();
    else if (action.type === "selection") { setSelectedIds(action.ids); if (promptId && (action.ids.length !== 1 || action.ids[0] !== promptId)) closePrompt(); }
    else if (action.type === "help") { closePrompt(); setChainOpen(false); setPruneIds(null); setHelpOpen(true); }
    else if (action.type === "chain") { closePrompt(); setHelpOpen(false); setPruneIds(null); void runExecutionCommand("compile_execution_chain"); }
    else if (action.type === "handoff") { closePrompt(); setHelpOpen(false); setChainOpen(false); setPruneIds(null); void handoffToCodex(); }
    else if (action.type === "prune") { closePrompt(); setHelpOpen(false); setChainOpen(false); setPruneIds(action.ids); }
    else void runCommand(action.name, action.args);
  };
  const requestPromptAction = (action: PendingPromptAction) => { if (hasUnsavedPrompt) { setPendingPromptAction(action); setDiscardPromptOpen(true); } else performPromptAction(action); };
  const requestClosePrompt = () => requestPromptAction({ type: "close" });
  const applySelection = (nextIds: string[]) => requestPromptAction({ type: "selection", ids: nextIds });
  const confirmDiscardPrompt = () => { const action = pendingPromptAction; setDiscardPromptOpen(false); setPendingPromptAction(null); closePrompt(); if (action) performPromptAction(action); };
  const cancelDiscardPrompt = () => { setDiscardPromptOpen(false); setPendingPromptAction(null); };
  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    setOverrides((current) => { const next = { ...current }; for (const change of changes) if (change.type === "position" && change.position) next[change.id] = change.position; return next; });
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length) {
      const nextIds = applyNodeChanges(selectionChanges, graph.nodes.map((node) => ({ ...node, selected: selectedIds.includes(node.id) }))).filter((node) => node.selected).map((node) => node.id);
      applySelection(nextIds);
    }
  }, [graph.nodes, hasUnsavedPrompt, promptDraft, promptInitialText, selectedIds]);
  const confirmPrune = async () => { if (!pruneIds) return; let expectedVersion = snapshot.version; for (const id of pruneIds) { const next = await runCommand("edit_node", { nodeId: id, operation: "prune" }, expectedVersion); if (!next) break; expectedVersion = next.version; } setPruneIds(null); };
  const requestPrune = () => { const ids = selectedIds.filter((id) => id !== snapshot.rootNodeId); if (ids.length) requestPromptAction({ type: "prune", ids }); };
  const togglePrompt = (nodeId: string) => { setHelpOpen(false); setChainOpen(false); setPruneIds(null); if (promptId === nodeId) requestClosePrompt(); else { setPromptId(nodeId); setPromptEditing(false); setPromptError(null); } };
  const toggleHelp = () => { if (helpOpen) setHelpOpen(false); else requestPromptAction({ type: "help" }); };
  const startPromptEditing = () => { if (!promptId) return; const node = snapshot.nodes[promptId]; if (!node) return; const draft = createNodeContentDraft(node); setPromptDraft(draft); setPromptInitialText(draft); setPromptError(null); setPromptEditing(true); };
  const savePrompt = async () => {
    if (!promptId) return;
    const validationError = validateNodeContent(promptDraft);
    if (validationError) { setPromptError(validationError); return; }
    const task = promptDraft.task.trim();
    const acceptance = promptDraft.acceptance.map((item) => ({ ...item, criterion: item.criterion.trim() }));
    const next = await runCommand("edit_node", { nodeId: promptId, operation: "rewrite", title: task, objective: task, method: promptDraft.method.trim() || null, acceptance });
    if (next?.nodes[promptId]) { const savedDraft = createNodeContentDraft(next.nodes[promptId]); setPromptEditing(false); setPromptDraft(savedDraft); setPromptInitialText(savedDraft); }
  };
  const updateAcceptance = (index: number, updates: Partial<AcceptanceCriterion>) => { setPromptDraft((current) => ({ ...current, acceptance: current.acceptance.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item) })); setPromptError(null); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => { const key = event.key.toLowerCase(); if (event.key === "Escape") { event.preventDefault(); if (discardPromptOpen) cancelDiscardPrompt(); else if (pruneIds) setPruneIds(null); else if (chainOpen) setChainOpen(false); else if (helpOpen) setHelpOpen(false); else if (promptId) requestClosePrompt(); else setSelectedIds([]); return; } if (editableTarget(event.target)) return; if (key === "?") { event.preventDefault(); toggleHelp(); return; } if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); requestPromptAction({ type: "command", name: "undo_last_edit" }); return; } if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); requestPromptAction({ type: "command", name: "redo_last_edit" }); return; } if (event.key === "Enter") { event.preventDefault(); requestPromptAction({ type: "handoff" }); return; } if (!selected || selectedIds.length !== 1) { if (event.key === "Delete") requestPrune(); return; } if (key === "p") { event.preventDefault(); togglePrompt(selected.id); } else if (key === "e" && selected.childIds.length) { event.preventDefault(); requestPromptAction({ type: "command", name: "edit_node", args: { nodeId: selected.id, operation: "expand" } }); } else if (event.key === "Delete") { event.preventDefault(); requestPrune(); } };
  if (!root) return null;
  const remainingExecutionTasks = executionChain?.tasks.filter((task) => task.status !== "completed") ?? [];
  const blockingDialogOpen = Boolean(pruneIds || discardPromptOpen);
  return <main ref={previewRef} className={`plantree-preview${webMode ? " plantree-preview-web" : " plantree-preview-inline"}`} aria-label="PlanTree 任务图预览" tabIndex={0} onKeyDown={onKeyDown}><section className="plantree-window" aria-label="PlanTree 任务树">
    <header className="plantree-header"><h1>PlanTree · 任务树</h1><div className="header-right"><div className="progress-label"><strong>{completed} / {Object.keys(snapshot.nodes).length} 完成</strong>进度</div><i className="progress"><b style={{ width: `${completed / Math.max(Object.keys(snapshot.nodes).length, 1) * 100}%` }} /></i><button className="help" type="button" aria-label="查看快捷键" onClick={toggleHelp}>?</button></div></header>
    <section className="plantree-graph-card"><div className="plantree-legend"><span>树关系</span><span>前置依赖</span></div><div className="plantree-canvas" onPointerDownCapture={(event) => { if ((event.target as Element).classList.contains("react-flow__pane")) previewRef.current?.focus(); }}><ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} panOnDrag={previewInteractionProps.panOnDrag} selectionOnDrag={previewInteractionProps.selectionOnDrag} selectionKeyCode={previewInteractionProps.selectionKeyCode} multiSelectionKeyCode={["Control", "Meta", "Shift"]} nodesDraggable deleteKeyCode={null} minZoom={0.5} maxZoom={1.35} zoomOnScroll={false} onPaneContextMenu={(event) => event.preventDefault()} proOptions={{ hideAttribution: true }}><PreviewViewport bounds={previewBounds} layoutKey={`${snapshot.version}:${nodes.map((node) => node.id).join("|")}`} /><PreviewControls bounds={previewBounds} /></ReactFlow></div></section>
    {!promptId && !chainOpen && !helpOpen && <section className="plantree-action-panel" aria-label="当前节点详情"><div>{selectedIds.length > 1 ? <><p>当前节点详情</p><strong>已选 {selectedIds.length} 个节点</strong><span>可按 Delete 请求裁剪；多选时不编辑节点内容。</span><div className="tags"><i>多选</i></div></> : selected ? <><p>当前节点详情</p><strong>{selected.title}</strong><span>{selected.objective}</span><div className="tags"><i>{getKindLabel(selected)}</i><i className={selected.dependsOn.length ? "warn" : ""}>{getStatusLabel(selected, snapshot)}</i></div></> : <><p>当前节点详情</p><strong>已选 0 个节点</strong></>}</div><div className="relations">{selected ? <><div><b>父节点：</b>{selected.parentId ? snapshot.nodes[selected.parentId]?.title ?? selected.parentId : "—"}</div><div><b>子节点：</b>{selected.childIds.map((id) => snapshot.nodes[id]?.title ?? id).join("、") || "无"}</div><div><b>前置依赖：</b>{selected.dependsOn.map((id) => snapshot.nodes[id]?.title ?? id).join("、") || "无"}</div></> : selectedIds.length > 1 ? <><div><b>操作：</b>裁剪前需要确认</div><div><b>节点内容：</b>仅单节点可用</div></> : null}</div><div className="plantree-feedback">{feedback && <span role="status">{feedback}</span>}{error && <span role="alert">{error}</span>}</div></section>}
    {promptId && promptState && <section className="plantree-inline-panel plantree-prompt" aria-label="节点内容" tabIndex={0}><header><h2>节点内容</h2><button className="close" type="button" aria-label="关闭" onClick={requestClosePrompt}>×</button></header>{promptEditing ? <div className="node-content-form"><label>任务<textarea aria-label="任务" value={promptDraft.task} onChange={(event) => { setPromptDraft((current) => ({ ...current, task: event.target.value })); setPromptError(null); }} /></label><label>方法 <span>可选</span><textarea aria-label="方法" value={promptDraft.method} onChange={(event) => { setPromptDraft((current) => ({ ...current, method: event.target.value })); setPromptError(null); }} /></label><fieldset><legend>验收 <span>可选；没有时由 Agent 自评</span></legend>{promptDraft.acceptance.map((item, index) => <div className="acceptance-row" key={index}><select aria-label={`验收类型 ${index + 1}`} value={item.type} onChange={(event) => updateAcceptance(index, { type: event.target.value as AcceptanceCriterion["type"] })}><option value="test">测试</option><option value="metric">指标</option><option value="evaluation">评价</option></select><textarea aria-label={`验收要求 ${index + 1}`} value={item.criterion} onChange={(event) => updateAcceptance(index, { criterion: event.target.value })} /><button type="button" aria-label={`删除验收 ${index + 1}`} onClick={() => { setPromptDraft((current) => ({ ...current, acceptance: current.acceptance.filter((_, itemIndex) => itemIndex !== index) })); setPromptError(null); }}>删除</button></div>)}<button type="button" onClick={() => { setPromptDraft((current) => ({ ...current, acceptance: [...current.acceptance, { type: "evaluation", criterion: "" }] })); setPromptError(null); }}>添加验收</button></fieldset></div> : <pre>{promptState.text}</pre>}{promptError && <p className="prompt-error" role="alert">{promptError}</p>}<div className="dialog-actions">{promptEditing ? <><button type="button" onClick={() => { setPromptEditing(false); setPromptDraft(promptInitialText); setPromptError(null); }}>取消</button><button type="button" className="primary" onClick={() => void savePrompt()}>保存</button></> : <><button type="button" onClick={() => navigator.clipboard?.writeText(promptState.text)}>复制内容</button><button type="button" onClick={startPromptEditing}>编辑内容</button></>}</div></section>}
    {chainOpen && executionChain && <section className="plantree-inline-panel plantree-chain" aria-label="执行链"><header><h2>执行链 · {executionChain.taskCount} 项</h2><button className="close" type="button" aria-label="关闭" onClick={() => setChainOpen(false)}>×</button></header><ol>{executionChain.tasks.map((task) => <li key={task.nodeId} className={task.status === "in_progress" ? "active" : task.status === "completed" ? "done" : ""}><b>{task.sequence}. {snapshot.nodes[task.nodeId]?.title ?? task.nodeId}</b><span>{getStatusLabel(snapshot.nodes[task.nodeId], snapshot)}</span></li>)}</ol>{remainingExecutionTasks.length > 0 && <div className="dialog-actions"><button type="button" className="primary" disabled={loading} onClick={() => requestPromptAction({ type: "handoff" })}>开始自动执行剩余任务</button></div>}</section>}
    {helpOpen && <section className="plantree-inline-panel plantree-help" aria-label="快捷键帮助"><header><h2>快捷键</h2><button className="close" type="button" aria-label="关闭" onClick={() => setHelpOpen(false)}>×</button></header><p><b>P</b> 查看或编辑节点内容　 <b>Enter</b> 开始自动执行　 <b>E</b> 展开节点</p><p><b>Delete</b> 打开裁剪确认　 <b>Ctrl/Cmd+Z</b> 撤销操作　 <b>Ctrl/Cmd+Y</b> 重做操作　 <b>Esc</b> 收起面板或清除选择　 <b>?</b> 快捷键帮助</p></section>}
    <footer className="plantree-actions"><button type="button" className="primary" disabled={!toolCaller || !messageSender || loading} onClick={() => requestPromptAction({ type: "handoff" })}>开始自动执行</button><button type="button" disabled={!toolCaller || loading} onClick={() => requestPromptAction({ type: "chain" })}>查看执行链</button><button type="button" disabled={!selected} onClick={() => selected && togglePrompt(selected.id)}>P 节点内容</button><button type="button" disabled={!selected || !selected.childIds.length || loading} onClick={() => selected && requestPromptAction({ type: "command", name: "edit_node", args: { nodeId: selected.id, operation: "expand" } })}>E 展开</button><button type="button" className="danger" disabled={!selectedIds.some((id) => id !== root.id) || loading} onClick={requestPrune}>Delete 删除</button><div className="notice"><b>执行链路：</b>点击一次后在创建此任务树的 Codex 对话中启动新回合；无需复制提示词或逐项确认。</div></footer>
  </section>{blockingDialogOpen && <div className="plantree-overlay" data-testid="dialog-overlay" onClick={() => { if (!discardPromptOpen) setPruneIds(null); }} />}
    {pruneIds && <section className="plantree-modal" role="dialog" aria-modal="true" aria-label="裁剪确认"><header><h2>确认裁剪</h2><button className="close" type="button" aria-label="关闭" onClick={() => setPruneIds(null)}>×</button></header><p>将请求裁剪 {pruneIds.length} 个非根节点。系统会逐项发送带 expectedVersion 的现有命令，并在冲突时停止后续请求。</p><div className="dialog-actions"><button type="button" onClick={() => setPruneIds(null)}>取消</button><button type="button" className="danger" onClick={() => void confirmPrune()}>确认裁剪</button></div></section>}
    {discardPromptOpen && <section className="plantree-modal" role="dialog" aria-modal="true" aria-label="放弃节点修改"><header><h2>放弃节点修改</h2></header><p>节点内容尚未保存，是否放弃本次修改？</p><div className="dialog-actions"><button type="button" onClick={cancelDiscardPrompt}>继续编辑</button><button type="button" className="danger" onClick={confirmDiscardPrompt}>放弃修改</button></div></section>}
  </main>;
}
