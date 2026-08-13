# PlanTree 轻量小窗体验改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP 小窗与本地 Web 共享一套轻量、可折叠、可键盘操作且能安全同级拖拽排序的 PlanTree 体验。

**Architecture:** 保持 `PlanTreeWindow` 为唯一 UI 组件，MCP 与 HTTP 继续仅作为 `ToolCaller` 适配层。服务端新增独立的同级排序命令 `move_node`，通过现有 `DemoSession` 返回权威快照并支持撤销；前端本地管理展开、选择、多选、框选和键盘焦点，不对服务端状态进行乐观推断。

**Tech Stack:** TypeScript、React 19、Testing Library、Vitest、Node.js HTTP、MCP SDK。

## Global Constraints

- 保留已有 MCP stdio 服务、工具名称、输入输出契约与 `codexzh` 代理设置，不修改其配置。
- MCP 小窗为主界面，Web 复用同一 `PlanTreeWindow` 和样式；不创建第二套工作台 UI。
- 维持单列轻量小窗；不实现全屏、多栏、自由画布、跨窗口/文件拖放、持久化或外部网络。
- 拖拽仅允许同一父节点下的兄弟排序，禁止改变父子关系、依赖关系或任务状态。
- 所有结构与状态修改必须用服务端返回的 `PlanSnapshot` 刷新前端；本地状态仅限选择、折叠、框选和焦点。
- 每项行为遵循先失败测试、最小实现、定向验证；项目不是 Git 仓库，不执行 `git init`、`git commit` 或任何代理设置修改。

---

## 文件职责

- `plugins/plantree/server/src/domain/plan-editor.ts`：定义并校验同级排序领域命令。
- `plugins/plantree/server/src/application/demo-session.ts`：将排序纳入会话、影响分析和撤销栈。
- `plugins/plantree/server/src/server.ts`：公开独立 `move_node` MCP 工具。
- `plugins/plantree/server/src/web-api.ts`：公开等价本地 HTTP 排序接口。
- `plugins/plantree/ui/src/http-tool-caller.ts`：将通用 UI 排序命令映射到 HTTP。
- `plugins/plantree/ui/src/PlanTreeWindow.tsx`：实现轻量树导航、语义化操作和拖拽排序。
- `plugins/plantree/ui/src/PlanTreeWindow.css`：实现统一的小窗视觉系统。
- 对应 `test/*.test.ts`、`src/*.test.tsx`：验证领域规则、适配和交互。

### Task 1: 增加可撤销的同级排序领域命令

**Files:**
- Modify: `plugins/plantree/server/src/domain/plan-editor.ts`
- Modify: `plugins/plantree/server/test/plan-editor.test.ts`

**Interfaces:**
- Produces: `EditCommand` 新成员 `{ readonly type: "move"; readonly nodeId: string; readonly parentId: string; readonly position: number }`。
- Produces: `PlanEditor.apply()` 对 `move` 命令更新一个父节点的 `childIds`、计划版本和撤销栈。
- Rejects: 节点非直接子节点、未知节点、未知父节点、非整数或超出 `0..childIds.length - 1` 的位置。

- [ ] **Step 1: 写入失败测试，覆盖排序与撤销**

```ts
it("重新排列同一父节点下的兄弟节点并可撤销", () => {
  const editor = new PlanEditor(planWithChildren(["first", "second", "third"]));

  const moved = editor.apply({ type: "move", nodeId: "third", parentId: "root", position: 0 });
  expect(moved.nodes.root.childIds).toEqual(["third", "first", "second"]);
  expect(moved.version).toBe(2);

  expect(editor.undo().nodes.root.childIds).toEqual(["first", "second", "third"]);
});
```

- [ ] **Step 2: 写入失败测试，覆盖非法移动不会改变快照**

```ts
it.each([
  { nodeId: "other", parentId: "root", position: 0 },
  { nodeId: "first", parentId: "missing", position: 0 },
  { nodeId: "first", parentId: "root", position: 3 },
])("拒绝非法同级移动 %#", (command) => {
  const editor = new PlanEditor(planWithChildren(["first", "second"]));
  expect(() => editor.apply({ type: "move", ...command })).toThrow();
  expect(editor.read().nodes.root.childIds).toEqual(["first", "second"]);
});
```

- [ ] **Step 3: 运行定向测试确认失败**

Run: `npm test -- test/plan-editor.test.ts`

Expected: FAIL，原因是 `EditCommand` 尚不包含 `move`，且 `PlanEditor.apply()` 未处理排序。

- [ ] **Step 4: 实现最小排序逻辑**

在 `EditCommand` 联合类型加入 `move`，在 `switch (command.type)` 添加分支，并实现：

```ts
function applyMove(plan: MutablePlan, command: Extract<EditCommand, { type: "move" }>): void {
  const parent = requireNode(plan, command.parentId);
  requireNode(plan, command.nodeId);
  const currentPosition = parent.childIds.indexOf(command.nodeId);
  if (currentPosition < 0) throw new Error("节点不是指定父节点的直接子节点。");
  if (!Number.isInteger(command.position) || command.position < 0 || command.position >= parent.childIds.length) {
    throw new Error("目标排序位置无效。");
  }
  const childIds = [...parent.childIds];
  childIds.splice(currentPosition, 1);
  childIds.splice(command.position, 0, command.nodeId);
  plan.nodes[parent.id] = bumpNode(parent, { childIds });
}
```

不要修改节点的 `parentId`、`dependsOn`、`status` 或任何其他父节点。

- [ ] **Step 5: 运行定向测试确认通过**

Run: `npm test -- test/plan-editor.test.ts`

Expected: PASS，现有编辑命令测试和新增排序/拒绝测试均通过。

### Task 2: 将排序接入会话、MCP 与 HTTP

**Files:**
- Modify: `plugins/plantree/server/src/application/demo-session.ts`
- Modify: `plugins/plantree/server/src/server.ts`
- Modify: `plugins/plantree/server/src/web-api.ts`
- Modify: `plugins/plantree/server/test/demo-session.test.ts`
- Modify: `plugins/plantree/server/test/server.test.ts`
- Modify: `plugins/plantree/server/test/web-api.test.ts`

**Interfaces:**
- Produces: `DemoSession.move(nodeId, parentId, position): DemoLoadResult`。
- Produces: MCP `move_node({ nodeId, parentId, position })`，输出沿用 `planToolOutputSchema`。
- Produces: `POST /api/nodes/move`，JSON body 为 `{ nodeId, parentId, position }`。

- [ ] **Step 1: 写入会话失败测试**

```ts
it("移动排序更新会话并由 undo 恢复", () => {
  const session = new DemoSession();
  const before = session.read().snapshot.nodes.goal.childIds;
  const moved = session.move("verify", "goal", 0);

  expect(moved.snapshot.nodes.goal.childIds[0]).toBe("verify");
  expect(session.undo().snapshot.nodes.goal.childIds).toEqual(before);
});
```

- [ ] **Step 2: 写入 MCP 与 HTTP 失败测试**

```ts
const result = await client.callTool({ name: "move_node", arguments: { nodeId: "verify", parentId: "goal", position: 0 } });
expect(result.structuredContent.snapshot.nodes.goal.childIds[0]).toBe("verify");

const response = await request(api, "POST", "/api/nodes/move", { nodeId: "verify", parentId: "goal", position: 0 });
expect(response.body.snapshot.nodes.goal.childIds[0]).toBe("verify");
```

- [ ] **Step 3: 运行定向测试确认失败**

Run: `npm test -- test/demo-session.test.ts test/server.test.ts test/web-api.test.ts`

Expected: FAIL，因为会话方法、MCP 工具和 HTTP 路径均未实现。

- [ ] **Step 4: 实现会话与适配层**

在 `DemoSession` 增加：

```ts
move(nodeId: string, parentId: string, position: number): DemoLoadResult {
  return this.edit({ type: "move", nodeId, parentId, position });
}
```

更新 `DemoSession.edit()` 取得影响节点时的 node ID：

```ts
const nodeId = command.type === "add" ? command.node.id : command.nodeId;
```

该表达式已覆盖 `move`；不要让 `replan` 对排序制造新节点或重写结构。如 `replan` 不接受 `move`，在调用前仅对 `move` 跳过重规划，后续仍执行依赖同步、保存撤销快照与影响分析。

在 `server.ts` 注册：

```ts
server.registerTool("move_node", {
  description: "调整同一父节点下任务的显示顺序。",
  inputSchema: { nodeId: z.string(), parentId: z.string(), position: z.number().int().nonnegative() },
  outputSchema: planToolOutputSchema,
}, ({ nodeId, parentId, position }) => dataToolResponse(demoSession.move(nodeId, parentId, position)));
```

在 `web-api.ts` 的 POST 路由添加 `/api/nodes/move`，解析 JSON 后进行运行时字段校验，缺失字段抛出 `Error("移动参数不完整。")`，再调用 `session.move()`。

- [ ] **Step 5: 运行定向测试与服务端构建**

Run: `npm test -- test/demo-session.test.ts test/server.test.ts test/web-api.test.ts; npm run build`

Expected: PASS；MCP 与 Web 的排序结果均由其各自的会话快照返回，撤销行为保持可用。

### Task 3: 增加通用 HTTP 排序调用适配

**Files:**
- Modify: `plugins/plantree/ui/src/http-tool-caller.ts`
- Modify: `plugins/plantree/ui/src/http-tool-caller.test.ts`

**Interfaces:**
- Produces: `createHttpToolCaller()` 支持 `move_node`，映射为 `POST /api/nodes/move`。
- Consumes: `ToolCaller("move_node", { nodeId, parentId, position })`。

- [ ] **Step 1: 写入失败测试**

```ts
it("将同级排序映射为本机移动接口", async () => {
  const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot: initialSnapshot }), { status: 200 }));
  const caller = createHttpToolCaller("http://127.0.0.1:4174", fetchStub);

  await caller("move_node", { nodeId: "third", parentId: "root", position: 0 });

  expect(fetchStub).toHaveBeenCalledWith("http://127.0.0.1:4174/api/nodes/move", expect.objectContaining({
    method: "POST", body: JSON.stringify({ nodeId: "third", parentId: "root", position: 0 }),
  }));
});
```

- [ ] **Step 2: 运行失败测试确认映射缺失**

Run: `npm test -- src/http-tool-caller.test.ts`

Expected: FAIL，错误为不支持的 `move_node` 命令。

- [ ] **Step 3: 添加最小命令映射**

在 `toRequest()` 中，于 `edit_node` 分支前添加：

```ts
if (name === "move_node") return post("/api/nodes/move", args);
```

- [ ] **Step 4: 运行定向前端测试**

Run: `npm test -- src/http-tool-caller.test.ts`

Expected: PASS，已有编辑、模拟、撤销、重置映射不变。

### Task 4: 重构小窗树导航与语义化操作

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.tsx`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`

**Interfaces:**
- Produces: 本地 `expandedIds`、`selectedIds`、`focusedId` 和 `selectionAnchorId` 状态。
- Produces: `visibleNodeIds(snapshot, expandedIds)` 与 `findNextExecutableNode(snapshot, nodeId)` 纯辅助函数。
- Produces: 阶段节点的“查看下一项”操作；可执行叶节点的“完成模拟”操作；被阻塞节点的“查看阻塞原因”操作。

- [ ] **Step 1: 写入失败测试，覆盖默认展开和阶段主操作**

```tsx
it("默认展开当前可执行任务所在分支，并为阶段显示下一项", () => {
  render(<PlanTreeWindow plan={snapshotWithPhaseAndExecutableLeaf} />);

  expect(screen.getByRole("button", { name: /收集上下文/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /调查崩溃路径/ }));
  expect(screen.getByRole("button", { name: "查看下一项" })).toBeVisible();
  expect(screen.getByText("下一项：收集上下文")).toBeVisible();
});
```

- [ ] **Step 2: 写入失败测试，覆盖选择、折叠与键盘导航**

```tsx
it("支持折叠、连续多选和方向键移动焦点", () => {
  render(<PlanTreeWindow plan={threeVisibleSiblingSnapshot} />);
  const tree = screen.getByRole("tree", { name: "任务树层级" });

  fireEvent.keyDown(tree, { key: "ArrowDown" });
  fireEvent.keyDown(tree, { key: " ", shiftKey: true });
  expect(screen.getByText("已选 2 项")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "折叠根任务" }));
  expect(screen.queryByRole("button", { name: /第二项/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: 写入失败测试，覆盖服务端摘要与错误保留**

```tsx
it("显示服务端摘要和具体错误，而非通用操作结果", async () => {
  const caller = vi.fn()
    .mockResolvedValueOnce({ summary: "已完成节点 \"child\" 的模拟执行。", snapshot: refreshedSnapshot })
    .mockRejectedValueOnce(new Error("节点不是可执行叶节点。"));
  render(<PlanTreeWindow plan={initialSnapshot} toolCaller={caller} />);

  fireEvent.click(screen.getByRole("button", { name: "完成模拟" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已完成节点"));
  fireEvent.click(screen.getByRole("button", { name: "完成模拟" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("节点不是可执行叶节点。"));
});
```

- [ ] **Step 4: 运行定向测试确认失败**

Run: `npm test -- src/PlanTreeWindow.test.tsx`

Expected: FAIL，因为现有组件没有折叠、本地多选、键盘导航或语义化主操作。

- [ ] **Step 5: 实现纯派生逻辑和本地状态**

按深度优先顺序实现可见节点列表；初始 `expandedIds` 包含根节点及第一个无未完成依赖叶节点的祖先。`findNextExecutableNode()` 仅返回 `kind === "task"`、状态为 `pending` 且所有依赖均为 `completed` 的节点。

在树容器加入 `tabIndex={0}` 和 `onKeyDown`，使用可见节点列表处理 `ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight`、`Space`、`Enter` 与 `Ctrl/Cmd+Z`。选择行为遵循：普通点击单选、Shift 连续范围、Ctrl/Cmd 切换；失去快照中节点时回退到最近可见父节点或根节点。

- [ ] **Step 6: 实现节点行和上下文操作区**

将节点行拆为折叠按钮、可选中正文和状态提示：

```tsx
<button aria-label={`${expanded ? "折叠" : "展开"}${node.title}`} onClick={() => toggleExpanded(node.id)} />
<button aria-pressed={selectedIds.has(node.id)} onClick={(event) => selectNode(node.id, event)}>
  <StatusIcon status={node.status} blocked={isBlocked(node)} />
  <span>{node.title}</span><span>{nodeHint(node)}</span>
</button>
```

操作区依据选中集合：多选显示“已选 N 项”和“清除选择”；选中阶段显示“查看下一项”，点击后选中并展开推荐叶节点；选中可执行叶节点显示“完成模拟”；被阻塞任务显示“查看阻塞原因”，点击后选择第一个未完成依赖。仅当服务端实际支持时展示展开、裁剪等操作。

修改 `runCommand()`：从工具结果读取 `summary` 与 `snapshot`，成功后将反馈设置为服务端摘要；`catch (error)` 显示 `error instanceof Error ? error.message : "请求失败。"`。保留旧快照和选择。

- [ ] **Step 7: 运行定向 UI 测试与类型检查**

Run: `npm test -- src/PlanTreeWindow.test.tsx; npm run typecheck`

Expected: PASS；阶段不会调用模拟命令，叶节点会调用，选择与折叠保持本地状态，工具反馈显示精确摘要或错误。

### Task 5: 实现框选与同级拖拽排序

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.tsx`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`

**Interfaces:**
- Produces: 框选状态 `{ startX, startY, currentX, currentY } | null`，仅框选当前可见节点。
- Produces: `ToolCaller("move_node", { nodeId, parentId, position })`，仅对同父节点的拖拽投放调用。

- [ ] **Step 1: 写入失败测试，覆盖框选可见节点**

```tsx
it("在任务树空白区域框选可见节点而不调用服务端", () => {
  const caller = vi.fn();
  render(<PlanTreeWindow plan={threeVisibleSiblingSnapshot} toolCaller={caller} />);
  const tree = screen.getByRole("tree", { name: "任务树层级" });

  fireEvent.pointerDown(tree, { clientX: 0, clientY: 40, target: tree });
  fireEvent.pointerMove(tree, { clientX: 300, clientY: 150 });
  fireEvent.pointerUp(tree, { clientX: 300, clientY: 150 });

  expect(screen.getByText("已选 2 项")).toBeVisible();
  expect(caller).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 写入失败测试，覆盖合法与非法拖放**

```tsx
it("仅将同父节点拖放转为 move_node 命令", async () => {
  const caller = vi.fn().mockResolvedValue({ snapshot: reorderedSnapshot, summary: "已更新计划顺序。" });
  render(<PlanTreeWindow plan={threeVisibleSiblingSnapshot} toolCaller={caller} />);

  fireEvent.dragStart(screen.getByLabelText("拖动第三项"));
  fireEvent.dragOver(screen.getByRole("button", { name: /第一项/ }));
  fireEvent.drop(screen.getByRole("button", { name: /第一项/ }));

  await waitFor(() => expect(caller).toHaveBeenCalledWith("move_node", { nodeId: "third", parentId: "root", position: 0 }));
});
```

- [ ] **Step 3: 运行定向测试确认失败**

Run: `npm test -- src/PlanTreeWindow.test.tsx`

Expected: FAIL，因为组件尚未渲染选择框、拖拽把手或 `move_node` 调用。

- [ ] **Step 4: 实现框选**

仅当 `pointerdown` 的 `event.target === treeElement` 时开始框选；在 `pointermove` 计算相对树容器的矩形，并与可见节点行的 `getBoundingClientRect()` 相交。`pointerup` 将命中的节点 ID 写入 `selectedIds`，并清除选择框。节点按钮与折叠按钮须 `stopPropagation()`，防止普通点击启动框选。

- [ ] **Step 5: 实现同级拖拽**

每个非根节点渲染：

```tsx
<button className="plantree-drag-handle" draggable aria-label={`拖动${node.title}`}
  onDragStart={() => setDraggedNodeId(node.id)} />
```

仅当 `draggedNode.parentId === dropTarget.parentId` 且父 ID 非空时，`dragOver` 允许投放并设置插入位置；`drop` 通过当前父节点 `childIds` 算出 `position`，调用 `runCommand("move_node", { nodeId, parentId, position })`。任何不同父节点目标均不调用 `preventDefault()`、不显示插入线、不调用服务端。拖动结束无论成功或失败均清理本地拖拽状态。

- [ ] **Step 6: 运行定向 UI 测试**

Run: `npm test -- src/PlanTreeWindow.test.tsx`

Expected: PASS；框选不发请求，合法同级拖放发出正确命令，非法跨父投放无命令。

### Task 6: 应用统一轻量视觉与双入口验收

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.css`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`（仅在需要断言可访问性标签时）
- Modify: `plugins/plantree/README.md`

**Interfaces:**
- Produces: 420 至 560 像素内可读的单列小窗样式；MCP 与 Web 加载同一 CSS。
- Documents: Web 与 MCP 共享交互，Web 为备用承载；拖拽仅同级排序。

- [ ] **Step 1: 写入失败的语义可访问性断言**

```tsx
it("为状态、拖拽和最近反馈提供可访问名称", () => {
  render(<PlanTreeWindow plan={threeVisibleSiblingSnapshot} />);
  expect(screen.getByRole("tree", { name: "任务树层级" })).toBeVisible();
  expect(screen.getByLabelText("拖动第一项")).toBeVisible();
  expect(screen.getByRole("button", { name: "查看下一项" })).toBeVisible();
});
```

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `npm test -- src/PlanTreeWindow.test.tsx`

Expected: FAIL，直到前序任务完成相应语义元素。

- [ ] **Step 3: 重写小窗 CSS，不改变 DOM 数据流**

定义 CSS 自定义属性：中性背景、白色内容面、蓝紫主色、完成/阻塞/失效状态色。设置 `.plantree-window { width: min(560px, 100%); }`；节点行高度至少 40 像素、焦点样式清晰、标题允许两行、提示单行截断。移除黄色大面积选中背景和冗余卡片边框，使用浅分隔线、间距和柔和焦点底色。为 `.plantree-selection-rect`、`.plantree-drop-indicator` 和 `.plantree-drag-handle` 添加可辨识但不抢眼的状态样式。

- [ ] **Step 4: 更新使用说明**

在 README 的行为边界后补充：MCP 小窗与 Web 使用同一界面；支持折叠、选择、键盘导航、框选与同级排序；不支持跨窗口/文件拖放或跨父节点移动。

- [ ] **Step 5: 运行完整验证**

Run:

```powershell
Set-Location plugins/plantree/server
npm run build
npm test
Set-Location ../ui
npm test
npm run typecheck
npm run build
```

Expected: 服务端构建及全部测试通过；前端测试、类型检查和 Vite 构建通过；未修改 `.mcp.json` 或任何 Codex 代理配置。

- [ ] **Step 6: 进行人工双入口检查**

运行 `npm run web` 后打开 `http://127.0.0.1:5174`，检查任务树的折叠、选择、框选、可执行叶任务模拟、阶段“查看下一项”、同级拖拽排序和撤销。MCP 工具可用时，调用 `create_or_load_demo` 后调用 `render_plan_tree`，核对相同快照下的布局、文案和操作行为一致。

## 计划自检

- 设计中的单列轻量界面、同构入口、折叠、多选、框选、键盘导航、语义化操作、同级拖拽、精确反馈和撤销均有对应任务。
- `move_node` 的领域校验、会话撤销、MCP、HTTP 与前端适配均由定向测试覆盖。
- 计划未包含跨窗口/文件拖放、全屏/多栏、跨父移动、依赖编辑、持久化或代理设置改动。
- 所有新增接口名称一致：`move_node`、`/api/nodes/move`、`DemoSession.move()`。
