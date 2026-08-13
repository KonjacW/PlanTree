import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, applyNodeChanges, useReactFlow, type NodeChange, type OnNodesChange, type Viewport } from "@xyflow/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import "@xyflow/react/dist/style.css";

import { snapshotToGraph, isExecutable } from "./graph-model";
import type { PlanSnapshot } from "./plan-types";
import { getNodePromptState, validateCustomPrompt } from "./prompt";
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
type PendingPromptAction =
  | { type: "close" }
  | { type: "selection"; ids: string[] }
  | { type: "help" }
  | { type: "prune"; ids: string[] }
  | { type: "command"; name: string; args?: Record<string, unknown> };
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
function editableTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

function applyPreviewViewport(setViewport: ReturnType<typeof useReactFlow>["setViewport"]) {
  const canvas = document.querySelector<HTMLElement>(".plantree-canvas");
  if (!canvas) return;
  void setViewport(getPreviewViewport(canvas.clientWidth, canvas.clientHeight), { duration: 0 });
}

function PreviewControls() {
  const { getViewport, setViewport } = useReactFlow();
  const zoom = (direction: "in" | "out") => void setViewport(getPreviewControlViewport(getViewport(), direction), { duration: 0 });
  return <div className="plantree-controls"><button type="button" aria-label="缩小" onClick={() => zoom("out")}>−</button><button type="button" aria-label="适配视图" onClick={() => applyPreviewViewport(setViewport)}>⊙</button><button type="button" aria-label="放大" onClick={() => zoom("in")}>＋</button></div>;
}

function PreviewViewport() {
  const { getViewport, setViewport } = useReactFlow();
  useEffect(() => {
    const update = () => {
      applyPreviewViewport(setViewport);
    };
    const frame = requestAnimationFrame(update);
    const canvas = document.querySelector<HTMLElement>(".plantree-canvas");
    const onWheel = (event: WheelEvent) => {
      if (!canvas) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      void setViewport(getPreviewWheelViewport(getViewport(), pointer, event.deltaY), { duration: 0 });
    };
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); canvas?.removeEventListener("wheel", onWheel); window.removeEventListener("resize", update); };
  }, [getViewport, setViewport]);
  return null;
}

export function PlanTreeWindow({ plan, toolCaller }: PlanTreeWindowProps & { toolCaller?: ToolCaller; webMode?: boolean }) {
  const previewRef = useRef<HTMLElement>(null);
  const [snapshot, setSnapshot] = useState(() => normalizePlan(plan));
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([normalizePlan(plan).rootNodeId]);
  const [promptId, setPromptId] = useState<string | null>(null); const [helpOpen, setHelpOpen] = useState(false); const [pruneIds, setPruneIds] = useState<string[] | null>(null);
  const [promptEditing, setPromptEditing] = useState(false); const [promptDraft, setPromptDraft] = useState(""); const [promptInitialText, setPromptInitialText] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null); const [discardPromptOpen, setDiscardPromptOpen] = useState(false); const [pendingPromptAction, setPendingPromptAction] = useState<PendingPromptAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { const next = normalizePlan(plan); const ids = new Set(Object.keys(next.nodes)); setSnapshot(next); setSelectedIds((current) => current.filter((id) => ids.has(id))); setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); setPromptId((current) => { if (current && !ids.has(current)) { setPromptEditing(false); setDiscardPromptOpen(false); return null; } return current; }); }, [plan]);
  const graph = useMemo(() => snapshotToGraph(snapshot), [snapshot]);
  const nodes = useMemo(() => graph.nodes.map((node) => ({ ...node, position: overrides[node.id] ?? node.position, selected: selectedIds.includes(node.id) })), [graph.nodes, overrides, selectedIds]);
  const root = snapshot.nodes[snapshot.rootNodeId]; const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined; const selected = selectedId ? snapshot.nodes[selectedId] : undefined;
  const promptState = useMemo(() => promptId ? getNodePromptState(snapshot, promptId) : undefined, [promptId, snapshot]);
  const completed = Object.values(snapshot.nodes).filter((node) => node.status === "completed").length;
  const applySnapshot = (next: PlanSnapshot) => { const ids = new Set(Object.keys(next.nodes)); setSnapshot(next); setSelectedIds((current) => current.filter((id) => ids.has(id))); setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)))); setPromptId((current) => current && ids.has(current) ? current : null); };
  const runCommand = async (name: string, args: Record<string, unknown> = {}, expectedVersion = snapshot.version): Promise<PlanSnapshot | undefined> => { if (!toolCaller || loading) return undefined; setLoading(true); setError(null); try { const response = snapshotFromToolResult(await toolCaller(name, { ...args, expectedVersion })); if (!response) throw new Error("工具响应未包含计划快照。"); applySnapshot(response.snapshot); setFeedback(response.summary ?? "计划已更新。"); return response.snapshot; } catch (reason) { const conflict = reason && typeof reason === "object" && "snapshot" in reason ? snapshotFromToolResult({ snapshot: (reason as { snapshot: unknown }).snapshot })?.snapshot : undefined; if (conflict) applySnapshot(conflict); setError(reason instanceof Error ? reason.message : "请求失败。"); return undefined; } finally { setLoading(false); } };
  const closePrompt = () => { setPromptId(null); setPromptEditing(false); setPromptDraft(""); setPromptInitialText(""); setPromptError(null); };
  const hasUnsavedPrompt = promptEditing && promptDraft !== promptInitialText;
  const performPromptAction = (action: PendingPromptAction) => {
    if (action.type === "close") closePrompt();
    else if (action.type === "selection") { setSelectedIds(action.ids); if (promptId && (action.ids.length !== 1 || action.ids[0] !== promptId)) closePrompt(); }
    else if (action.type === "help") { closePrompt(); setPruneIds(null); setHelpOpen(true); }
    else if (action.type === "prune") { closePrompt(); setHelpOpen(false); setPruneIds(action.ids); }
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
  const togglePrompt = (nodeId: string) => { setHelpOpen(false); setPruneIds(null); if (promptId === nodeId) requestClosePrompt(); else { setPromptId(nodeId); setPromptEditing(false); setPromptError(null); } };
  const toggleHelp = () => { if (helpOpen) setHelpOpen(false); else requestPromptAction({ type: "help" }); };
  const startPromptEditing = () => { if (!promptState) return; setPromptDraft(promptState.text); setPromptInitialText(promptState.text); setPromptError(null); setPromptEditing(true); };
  const savePrompt = async () => { if (!promptId) return; const validationError = validateCustomPrompt(promptDraft); if (validationError) { setPromptError(validationError); return; } const next = await runCommand("edit_node", { nodeId: promptId, operation: "prompt", customPrompt: promptDraft.trim() }); if (next) { setPromptEditing(false); setPromptInitialText(promptDraft.trim()); } };
  const restoreDerivedPrompt = async () => { if (!promptId) return; const next = await runCommand("edit_node", { nodeId: promptId, operation: "prompt" }); if (next) { setPromptEditing(false); setPromptError(null); } };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => { const key = event.key.toLowerCase(); if (event.key === "Escape") { event.preventDefault(); if (discardPromptOpen) cancelDiscardPrompt(); else if (helpOpen) setHelpOpen(false); else if (promptId) requestClosePrompt(); else if (pruneIds) setPruneIds(null); else setSelectedIds([]); return; } if (editableTarget(event.target)) return; if (key === "?") { event.preventDefault(); toggleHelp(); return; } if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); requestPromptAction({ type: "command", name: "undo_last_edit" }); return; } if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); requestPromptAction({ type: "command", name: "redo_last_edit" }); return; } if (!selected || selectedIds.length !== 1) { if (event.key === "Delete") requestPrune(); return; } if (key === "p") { event.preventDefault(); togglePrompt(selected.id); } else if (event.key === "Enter" && isExecutable(selected, snapshot.nodes)) { event.preventDefault(); requestPromptAction({ type: "command", name: "simulate_execution", args: { nodeId: selected.id } }); } else if (key === "e" && selected.childIds.length) { event.preventDefault(); requestPromptAction({ type: "command", name: "edit_node", args: { nodeId: selected.id, operation: "expand" } }); } else if (event.key === "Delete") { event.preventDefault(); requestPrune(); } };
  if (!root) return null;
  const dialogOpen = Boolean(promptId || helpOpen || pruneIds || discardPromptOpen);
  return <main ref={previewRef} className="plantree-preview" aria-label="PlanTree 任务图预览" tabIndex={0} onKeyDown={onKeyDown}><section className="plantree-window" aria-label="PlanTree 任务树">
    <header className="plantree-header"><h1>PlanTree · 任务树</h1><div className="header-right"><div className="progress-label"><strong>{completed} / {Object.keys(snapshot.nodes).length} 完成</strong>进度</div><i className="progress"><b style={{ width: `${completed / Math.max(Object.keys(snapshot.nodes).length, 1) * 100}%` }} /></i><button className="help" type="button" aria-label="查看快捷键" onClick={toggleHelp}>?</button></div></header>
    <section className="plantree-graph-card"><div className="plantree-legend"><span>树关系</span><span>前置依赖</span></div><div className="plantree-canvas" onPointerDownCapture={(event) => { if ((event.target as Element).classList.contains("react-flow__pane")) previewRef.current?.focus(); }}><ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} panOnDrag={previewInteractionProps.panOnDrag} selectionOnDrag={previewInteractionProps.selectionOnDrag} selectionKeyCode={previewInteractionProps.selectionKeyCode} multiSelectionKeyCode={["Control", "Meta", "Shift"]} nodesDraggable deleteKeyCode={null} minZoom={0.52} maxZoom={1.35} zoomOnScroll={false} onPaneContextMenu={(event) => event.preventDefault()} proOptions={{ hideAttribution: true }}><PreviewViewport /><PreviewControls /></ReactFlow></div></section>
    <section className="plantree-action-panel" aria-label="当前节点详情"><div>{selectedIds.length > 1 ? <><p>当前节点详情</p><strong>已选 {selectedIds.length} 个节点</strong><span>可按 Delete 请求裁剪；多选时不生成模糊的批量提示词。</span><div className="tags"><i>多选</i></div></> : selected ? <><p>当前节点详情</p><strong>{selected.title}</strong><span>{selected.objective}</span><div className="tags"><i>{getKindLabel(selected)}</i><i className={selected.dependsOn.length ? "warn" : ""}>{getStatusLabel(selected, snapshot)}</i></div></> : <><p>当前节点详情</p><strong>已选 0 个节点</strong></>}</div><div className="relations">{selected ? <><div><b>父节点：</b>{selected.parentId ? snapshot.nodes[selected.parentId]?.title ?? selected.parentId : "—"}</div><div><b>子节点：</b>{selected.childIds.map((id) => snapshot.nodes[id]?.title ?? id).join("、") || "无"}</div><div><b>前置依赖：</b>{selected.dependsOn.map((id) => snapshot.nodes[id]?.title ?? id).join("、") || "无"}</div></> : selectedIds.length > 1 ? <><div><b>操作：</b>裁剪前需要确认</div><div><b>提示词：</b>仅单节点可用</div></> : null}</div><div className="plantree-feedback">{feedback && <span role="status">{feedback}</span>}{error && <span role="alert">{error}</span>}</div></section>
    <footer className="plantree-actions"><button type="button" className="primary" disabled={!selected || !isExecutable(selected, snapshot.nodes) || loading} onClick={() => selected && requestPromptAction({ type: "command", name: "simulate_execution", args: { nodeId: selected.id } })}>Enter</button><button type="button" disabled={!selected} onClick={() => selected && togglePrompt(selected.id)}>P 查看提示词</button><button type="button" disabled={!selected || !selected.childIds.length || loading} onClick={() => selected && requestPromptAction({ type: "command", name: "edit_node", args: { nodeId: selected.id, operation: "expand" } })}>E 展开</button><button type="button" className="danger" disabled={!selectedIds.some((id) => id !== root.id) || loading} onClick={requestPrune}>Delete 删除</button><div className="notice"><b>本地预览：</b>拖动仅调整当前视图，不修改计划结构。</div></footer>
  </section>{dialogOpen && <div className="plantree-overlay" data-testid="dialog-overlay" onClick={() => { if (discardPromptOpen) return; if (promptId) requestClosePrompt(); else { setHelpOpen(false); setPruneIds(null); } }} />}
    {promptId && promptState && <section className="plantree-prompt" role="dialog" aria-modal="true" aria-label="节点提示词" tabIndex={0}><header><h2>节点提示词</h2><button className="close" type="button" aria-label="关闭" onClick={requestClosePrompt}>×</button></header>{promptState.stale && <p className="prompt-warning">人工提示词可能已过期</p>}{promptEditing ? <textarea aria-label="编辑节点提示词" value={promptDraft} onChange={(event) => { setPromptDraft(event.target.value); setPromptError(null); }} /> : <pre>{promptState.text}</pre>}{promptError && <p className="prompt-error" role="alert">{promptError}</p>}<div className="dialog-actions">{promptEditing ? <><button type="button" onClick={() => { setPromptEditing(false); setPromptDraft(promptInitialText); setPromptError(null); }}>取消</button><button type="button" className="primary" onClick={() => void savePrompt()}>保存</button></> : <><button type="button" onClick={() => navigator.clipboard?.writeText(promptState.text)}>复制提示词</button><button type="button" onClick={startPromptEditing}>编辑提示词</button>{promptState.source === "custom" && <button type="button" onClick={() => void restoreDerivedPrompt()}>恢复自动生成</button>}</>}</div></section>}
    {helpOpen && <section className="plantree-modal" role="dialog" aria-modal="true" aria-label="快捷键帮助"><header><h2>快捷键</h2><button className="close" type="button" aria-label="关闭" onClick={() => setHelpOpen(false)}>×</button></header><p><b>P</b> 开关单节点提示词　 <b>Enter</b> 模拟执行　 <b>E</b> 展开节点</p><p><b>Delete</b> 打开裁剪确认　 <b>Ctrl/Cmd+Z</b> 撤销操作　 <b>Ctrl/Cmd+Y</b> 重做操作　 <b>Esc</b> 关闭弹层或清除选择　 <b>?</b> 快捷键帮助</p></section>}
    {pruneIds && <section className="plantree-modal" role="dialog" aria-modal="true" aria-label="裁剪确认"><header><h2>确认裁剪</h2><button className="close" type="button" aria-label="关闭" onClick={() => setPruneIds(null)}>×</button></header><p>将请求裁剪 {pruneIds.length} 个非根节点。系统会逐项发送带 expectedVersion 的现有命令，并在冲突时停止后续请求。</p><div className="dialog-actions"><button type="button" onClick={() => setPruneIds(null)}>取消</button><button type="button" className="danger" onClick={() => void confirmPrune()}>确认裁剪</button></div></section>}
    {discardPromptOpen && <section className="plantree-modal" role="dialog" aria-modal="true" aria-label="放弃提示词修改"><header><h2>放弃提示词修改</h2></header><p>提示词尚未保存，是否放弃本次修改？</p><div className="dialog-actions"><button type="button" onClick={cancelDiscardPrompt}>继续编辑</button><button type="button" className="danger" onClick={confirmDiscardPrompt}>放弃修改</button></div></section>}
  </main>;
}
