import { describe, expect, it, vi } from "vitest";

import { createHttpPromptFileCopier, createHttpToolCaller, PlanVersionConflictClientError } from "./http-tool-caller";

describe("HTTP 工具调用适配器", () => {
  it("将展开命令发送给编辑 API", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: "已更新计划", snapshot: { id: "plan" },
    }), { status: 200 }));
    const caller = createHttpToolCaller("http://127.0.0.1:4174", fetchStub);

    await caller("edit_node", { operation: "expand", nodeId: "repair" });

    expect(fetchStub).toHaveBeenCalledWith(
      "http://127.0.0.1:4174/api/nodes/edit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operation: "expand", nodeId: "repair" }),
      }),
    );
  });

  it("将模拟、撤销、重做和重置映射到本地 API", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ snapshot: { id: "plan" } })));
    const caller = createHttpToolCaller("", fetchStub);

    await caller("simulate_execution", { nodeId: "verify", expectedVersion: 3 });
    await caller("undo_last_edit", { expectedVersion: 4 });
    await caller("redo_last_edit", { expectedVersion: 5 });
    await caller("reset_demo", { expectedVersion: 6 });

    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([
      "/api/nodes/verify/simulate",
      "/api/undo",
      "/api/redo",
      "/api/demo/reset",
    ]);
    expect(fetchStub.mock.calls.map(([, request]) => (request as RequestInit).body)).toEqual([
      JSON.stringify({ expectedVersion: 3 }), JSON.stringify({ expectedVersion: 4 }), JSON.stringify({ expectedVersion: 5 }), JSON.stringify({ expectedVersion: 6 }),
    ]);
  });

  it("将执行链编译、领取和完成映射到真实执行 API", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ snapshot: { id: "plan" }, chain: { tasks: [] } })));
    const caller = createHttpToolCaller("", fetchStub);

    await caller("compile_execution_chain");
    await caller("start_next_task", { expectedVersion: 7 });
    await caller("complete_task", { nodeId: "n12", expectedVersion: 8 });

    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([
      "/api/execution/chain",
      "/api/execution/next",
      "/api/execution/n12/complete",
    ]);
    expect(fetchStub.mock.calls.map(([, request]) => (request as RequestInit).body)).toEqual([
      JSON.stringify({}),
      JSON.stringify({ expectedVersion: 7 }),
      JSON.stringify({ expectedVersion: 8 }),
    ]);
  });

  it("从侧栏一次点击请求复制提示文件", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ copied: { fileName: "plantree-prompt.md" } }), { status: 200 }));
    const copier = createHttpPromptFileCopier("", fetchStub);

    await expect(copier({ snapshot: { id: "plan", version: 7 } as never, chain: {} as never })).resolves.toEqual({ fileName: "plantree-prompt.md" });

    expect(fetchStub).toHaveBeenCalledWith("/api/execution/copy", expect.objectContaining({ method: "POST", body: JSON.stringify({ planId: "plan", snapshotVersion: 7 }) }));
  });

  it("将同级排序映射到本机移动接口", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot: { id: "plan" } }), { status: 200 }));
    const caller = createHttpToolCaller("http://127.0.0.1:4174", fetchStub);

    await caller("move_node", { nodeId: "third", parentId: "root", position: 0 });

    expect(fetchStub).toHaveBeenCalledWith(
      "http://127.0.0.1:4174/api/nodes/move",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nodeId: "third", parentId: "root", position: 0 }),
      }),
    );
  });

  it("将 API 错误转换为调用失败", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "不可执行" }), { status: 400 }));
    const caller = createHttpToolCaller("", fetchStub);

    await expect(caller("undo_last_edit")).rejects.toThrow("不可执行");
  });

  it("将 409 转换为带最新快照的版本冲突错误", async () => {
    const latest = { id: "plan", version: 2 };
    const fetchStub = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      error: "任务树已被其他入口更新，请刷新后重试。", snapshot: latest,
    }), { status: 409 }));
    const caller = createHttpToolCaller("", fetchStub);

    await expect(caller("move_node", { nodeId: "a", expectedVersion: 1 })).rejects.toEqual(
      expect.objectContaining({
        message: "任务树已被其他入口更新，请刷新后重试。",
        snapshot: latest,
      }),
    );
    await expect(caller("move_node", { nodeId: "a", expectedVersion: 1 })).rejects.toBeInstanceOf(PlanVersionConflictClientError);
  });
});
