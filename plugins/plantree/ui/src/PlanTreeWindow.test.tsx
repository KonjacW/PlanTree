import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createAppToolCaller, getPreviewControlViewport, getPreviewViewport, getPreviewWheelViewport, PlanTreeWindow, previewInteractionProps } from "./PlanTreeWindow";

const snapshot = {
  id: "plan", version: 1, rootNodeId: "root",
  nodes: {
    root: { id: "root", title: "根任务", objective: "交付目标", kind: "goal" as const, status: "pending" as const, parentId: null, childIds: ["phase", "third"], dependsOn: [], version: 1, source: "demo" as const },
    phase: { id: "phase", title: "调查问题", objective: "定位原因", kind: "phase" as const, status: "pending" as const, parentId: "root", childIds: ["first", "second"], dependsOn: [], version: 1, source: "demo" as const },
    first: { id: "first", title: "第一项", objective: "收集上下文", kind: "task" as const, status: "pending" as const, parentId: "phase", childIds: [], dependsOn: [], version: 1, source: "demo" as const },
    second: { id: "second", title: "第二项", objective: "整理实施方案", kind: "task" as const, status: "pending" as const, parentId: "phase", childIds: [], dependsOn: ["first"], version: 1, source: "demo" as const },
    third: { id: "third", title: "第三项", objective: "同级任务", kind: "task" as const, status: "pending" as const, parentId: "root", childIds: [], dependsOn: [], version: 1, source: "demo" as const },
  }, validation: { valid: true, issues: [] }, audit: [],
};

function selectNode(title: string) { fireEvent.click(screen.getByLabelText(new RegExp(`^${title}`))); }

describe("PlanTreeWindow", () => {
  it("MCP bridge 将错误结果转换为带最新快照的失败", async () => {
    const app = { callServerTool: vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "任务树已被其他入口更新，请刷新后重试。" }],
      structuredContent: { snapshot: { ...snapshot, version: 2 } },
    }) };

    await expect(createAppToolCaller(app)("edit_node", { expectedVersion: 1 })).rejects.toEqual(expect.objectContaining({
      message: "任务树已被其他入口更新，请刷新后重试。",
      snapshot: expect.objectContaining({ version: 2 }),
    }));
  });

  it("仅用 Ctrl+Shift+左键框选，普通左键和右键用于平移", () => {
    expect(previewInteractionProps).toEqual({
      panOnDrag: [0, 2],
      selectionOnDrag: false,
      selectionKeyCode: "Control+Shift",
    });
  });

  it("适配视图使用 Preview 的固定世界尺寸公式", () => {
    expect(getPreviewViewport(1024, 662)).toEqual({ x: 22, y: 31, zoom: 1 });
  });

  it("按钮和滚轮使用 Preview 的缩放倍率与锚点", () => {
    expect(getPreviewControlViewport({ x: 12, y: 20, zoom: 1 }, "in")).toEqual({ x: 12, y: 20, zoom: 1.15 });
    expect(getPreviewControlViewport({ x: 12, y: 20, zoom: 1 }, "out")).toEqual({ x: 12, y: 20, zoom: 1 / 1.15 });
    const zoomIn = getPreviewWheelViewport({ x: 100, y: 50, zoom: 1 }, { x: 200, y: 150 }, -1);
    const zoomOut = getPreviewWheelViewport({ x: 100, y: 50, zoom: 1 }, { x: 200, y: 150 }, 1);
    expect(zoomIn.x).toBeCloseTo(90);
    expect(zoomIn.y).toBeCloseTo(40);
    expect(zoomIn.zoom).toBe(1.1);
    expect(zoomOut.x).toBeCloseTo(110);
    expect(zoomOut.y).toBeCloseTo(60);
    expect(zoomOut.zoom).toBe(0.9);
  });

  it("按 Preview 呈现标题栏、右上控制条、右下图例、详情与操作区", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    expect(screen.getByLabelText("PlanTree 任务图预览")).toHaveClass("plantree-preview");
    expect(screen.getByRole("heading", { name: "PlanTree · 任务树" })).toBeVisible();
    expect(screen.getByRole("button", { name: "缩小" })).toBeVisible();
    expect(screen.getByRole("button", { name: "适配视图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "放大" })).toBeVisible();
    expect(screen.getByText("树关系")).toBeVisible();
    expect(screen.getByText("前置依赖")).toBeVisible();
    expect(screen.getByText("当前节点详情")).toBeVisible();
    expect(screen.getByRole("button", { name: "P 查看提示词" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete 删除" })).toBeVisible();
    expect(screen.getByLabelText(/^第二项/)).toBeInTheDocument();
  });

  it("为自定义节点提供初始尺寸，使其不依赖异步测量即可显示", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    expect(document.querySelector("[data-testid='rf__node-root']")).toHaveStyle({ visibility: "visible" });
    expect(document.querySelectorAll(".react-flow__edge-path")).toHaveLength(5);
  });

  it("仅保存节点的本地视觉位置而不调用 move_node", () => {
    const caller = vi.fn(); render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);
    const node = document.querySelector(".react-flow__node[data-id='third']")!;
    fireEvent.pointerDown(node, { clientX: 10, clientY: 10 }); fireEvent.pointerMove(node, { clientX: 100, clientY: 100 }); fireEvent.pointerUp(node);
    expect(caller).not.toHaveBeenCalledWith("move_node", expect.anything());
  });

  it("P 仅在单选节点时开关本地提示词", () => {
    render(<PlanTreeWindow plan={snapshot} />); selectNode("第一项"); fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "p" });
    expect(screen.getByRole("dialog", { name: "节点提示词" })).toHaveTextContent("节点：第一项");
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "p" }); expect(screen.queryByRole("dialog", { name: "节点提示词" })).not.toBeInTheDocument();
  });

  it("Enter、E 与撤销均携带当前 expectedVersion", async () => {
    const caller = vi.fn().mockResolvedValue({ snapshot, summary: "已更新" }); render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />); selectNode("第三项");
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "Enter" }); await waitFor(() => expect(caller).toHaveBeenCalledWith("simulate_execution", { nodeId: "third", expectedVersion: 1 }));
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "z", ctrlKey: true }); await waitFor(() => expect(caller).toHaveBeenCalledWith("undo_last_edit", { expectedVersion: 1 }));
  });

  it("Delete 先确认，逐项失败后停止", async () => {
    const caller = vi.fn().mockResolvedValueOnce({ snapshot, summary: "裁剪成功" }).mockRejectedValueOnce(new Error("冲突")); render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />); selectNode("第三项");
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "Delete" }); fireEvent.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("edit_node", { nodeId: "third", operation: "prune", expectedVersion: 1 }));
  });

  it("多选裁剪逐项使用服务端返回的最新版本", async () => {
    const caller = vi.fn()
      .mockResolvedValueOnce({ snapshot: { ...snapshot, version: 2 }, summary: "第一项已裁剪" })
      .mockResolvedValueOnce({ snapshot: { ...snapshot, version: 3 }, summary: "第三项已裁剪" });
    render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);
    selectNode("第一项");
    fireEvent.keyDown(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.click(screen.getByLabelText(/^第三项/), { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control", code: "ControlLeft" });
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "Delete" });
    fireEvent.click(screen.getByRole("button", { name: "确认裁剪" }));

    await waitFor(() => expect(caller).toHaveBeenCalledTimes(2));
    expect(caller).toHaveBeenNthCalledWith(1, "edit_node", { nodeId: "first", operation: "prune", expectedVersion: 1 });
    expect(caller).toHaveBeenNthCalledWith(2, "edit_node", { nodeId: "third", operation: "prune", expectedVersion: 2 });
  });

  it("Esc 按帮助、提示词、确认、选择的顺序取消", () => {
    render(<PlanTreeWindow plan={snapshot} />); const window = screen.getByLabelText("PlanTree 任务树"); fireEvent.keyDown(window, { key: "?" }); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("dialog", { name: "快捷键帮助" })).not.toBeInTheDocument();
    selectNode("第一项"); fireEvent.keyDown(window, { key: "p" }); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("dialog", { name: "节点提示词" })).not.toBeInTheDocument();
  });

  it("点击画布空白后快捷键仍作用于整个任务图窗口", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    const pane = document.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 0 });
    expect(document.activeElement).toBe(screen.getByLabelText("PlanTree 任务图预览"));
    fireEvent.keyDown(document.activeElement!, { key: "?" });
    expect(screen.getByRole("dialog", { name: "快捷键帮助" })).toBeVisible();
  });

  it("弹层内按钮聚焦时 Esc 仍关闭弹层", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    const close = screen.getByRole("button", { name: "关闭" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "节点提示词" })).not.toBeInTheDocument();
  });

  it("弹层使用 Preview 的遮罩和对话框结构，不被窗口布局隐藏", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    expect(screen.getByTestId("dialog-overlay")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "节点提示词" })).toBeVisible();
  });

  it("Preview 弹层互斥，打开帮助会关闭提示词", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "?" });
    expect(screen.getByRole("dialog", { name: "快捷键帮助" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "节点提示词" })).not.toBeInTheDocument();
  });

  it("外部服务端快照更新时保留仍存在节点的选择", () => {
    const { rerender } = render(<PlanTreeWindow plan={snapshot} />);
    selectNode("第一项");
    rerender(<PlanTreeWindow plan={{ ...snapshot, version: 2 }} />);
    expect(screen.getByLabelText(/^第一项/).closest(".react-flow__node")).toHaveClass("selected");
    expect(screen.getByText("第一项", { selector: ".plantree-action-panel strong" })).toBeVisible();
  });

  it("详情区按 Preview 显示中文状态和多选说明", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    selectNode("第二项");
    expect(screen.getByText("等待前置任务")).toBeVisible();
    fireEvent.keyDown(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.click(screen.getByLabelText(/^第三项/), { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control", code: "ControlLeft" });
    expect(screen.getByText("多选")).toBeVisible();
    expect(screen.getByText("裁剪前需要确认")).toBeVisible();
    expect(screen.getByText("仅单节点可用")).toBeVisible();
  });

  it("编辑持久化提示词、保护未保存草稿并支持重做", async () => {
    const saved = {
      ...snapshot,
      version: 2,
      nodes: { ...snapshot.nodes, root: { ...snapshot.nodes.root, version: 2, customPrompt: "人工提示词", customPromptBaseVersion: 2 } },
    };
    const cleared = {
      ...saved,
      version: 4,
      nodes: { ...saved.nodes, root: { ...snapshot.nodes.root, version: 4 } },
    };
    const caller = vi.fn()
      .mockResolvedValueOnce({ snapshot: saved, summary: "已保存人工提示词" })
      .mockResolvedValueOnce({ snapshot: cleared, summary: "已恢复自动提示词" })
      .mockResolvedValueOnce({ snapshot: { ...cleared, version: 5 }, summary: "已重做" });
    const { rerender } = render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);

    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑提示词" }));
    const editor = screen.getByRole("textbox", { name: "编辑节点提示词" });
    expect((editor as HTMLTextAreaElement).value).toContain("节点：根任务");
    fireEvent.change(editor, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("提示词不能为空。");
    expect(caller).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: "人工提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("edit_node", { operation: "prompt", nodeId: "root", customPrompt: "人工提示词", expectedVersion: 1 }));

    rerender(<PlanTreeWindow plan={{ ...saved, version: 3, nodes: { ...saved.nodes, root: { ...saved.nodes.root, version: 3 } } }} toolCaller={caller} />);
    expect(screen.getByText("人工提示词可能已过期")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "恢复自动生成" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("edit_node", { operation: "prompt", nodeId: "root", expectedVersion: 3 }));
    rerender(<PlanTreeWindow plan={{ ...saved, version: 3, nodes: { ...saved.nodes, root: { ...saved.nodes.root, version: 3 } } }} toolCaller={caller} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑提示词" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑节点提示词" }), { target: { value: "尚未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "编辑节点提示词" })).toHaveValue("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "查看快捷键" }));
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "快捷键帮助" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.getByRole("dialog", { name: "快捷键帮助" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    selectNode("第三项");
    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑提示词" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑节点提示词" }), { target: { value: "删除前草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete 删除" }));
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.getByRole("dialog", { name: "裁剪确认" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    selectNode("根任务");
    fireEvent.click(screen.getByRole("button", { name: "P 查看提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑提示词" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑节点提示词" }), { target: { value: "重做前草稿" } });

    fireEvent.click(screen.getByRole("button", { name: "E 展开" }));
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    expect(caller).not.toHaveBeenCalledWith("edit_node", expect.objectContaining({ operation: "expand" }));
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));

    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务图预览"), { key: "y", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "放弃提示词修改" })).toBeVisible();
    expect(caller).not.toHaveBeenCalledWith("redo_last_edit", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("redo_last_edit", { expectedVersion: 3 }));
  });
});
