# Persistent Node Prompts and Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PlanTree 增加节点级人工提示词持久化、过期提示与标准 `Ctrl/Cmd+Y` 重做，同时保持 Web/PiP 共用组件、服务端权威和轻量依赖边界。

**Architecture:** 在现有 `PlanNode` 上增加两个可选字段，通过 `edit_node prompt` 保存或清除人工覆盖；自动提示词仍由纯函数派生，展示选择与过期判断由小型纯函数处理。`DemoSession` 维护会话级 undo/redo 两个栈，MCP、HTTP 和 UI 只做薄映射；提示词编辑不得调用模拟重规划。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、`@xyflow/react`、Node.js、MCP SDK、现有 JSON 状态文件。

## Global Constraints

- 只扩展现有数据模型、`edit_node`、`DemoSession`、协议适配和提示词浮层；不新增第三方依赖、数据库、状态管理库或独立提示词仓库。
- 所有写操作必须携带 `expectedVersion`；HTTP 409 与 MCP 冲突继续使用服务端最新快照恢复。
- 自动提示词保持纯函数派生；自动和人工提示词均不得发送到外部服务。
- Web 与 MCP PiP 必须复用同一 `PlanTreeWindow` 和同一提示词行为。
- 节点拖动、树边、显式依赖边和 Preview 布局不得改变。
- 测试使用五个集中监测点，避免在领域、会话、MCP、HTTP 和 UI 重复断言相同业务规则。
- 不创建 Git commit。

---

### Task 1: 提示词纯函数监测点

**Files:**
- Modify: `plugins/plantree/ui/src/plan-types.ts`
- Modify: `plugins/plantree/ui/src/prompt.ts`
- Test: `plugins/plantree/ui/src/prompt.test.ts`

**Interfaces:**
- Consumes: `deriveNodePrompt(snapshot: PlanSnapshot, nodeId: string): string | undefined`
- Produces: `getNodePromptState(snapshot: PlanSnapshot, nodeId: string): NodePromptState | undefined`
- Produces: `validateCustomPrompt(value: string): string | undefined`

- [ ] **Step 1: 写集中失败测试**

在 `prompt.test.ts` 增加一个参数化测试，覆盖三条规则而不拆成重复用例：无覆盖时使用派生文本；有覆盖时使用人工文本；节点版本高于基准时 `stale` 为 `true`。再增加一个参数化测试确认空白内容返回“提示词不能为空。”、非空内容返回 `undefined`。

```ts
expect(getNodePromptState(snapshot, "phase")).toMatchObject({
  source: "derived",
  stale: false,
  text: expect.stringContaining("节点：阶段"),
});

const customized = {
  ...snapshot,
  nodes: {
    ...snapshot.nodes,
    phase: { ...snapshot.nodes.phase, version: 3, customPrompt: "人工文本", customPromptBaseVersion: 2 },
  },
};
expect(getNodePromptState(customized, "phase")).toEqual({ source: "custom", stale: true, text: "人工文本" });
expect(validateCustomPrompt("   ")).toBe("提示词不能为空。");
expect(validateCustomPrompt("有效提示词")).toBeUndefined();
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- --run src/prompt.test.ts`

Expected: FAIL，原因是 `getNodePromptState`、`validateCustomPrompt` 和节点可选字段尚不存在。

- [ ] **Step 3: 实现最小纯函数与类型**

在前端 `PlanNode` 增加：

```ts
customPrompt?: string;
customPromptBaseVersion?: number;
```

在 `prompt.ts` 增加：

```ts
export type NodePromptState = { text: string; source: "derived" | "custom"; stale: boolean };

export function getNodePromptState(snapshot: PlanSnapshot, nodeId: string): NodePromptState | undefined {
  const node = snapshot.nodes[nodeId];
  if (!node) return undefined;
  if (node.customPrompt !== undefined) {
    return {
      text: node.customPrompt,
      source: "custom",
      stale: node.customPromptBaseVersion !== undefined && node.version > node.customPromptBaseVersion,
    };
  }
  const text = deriveNodePrompt(snapshot, nodeId);
  return text === undefined ? undefined : { text, source: "derived", stale: false };
}

export function validateCustomPrompt(value: string): string | undefined {
  return value.trim() ? undefined : "提示词不能为空。";
}
```

- [ ] **Step 4: 运行纯函数监测点确认绿灯**

Run: `npm test -- --run src/prompt.test.ts`

Expected: PASS，既有自动提示词逐字测试继续通过。

### Task 2: 节点提示词领域编辑监测点

**Files:**
- Modify: `plugins/plantree/server/src/domain/types.ts`
- Modify: `plugins/plantree/server/src/domain/plan-editor.ts`
- Modify: `plugins/plantree/server/src/domain/simulated-planner.ts`
- Modify: `plugins/plantree/server/src/domain/audit-log.ts`
- Modify: `plugins/plantree/server/src/application/demo-session.ts`
- Test: `plugins/plantree/server/test/plan-editor.test.ts`

**Interfaces:**
- Consumes: `PlanEditor.apply(command: EditCommand): PlanSnapshot`
- Produces: `EditCommand` 分支 `{ type: "prompt"; nodeId: string; customPrompt?: string }`
- Guarantees: 保存提示词不调用 `replan()`，不改变 `childIds`、`dependsOn`、`status` 或规划器子节点。

- [ ] **Step 1: 写领域失败测试**

在 `plan-editor.test.ts` 增加一个测试覆盖保存、清除和空白拒绝：

```ts
const editor = new PlanEditor(initialDemoPlan);
const saved = editor.apply({ type: "prompt", nodeId: "repair", customPrompt: "  人工提示词  " });
expect(saved.nodes.repair).toMatchObject({ customPrompt: "人工提示词", customPromptBaseVersion: 2, version: 2 });
expect(saved.nodes.repair.childIds).toEqual([]);
expect(saved.version).toBe(2);

const cleared = new PlanEditor(saved).apply({ type: "prompt", nodeId: "repair" });
expect(cleared.nodes.repair).not.toHaveProperty("customPrompt");
expect(cleared.nodes.repair).not.toHaveProperty("customPromptBaseVersion");

expect(() => new PlanEditor(initialDemoPlan).apply({ type: "prompt", nodeId: "repair", customPrompt: " " }))
  .toThrow("提示词不能为空。");
```

在同一测试中经 `DemoSession.edit` 保存一次提示词，确认最后一条审计记录为 `type: "edited"`、`nodeIds: ["repair"]`、`versionBefore` 和 `versionAfter` 与保存前后计划版本一致，且 summary 明确为保存或恢复人工提示词。不要为其他既有编辑补做审计重构。

- [ ] **Step 2: 运行领域测试确认红灯**

Run: `npm test -- --run test/plan-editor.test.ts`

Expected: FAIL，原因是 `prompt` 命令不存在。

- [ ] **Step 3: 实现节点字段和 prompt 命令**

在服务端 `PlanNode` 加同名可选字段。在 `EditCommand` 加 `prompt` 分支，并在 `PlanEditor.apply` 中处理：保存时先 trim，使用 `bumpNode` 令节点版本加一，再把 `customPromptBaseVersion` 设置为新节点版本；清除时构造不含两个字段的新节点并增加版本。计划版本仍由 `apply` 统一增加。

将 `simulated-planner.ts` 中目标节点选择改为显式 switch，`prompt` 返回不重规划；在 `DemoSession.edit` 中也显式让 `prompt` 与 `move` 一样跳过 `replan()`。`prompt` 操作成功写入前使用 `appendAuditEntry` 追加唯一一条 `edited`：`nodeIds` 与 `affectedNodeIds` 均为当前节点，版本字段取保存前后计划版本，summary 区分“已保存人工提示词”和“已恢复自动提示词”。不得生成或替换规划器子节点，也不得顺手重构其他编辑的审计行为。

- [ ] **Step 4: 运行领域监测点确认绿灯**

Run: `npm test -- --run test/plan-editor.test.ts`

Expected: PASS，且既有添加、改写、展开、裁剪、移动测试不变。

### Task 3: 会话撤销重做监测点

**Files:**
- Modify: `plugins/plantree/server/src/application/demo-session.ts`
- Test: `plugins/plantree/server/test/demo-session.test.ts`

**Interfaces:**
- Consumes: `DemoSession.undo(expectedVersion: number): Promise<DemoLoadResult>`
- Produces: `DemoSession.redo(expectedVersion: number): Promise<DemoLoadResult>`
- Guarantees: 新成功变更清空 redo；阻断且未写入的模拟执行不得清空历史；reset 清空两个栈。

- [ ] **Step 1: 写会话失败测试**

把现有“编辑、撤销和重置”测试扩展为一个线性历史监测点：编辑 A、编辑 B、连续 undo 两次、连续 redo 两次；再 undo 一次并做新编辑，随后 `redo` 必须拒绝；reset 后 undo/redo 都必须拒绝。每次调用使用前一步服务端返回的版本。

```ts
const first = await value.edit({ type: "prompt", nodeId: "repair", customPrompt: "第一版" }, initial.snapshot.version);
const second = await value.edit({ type: "prompt", nodeId: "repair", customPrompt: "第二版" }, first.snapshot.version);
const undoSecond = await value.undo(second.snapshot.version);
expect(undoSecond.snapshot.nodes.repair.customPrompt).toBe("第一版");
const undoFirst = await value.undo(undoSecond.snapshot.version);
expect(undoFirst.snapshot.nodes.repair.customPrompt).toBeUndefined();
const redoFirst = await value.redo(undoFirst.snapshot.version);
expect(redoFirst.snapshot.nodes.repair.customPrompt).toBe("第一版");
const redoSecond = await value.redo(redoFirst.snapshot.version);
expect(redoSecond.snapshot.nodes.repair.customPrompt).toBe("第二版");
```

- [ ] **Step 2: 运行会话测试确认红灯**

Run: `npm test -- --run test/demo-session.test.ts`

Expected: FAIL，原因是 `redo` 和 redo 栈不存在。

- [ ] **Step 3: 实现标准线性历史**

在 `DemoSession` 增加 `#redoStack: PlanSnapshot[] = []`。集中一个私有成功写入辅助逻辑，保证 `edit`、`move` 和成功 `simulate` 在压入 undo 后清空 redo；阻断模拟不写入、不改变历史。

`undo`：读取当前快照，检查 undo 栈，写回 previous；成功后弹出 undo，并把写入前 current 压入 redo。

`redo`：读取当前快照，检查 redo 栈，写回 next；成功后弹出 redo，并把写入前 current 压入 undo。

`reset`：成功写入后同时清空两个栈。

- [ ] **Step 4: 运行会话监测点确认绿灯**

Run: `npm test -- --run test/demo-session.test.ts`

Expected: PASS，包含“没有可重做的编辑。”和版本冲突不修改栈的断言。

### Task 4: MCP 与 HTTP 薄协议监测点

**Files:**
- Modify: `plugins/plantree/server/src/server.ts`
- Modify: `plugins/plantree/server/src/web-api.ts`
- Modify: `plugins/plantree/ui/src/http-tool-caller.ts`
- Test: `plugins/plantree/server/test/server.test.ts`
- Test: `plugins/plantree/server/test/web-api.test.ts`
- Test: `plugins/plantree/ui/src/http-tool-caller.test.ts`

**Interfaces:**
- Produces: MCP `redo_last_edit({ expectedVersion })`
- Produces: HTTP `POST /api/redo` body `{ expectedVersion }`
- Extends: `edit_node` operation `prompt` with `nodeId` and optional `customPrompt`

- [ ] **Step 1: 写三层最小失败断言**

只在既有协议测试中各加一个聚合断言：

- MCP：工具列表含 `redo_last_edit` 且 `expectedVersion` required；调用 `edit_node prompt` 后 undo/redo 返回正确文本。
- Web API：现有读取/编辑/撤销测试追加 `/api/redo`，并用 `prompt` 编辑确认路由透传。
- HTTP caller：现有“模拟、撤销和重置”映射测试加入 `redo_last_edit`，期望 `/api/redo`。

- [ ] **Step 2: 运行协议测试确认红灯**

Run: `npm test -- --run test/server.test.ts test/web-api.test.ts`（server）

Run: `npm test -- --run src/http-tool-caller.test.ts`（ui）

Expected: FAIL，原因是新 MCP 工具、HTTP 路由和 caller 映射不存在。

- [ ] **Step 3: 实现薄协议映射**

`server.ts`：`edit_node` 枚举加入 `prompt`，schema 加可选 `customPrompt`；`toEditCommand` 在 `operation === "prompt" && nodeId` 时返回 prompt 命令。注册 `redo_last_edit` 并增加 `redoDemoToolResponse`。

`web-api.ts`：增加 `/api/redo` 调用 `session.redo(expectedVersion)`。

`http-tool-caller.ts`：增加 `redo_last_edit` 到 `/api/redo`，body 只含 `expectedVersion`。

- [ ] **Step 4: 运行协议监测点确认绿灯**

Run: `npm test -- --run test/server.test.ts test/web-api.test.ts`（server）

Run: `npm test -- --run src/http-tool-caller.test.ts`（ui）

Expected: PASS，409/MCP 冲突既有测试继续通过。

### Task 5: 提示词浮层与 Ctrl/Cmd+Y 集成监测点

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.tsx`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.css`
- Test: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`

**Interfaces:**
- Consumes: `getNodePromptState`、`validateCustomPrompt`
- Calls: `toolCaller("edit_node", { operation: "prompt", nodeId, customPrompt?, expectedVersion })`
- Calls: `toolCaller("redo_last_edit", { expectedVersion })`

- [ ] **Step 1: 写一个完整 UI 流程失败测试**

在 `PlanTreeWindow.test.tsx` 增加单个集成测试，按真实流程覆盖：打开提示词、进入编辑、自动文本作为初值、空白保存显示错误、保存调用参数、人工文本展示、节点版本提高后出现过期提示、恢复自动生成调用清除参数、`Ctrl+Y` 调用重做。另用同一测试打开编辑并修改，点击关闭，确认放弃对话框出现且取消时草稿保留。

关键断言：

```ts
expect(screen.getByRole("textbox", { name: "编辑节点提示词" })).toHaveValue(expect.stringContaining("节点：根任务"));
expect(caller).toHaveBeenCalledWith("edit_node", {
  operation: "prompt",
  nodeId: "root",
  customPrompt: "人工提示词",
  expectedVersion: 1,
});
fireEvent.keyDown(screen.getByLabelText("PlanTree 任务图预览"), { key: "y", ctrlKey: true });
expect(caller).toHaveBeenCalledWith("redo_last_edit", { expectedVersion: expect.any(Number) });
```

- [ ] **Step 2: 运行 UI 测试确认红灯**

Run: `npm test -- --run src/PlanTreeWindow.test.tsx`

Expected: FAIL，原因是编辑状态、按钮、放弃确认、过期提示和 Ctrl+Y 尚不存在。

- [ ] **Step 3: 实现轻量 UI 状态机**

在 `PlanTreeWindow` 内增加最小状态：

```ts
const [promptEditing, setPromptEditing] = useState(false);
const [promptDraft, setPromptDraft] = useState("");
const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
```

从 `getNodePromptState(snapshot, promptId)` 得到当前文本、来源和 stale。进入编辑时复制当前文本到 draft。保存先调用 `validateCustomPrompt`，通过后执行 `edit_node prompt`；成功响应后退出编辑。恢复自动生成调用相同 operation，但不传 `customPrompt`。

所有关闭入口统一经过 `requestClosePrompt()`：draft 与进入编辑时文本不同时打开放弃确认；否则直接关闭。`Esc` 在 textarea 聚焦时也交给该关闭路径，但 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Y` 和普通输入仍由浏览器文本编辑处理，不触发任务树操作。

在现有浮层内部替换 `pre`/`textarea`，保持 Preview 的 `410px` 对话框、颜色、边框和按钮风格。新增提示使用低饱和警告色，不新增侧栏、Badge 或布局区块。

在非可编辑焦点的快捷键处理器中增加 `Ctrl/Cmd+Y`，调用 `redo_last_edit`。帮助文案同步加入重做。

- [ ] **Step 4: 运行 UI 集成监测点确认绿灯**

Run: `npm test -- --run src/PlanTreeWindow.test.tsx src/prompt.test.ts src/http-tool-caller.test.ts`

Expected: PASS，既有 Preview、图形选择、冲突和拖动测试不变。

### Task 6: 集中验证、文档与 OpenSpec 状态

**Files:**
- Modify: `plugins/plantree/README.md`
- Modify: `openspec/changes/graph-interactive-plantree/tasks.md`

**Interfaces:**
- Documents: 人工提示词保存/恢复/过期、`Ctrl/Cmd+Y`、会话级历史和外部服务边界。

- [ ] **Step 1: 运行五个集中监测点**

Run: `npm test -- --run src/prompt.test.ts src/http-tool-caller.test.ts src/PlanTreeWindow.test.tsx` in `plugins/plantree/ui`

Run: `npm test -- --run test/plan-editor.test.ts test/demo-session.test.ts test/server.test.ts test/web-api.test.ts` in `plugins/plantree/server`

Expected: 所有集中测试 PASS，无新的 React 或协议警告。

- [ ] **Step 2: 运行完整 UI 验证**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: UI 全部测试、类型检查、Web 生产构建和 MCP 内联构建 PASS；仅允许既有 `@xyflow/react` 的 `"use client" ignored` Rollup warning。

- [ ] **Step 3: 运行完整服务端验证**

Run: `npm test`

Run: `npm run build`

Expected: 服务端全部测试与 TypeScript 构建 PASS；构建前 MCP 内联资源刷新成功。

- [ ] **Step 4: 更新 README**

在现有图形交互章节补充：人工提示词保存在本地任务树并跨 Web/PiP 同步；自动提示词仍为纯派生；节点变化后显示过期提示但不自动覆盖；“恢复自动生成”清除人工覆盖；`Ctrl/Cmd+Y` 为会话级重做，服务端重启后 undo/redo 历史清空。

- [ ] **Step 5: 标记 OpenSpec 任务并严格校验**

按完成顺序将 6.1–6.6 立即勾选。5.4 只有用户完成 Codex MCP PiP 人工走查后才能勾选。

Run: `openspec validate graph-interactive-plantree --strict`

Expected: `Change 'graph-interactive-plantree' is valid`。

- [ ] **Step 6: 自检工作区**

确认没有新增依赖、没有提交 Git commit、没有修改图形布局和关系逻辑，并在最终报告列出已完成任务、修改文件、实际测试结果及仍未完成的 5.4（如用户尚未走查）。
