import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildCodexExecutionMessage, createAppMessageSender, createAppToolCaller, getFittedPreviewViewport, getPreviewControlViewport, getPreviewViewport, getPreviewWheelViewport, PlanTreeWindow, previewInteractionProps } from "./PlanTreeWindow";

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

  it("MCP bridge 先写入完整执行链上下文，再把执行指令作为用户消息交给 Codex", async () => {
    const chain = { schemaVersion: "1.0" as const, chainId: "chain", sourceTreeId: "plan", traversal: "depth-first-leaves" as const, taskCount: 1, tasks: [{ sequence: 1, nodeId: "third", status: "pending" as const, parentTasks: [], childTasks: [], prompt: "第三项" }] };
    const app = {
      getHostCapabilities: vi.fn().mockReturnValue({ message: { text: {} }, updateModelContext: { text: {}, structuredContent: {} } }),
      updateModelContext: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    await createAppMessageSender(app)({ message: "执行已确认队列", snapshot, chain });
    expect(app.updateModelContext).toHaveBeenCalledWith(expect.objectContaining({ structuredContent: { planTreeExecution: expect.objectContaining({ planId: "plan", snapshotVersion: 1, chain }) } }));
    expect(app.sendMessage).toHaveBeenCalledWith({ role: "user", content: [{ type: "text", text: "执行已确认队列" }] });
    expect(app.updateModelContext.mock.invocationCallOrder[0]).toBeLessThan(app.sendMessage.mock.invocationCallOrder[0]);
  });

  it("没有执行请求发送器时明确拒绝自动执行", async () => {
    const chain = { schemaVersion: "1.0" as const, chainId: "chain", sourceTreeId: "plan", traversal: "depth-first-leaves" as const, taskCount: 0, tasks: [] };
    const app = { getHostCapabilities: vi.fn().mockReturnValue({}), sendMessage: vi.fn().mockResolvedValue({}) };
    await expect(createAppMessageSender(app)({ message: "执行", snapshot, chain })).rejects.toThrow("不支持从 PlanTree 启动自动执行");
    expect(app.sendMessage).not.toHaveBeenCalled();
  });

  it("自动执行消息规定真实执行、验收和停止条件", () => {
    const chain = { schemaVersion: "1.0" as const, chainId: "chain", sourceTreeId: "plan", traversal: "depth-first-leaves" as const, taskCount: 2, tasks: [
      { sequence: 1, nodeId: "first", status: "completed" as const, parentTasks: [], childTasks: [], prompt: "第一项" },
      { sequence: 2, nodeId: "third", status: "pending" as const, parentTasks: [], childTasks: [], prompt: "第三项" },
    ] };
    const message = buildCodexExecutionMessage(snapshot, chain);
    expect(message).toContain("确认的剩余顺序：third");
    expect(message).toContain("不要调用 simulate_execution");
    expect(message).toContain("只有任务确实完成且验收通过后");
    expect(message).toContain("保留当前节点为 in_progress");
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

  it("窄容器按照实际节点边界缩放并居中", () => {
    const viewport = getFittedPreviewViewport(480, 360, { minX: 34, minY: 66, maxX: 427, maxY: 525 });
    expect(viewport.zoom).toBeCloseTo(0.6797385621);
    expect(viewport.x).toBeCloseTo(83.32026144);
    expect(viewport.y).toBeCloseTo(-20.8627451);
  });

  it("冷启动在画布尺寸有效并完成首次适配后才显示节点", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
    try {
      render(<PlanTreeWindow plan={snapshot} />);
      const canvas = document.querySelector<HTMLElement>(".plantree-canvas")!;
      await waitFor(() => expect(canvas).toHaveAttribute("data-viewport-ready", "true"));
      expect(document.querySelector(".react-flow__viewport")).toBeInTheDocument();
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
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
    expect(screen.getByLabelText("PlanTree 任务图预览")).toHaveClass("plantree-preview-inline");
    expect(screen.getByRole("heading", { name: "PlanTree · 任务树" })).toBeVisible();
    expect(screen.getByRole("button", { name: "缩小" })).toBeVisible();
    expect(screen.getByRole("button", { name: "适配视图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "放大" })).toBeVisible();
    expect(screen.getByText("树关系")).toBeVisible();
    expect(screen.getByText("前置依赖")).toBeVisible();
    expect(screen.getByText("当前节点详情")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始自动执行" })).toBeVisible();
    expect(screen.getByRole("button", { name: "P 节点内容" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete 删除" })).toBeVisible();
    expect(screen.getByLabelText(/^第二项/)).toBeInTheDocument();
  });

  it("Web 侧栏占满视口并允许提交执行请求", () => {
    render(<PlanTreeWindow plan={snapshot} toolCaller={vi.fn()} messageSender={vi.fn()} webMode />);
    expect(screen.getByLabelText("PlanTree 任务图预览")).toHaveClass("plantree-preview-web");
    expect(screen.getByRole("button", { name: "开始自动执行" })).toBeEnabled();
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
    expect(screen.getByRole("region", { name: "节点内容" })).toHaveTextContent("仅完成：收集上下文");
    expect(screen.getByRole("region", { name: "节点内容" })).not.toHaveTextContent("父节点：");
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "p" }); expect(screen.queryByRole("region", { name: "节点内容" })).not.toBeInTheDocument();
  });

  it("Enter 一次启动完整自动执行，撤销仍携带当前 expectedVersion", async () => {
    const chain = { schemaVersion: "1.0", chainId: "chain", sourceTreeId: "plan", traversal: "depth-first-leaves", taskCount: 1, tasks: [{ sequence: 1, nodeId: "third", status: "pending", parentTasks: [], childTasks: [], prompt: "执行第三项" }] };
    const caller = vi.fn().mockResolvedValue({ snapshot, chain, summary: "已更新" }); const messageSender = vi.fn().mockResolvedValue(undefined); render(<PlanTreeWindow plan={snapshot} toolCaller={caller} messageSender={messageSender} />); selectNode("第三项");
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "Enter" });
    await waitFor(() => expect(caller).toHaveBeenCalledWith("compile_execution_chain", {}));
    await waitFor(() => expect(messageSender).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("确认的剩余顺序：third"), snapshot, chain })));
    expect(caller).not.toHaveBeenCalledWith("start_next_task", expect.anything());
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "z", ctrlKey: true }); await waitFor(() => expect(caller).toHaveBeenCalledWith("undo_last_edit", { expectedVersion: 1 }));
  });

  it("一次点击把当前剩余执行链发送给 Codex，无需复制提示词", async () => {
    const chain = { schemaVersion: "1.0", chainId: "chain", sourceTreeId: "plan", traversal: "depth-first-leaves", taskCount: 2, tasks: [
      { sequence: 1, nodeId: "first", status: "completed", parentTasks: [], childTasks: [], prompt: "第一项" },
      { sequence: 2, nodeId: "third", status: "pending", parentTasks: [], childTasks: [], prompt: "第三项" },
    ] };
    const caller = vi.fn().mockResolvedValue({ snapshot, chain, summary: "已编译" });
    const messageSender = vi.fn().mockResolvedValue(undefined);
    render(<PlanTreeWindow plan={snapshot} toolCaller={caller} messageSender={messageSender} />);
    fireEvent.click(screen.getByRole("button", { name: "开始自动执行" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("compile_execution_chain", {}));
    await waitFor(() => expect(messageSender).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("确认的剩余顺序：third"), snapshot, chain })));
    expect(screen.getByRole("status")).toHaveTextContent("已在原 Codex 对话启动执行；将依次处理 1 个剩余任务");
    fireEvent.click(screen.getByRole("button", { name: "查看执行链" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "执行链" })).toBeVisible());
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认当前任务已完成" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始自动执行剩余任务" })).toBeVisible();
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
    render(<PlanTreeWindow plan={snapshot} />); const window = screen.getByLabelText("PlanTree 任务树"); fireEvent.keyDown(window, { key: "?" }); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("region", { name: "快捷键帮助" })).not.toBeInTheDocument();
    selectNode("第一项"); fireEvent.keyDown(window, { key: "p" }); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("region", { name: "节点内容" })).not.toBeInTheDocument();
  });

  it("点击画布空白后快捷键仍作用于整个任务图窗口", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    const pane = document.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 0 });
    expect(document.activeElement).toBe(screen.getByLabelText("PlanTree 任务图预览"));
    fireEvent.keyDown(document.activeElement!, { key: "?" });
    expect(screen.getByRole("region", { name: "快捷键帮助" })).toBeVisible();
  });

  it("内联面板按钮聚焦时 Esc 仍收起面板", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    const close = screen.getByRole("button", { name: "关闭" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "节点内容" })).not.toBeInTheDocument();
  });

  it("节点内容在主窗口单层展开，不创建遮罩或对话框", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    expect(screen.queryByTestId("dialog-overlay")).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "节点内容" });
    expect(panel).toBeVisible();
    expect(screen.getByLabelText("PlanTree 任务树")).toContainElement(panel);
  });

  it("单层工作区互斥，打开帮助会收起节点内容", () => {
    render(<PlanTreeWindow plan={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务树"), { key: "?" });
    expect(screen.getByRole("region", { name: "快捷键帮助" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "节点内容" })).not.toBeInTheDocument();
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

  it("编辑节点结构化内容、保护未保存草稿并支持重做", async () => {
    const saved = {
      ...snapshot,
      version: 2,
      nodes: { ...snapshot.nodes, root: { ...snapshot.nodes.root, title: "更新后的任务", objective: "更新后的任务", method: "按步骤实施", acceptance: [{ type: "test" as const, criterion: "测试通过" }], status: "pending_planning" as const, version: 2 } },
    };
    const caller = vi.fn()
      .mockResolvedValueOnce({ snapshot: saved, summary: "已改写节点" })
      .mockResolvedValueOnce({ snapshot: { ...saved, version: 3 }, summary: "已重做" });
    render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);

    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
    const taskEditor = screen.getByRole("textbox", { name: "任务" });
    expect(taskEditor).toHaveValue("交付目标");
    fireEvent.change(taskEditor, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("任务不能为空。");
    expect(caller).not.toHaveBeenCalled();
    fireEvent.change(taskEditor, { target: { value: "更新后的任务" } });
    fireEvent.change(screen.getByRole("textbox", { name: "方法" }), { target: { value: "按步骤实施" } });
    fireEvent.click(screen.getByRole("button", { name: "添加验收" }));
    fireEvent.change(screen.getByRole("combobox", { name: "验收类型 1" }), { target: { value: "test" } });
    fireEvent.change(screen.getByRole("textbox", { name: "验收要求 1" }), { target: { value: "测试通过" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("edit_node", { operation: "rewrite", nodeId: "root", title: "更新后的任务", objective: "更新后的任务", method: "按步骤实施", acceptance: [{ type: "test", criterion: "测试通过" }], expectedVersion: 1 }));
    expect(screen.getByRole("region", { name: "节点内容" })).toHaveTextContent("仅完成：更新后的任务");

    fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByRole("textbox", { name: "任务" }), { target: { value: "尚未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "任务" })).toHaveValue("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "查看快捷键" }));
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "快捷键帮助" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.getByRole("region", { name: "快捷键帮助" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    selectNode("第三项");
    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByRole("textbox", { name: "任务" }), { target: { value: "删除前草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete 删除" }));
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.getByRole("dialog", { name: "裁剪确认" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    selectNode("更新后的任务");
    fireEvent.click(screen.getByRole("button", { name: "P 节点内容" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByRole("textbox", { name: "任务" }), { target: { value: "重做前草稿" } });

    fireEvent.click(screen.getByRole("button", { name: "E 展开" }));
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    expect(caller).not.toHaveBeenCalledWith("edit_node", expect.objectContaining({ operation: "expand" }));
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));

    fireEvent.keyDown(screen.getByLabelText("PlanTree 任务图预览"), { key: "y", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "放弃节点修改" })).toBeVisible();
    expect(caller).not.toHaveBeenCalledWith("redo_last_edit", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(caller).toHaveBeenCalledWith("redo_last_edit", { expectedVersion: 2 }));
  });
});
