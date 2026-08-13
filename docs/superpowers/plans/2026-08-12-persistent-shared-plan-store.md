# PlanTree 共享持久化任务树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP 与本地 Web 通过同一份可恢复的 JSON 任务树工作，并以版本检查避免过期入口覆盖新更新。

**Architecture:** 新增 `PersistentPlanStore` 作为唯一磁盘读写边界；每次读取或变更都重新加载 `data/plantree-plan.json`。`DemoSession` 改为依赖 Store 的异步应用服务，变更时校验 `expectedVersion` 后原子写入。MCP 和 HTTP 均将版本参数传给会话，前端在本地当前快照上自动注入版本。

**Tech Stack:** TypeScript、Node.js `fs/promises`、Node.js `path`、MCP SDK、Node HTTP、React 19、Vitest。

## Global Constraints

- 保留已有 MCP 工具名称、轻量小窗和 Web 页面；不修改 `codexzh` 或任何代理配置。
- 仅后端可读写 `plugins/plantree/data/plantree-plan.json`；前端与 Agent 只能经 MCP/HTTP 操作。
- 仅支持 Windows 本机单用户；不引入数据库、云同步、文件监听、轮询、跨设备协作或前端直接文件访问。
- 每次 Store 读取与变更均从磁盘读取；`reset_demo` 必须覆盖实际状态文件。
- 所有变更要求 `expectedVersion`，版本不一致时不写文件并返回“任务树已被其他入口更新，请刷新后重试。”。
- 实际 JSON 与临时文件必须进入 `.gitignore`；示例 JSON 必须提交。项目不是 Git 仓库，不执行 `git init`、提交或推送。
- 每项行为先写失败测试、再最小实现、再运行定向测试。

---

## 文件职责

- `plugins/plantree/server/src/application/persistent-plan-store.ts`：状态文件初始化、校验、原子写入、版本冲突与重置。
- `plugins/plantree/server/src/application/demo-session.ts`：基于 Store 执行业务编辑、排序、模拟、撤销与重置。
- `plugins/plantree/server/src/server.ts`：异步 MCP 工具及 `expectedVersion` 输入契约。
- `plugins/plantree/server/src/web-api.ts`：HTTP 版本参数校验与 `409` 冲突响应。
- `plugins/plantree/ui/src/PlanTreeWindow.tsx`：从当前快照注入版本，并处理携带快照的冲突。
- `plugins/plantree/ui/src/http-tool-caller.ts`：将 HTTP `409` 变为可识别、带快照的错误。
- `plugins/plantree/data/plantree-plan.example.json`：可提交的初始状态示例。
- `plugins/plantree/.gitignore`：忽略运行时状态、临时文件、依赖和构建产物。

### Task 1: 实现持久化 Store 与原子状态文件

**Files:**
- Create: `plugins/plantree/server/src/application/persistent-plan-store.ts`
- Create: `plugins/plantree/server/test/persistent-plan-store.test.ts`
- Create: `plugins/plantree/data/plantree-plan.example.json`
- Create: `plugins/plantree/.gitignore`

**Interfaces:**
- Produces: `PersistentPlanStore`。
- Produces: `read(): Promise<PlanSnapshot>`、`write(snapshot: PlanSnapshot, expectedVersion: number): Promise<PlanSnapshot>`、`reset(expectedVersion: number): Promise<PlanSnapshot>`。
- Produces: `PlanVersionConflictError`，含 `snapshot: PlanSnapshot`，消息固定为“任务树已被其他入口更新，请刷新后重试。”。
- Constructor: `new PersistentPlanStore(filePath: string, initialPlan = initialDemoPlan)`。

- [ ] **Step 1: 写入 Store 失败测试，覆盖首次初始化和跨实例读取**

```ts
it("首次读取创建状态文件，其他 Store 实例可读取同一快照", async () => {
  const filePath = join(tempDirectory, "plantree-plan.json");
  const first = new PersistentPlanStore(filePath);
  const initial = await first.read();
  const second = new PersistentPlanStore(filePath);

  expect(initial.id).toBe("demo-import-wizard-crash");
  expect(await second.read()).toEqual(initial);
  await expect(access(filePath)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: 写入 Store 失败测试，覆盖版本冲突和原子写入结果**

```ts
it("仅在版本匹配时写入，并向过期写入返回最新快照", async () => {
  const store = new PersistentPlanStore(join(tempDirectory, "plantree-plan.json"));
  const initial = await store.read();
  const next = { ...initial, version: initial.version + 1 };
  await store.write(next, initial.version);

  await expect(store.write({ ...next, version: next.version + 1 }, initial.version))
    .rejects.toMatchObject({ message: "任务树已被其他入口更新，请刷新后重试。", snapshot: next });
  expect(await store.read()).toEqual(next);
});
```

- [ ] **Step 3: 写入 Store 失败测试，覆盖无效文件与重置覆盖**

```ts
it("拒绝无效状态文件，并在重置时覆盖为演示计划", async () => {
  const filePath = join(tempDirectory, "plantree-plan.json");
  await writeFile(filePath, "{invalid", "utf8");
  const store = new PersistentPlanStore(filePath);
  await expect(store.read()).rejects.toThrow("任务树状态文件无效。");

  await writeFile(filePath, JSON.stringify({ ...initialDemoPlan, version: 7 }), "utf8");
  expect((await store.reset(7)).version).toBe(1);
});
```

- [ ] **Step 4: 运行失败测试**

Run: `npm test -- test/persistent-plan-store.test.ts`

Expected: FAIL，因为 Store 与异常类型尚不存在。

- [ ] **Step 5: 实现 Store、文件校验与原子替换**

实现以下关键逻辑：

```ts
export class PersistentPlanStore {
  constructor(private readonly filePath: string, private readonly initialPlan: PlanSnapshot = initialDemoPlan) {}

  async read(): Promise<PlanSnapshot> { /* 若不存在则 mkdir + 原子写入 initialPlan；否则 parse + validate + clone */ }
  async write(snapshot: PlanSnapshot, expectedVersion: number): Promise<PlanSnapshot> {
    const current = await this.read();
    if (current.version !== expectedVersion) throw new PlanVersionConflictError(current);
    await this.writeAtomically(snapshot);
    return structuredClone(snapshot);
  }
}
```

`validateSnapshot()` 至少检查：对象、非空字符串 `id`/`rootNodeId`、非负整数 `version`、对象 `nodes`、根节点存在、对象 `validation` 与数组 `audit`。解析或校验失败均抛出 `Error("任务树状态文件无效。")`。

`writeAtomically()` 使用 `mkdir(dirname(filePath), { recursive: true })`、`writeFile(`${filePath}.tmp`, JSON.stringify(snapshot, null, 2), "utf8")` 和 `rename(tempPath, filePath)`；失败后尝试 `unlink(tempPath)`，不得删除原文件。

- [ ] **Step 6: 创建发布文件**

创建示例文件，内容为格式化的 `initialDemoPlan` JSON；创建 `.gitignore`：

```gitignore
node_modules/
dist/
data/plantree-plan.json
data/plantree-plan.json.tmp
*.log
```

- [ ] **Step 7: 运行定向测试与服务端构建**

Run: `npm test -- test/persistent-plan-store.test.ts; npm run build`

Expected: PASS；首次初始化、跨实例读取、冲突、无效文件与重置均得到验证。

### Task 2: 将会话业务改为使用 Store 和版本保护

**Files:**
- Modify: `plugins/plantree/server/src/application/demo-session.ts`
- Modify: `plugins/plantree/server/test/demo-session.test.ts`

**Interfaces:**
- `new DemoSession(store?: PersistentPlanStore)`；默认 Store 路径为 `resolve(dirname(fileURLToPath(import.meta.url)), "../../data/plantree-plan.json")`。
- Produces: 异步 `read()`、`edit(command, expectedVersion)`、`move(nodeId, parentId, position, expectedVersion)`、`simulate(nodeId, expectedVersion)`、`undo(expectedVersion)`、`reset(expectedVersion)`。

- [ ] **Step 1: 把现有会话测试改为异步并写入失败测试**

```ts
it("编辑后由另一个会话读取到持久化状态", async () => {
  const storePath = join(tempDirectory, "plan.json");
  const first = new DemoSession(new PersistentPlanStore(storePath));
  const initial = await first.read();
  await first.edit({ type: "expand", nodeId: "repair" }, initial.snapshot.version);

  const second = new DemoSession(new PersistentPlanStore(storePath));
  expect((await second.read()).snapshot.nodes.repair.childIds).toContain("repair-locate-code");
});

it("过期版本编辑不覆盖其他入口的更新", async () => {
  const storePath = join(tempDirectory, "plan.json");
  const first = new DemoSession(new PersistentPlanStore(storePath));
  const second = new DemoSession(new PersistentPlanStore(storePath));
  const version = (await first.read()).snapshot.version;
  await first.move("verify", "goal", 0, version);
  await expect(second.move("test", "goal", 0, version)).rejects.toMatchObject({ message: "任务树已被其他入口更新，请刷新后重试。" });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/demo-session.test.ts`

Expected: FAIL，因为会话仍使用内存快照且方法尚不接收版本。

- [ ] **Step 3: 将业务操作改为异步 Store 读写**

每次变更先 `const before = await store.read()`，检查版本由 `store.write()` 完成。`PlanEditor` 基于 `before` 构造；`move` 不进入 `replan`。将生成的 `next` 传给 `store.write(next, expectedVersion)`，再返回该结果。

撤销栈继续保存在会话实例中：`edit` 与 `move` 成功后推入 `before`；`undo` 先确认栈中有前一快照，再 `store.write(previous, expectedVersion)`，成功后才弹栈。`simulate` 成功后也将 `before` 推栈，以便当前进程撤销模拟变更。`reset` 调用 `store.reset(expectedVersion)` 并清空撤销栈。

- [ ] **Step 4: 运行会话测试与构建**

Run: `npm test -- test/demo-session.test.ts; npm run build`

Expected: PASS；跨实例读取、冲突拒绝、编辑/移动/模拟/撤销/重置的持久化语义通过。

### Task 3: 接入异步 MCP 工具与 HTTP `409` 契约

**Files:**
- Modify: `plugins/plantree/server/src/server.ts`
- Modify: `plugins/plantree/server/src/web-api.ts`
- Modify: `plugins/plantree/server/test/server.test.ts`
- Modify: `plugins/plantree/server/test/web-api.test.ts`

**Interfaces:**
- MCP 变更工具的输入模式均含 `expectedVersion: z.number().int().nonnegative()`。
- HTTP 变更请求 JSON 也必须包含非负整数 `expectedVersion`。
- HTTP 版本冲突：`409`、`{ error, snapshot }`。

- [ ] **Step 1: 写入 MCP 与 HTTP 失败测试**

```ts
await expect(client.callTool({ name: "move_node", arguments: { nodeId: "verify", parentId: "goal", position: 0 } }))
  .rejects.toThrow();

const initial = await request(url, "GET", "/api/plan");
const first = await request(url, "POST", "/api/nodes/move", { nodeId: "verify", parentId: "goal", position: 0, expectedVersion: initial.body.snapshot.version });
const stale = await request(url, "POST", "/api/nodes/move", { nodeId: "test", parentId: "goal", position: 0, expectedVersion: initial.body.snapshot.version });
expect(first.status).toBe(200);
expect(stale).toMatchObject({ status: 409, body: { error: "任务树已被其他入口更新，请刷新后重试。", snapshot: first.body.snapshot } });
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm test -- test/server.test.ts test/web-api.test.ts`

Expected: FAIL，因为现有输入模式、路由解析和错误响应未要求或处理版本。

- [ ] **Step 3: 实现 MCP 异步处理器**

将所有 DemoSession 调用改为 `async`/`await`。为 `edit_node`、`move_node`、`simulate_execution`、`undo_last_edit`、`reset_demo` 加上 `expectedVersion` 输入字段并透传。`create_or_load_demo` 与 `render_plan_tree` 保持无版本读取。

捕获 `PlanVersionConflictError` 时，返回 MCP 工具错误响应，`content` 放固定错误消息，`structuredContent` 放 `{ summary, snapshot }`，让调用端可读到当前快照。

- [ ] **Step 4: 实现 HTTP 参数与冲突处理**

提取：

```ts
function requireExpectedVersion(input: unknown): number {
  if (typeof input !== "object" || input === null || !("expectedVersion" in input) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error("版本参数不完整。");
  }
  return input.expectedVersion;
}
```

各写入路由解析一次 JSON，取得版本后调用对应异步会话方法。`handle()` 捕获 `PlanVersionConflictError` 时返回 `409` 与 `{ error: error.message, snapshot: error.snapshot }`；其他错误维持既有 `400`/`404`。

- [ ] **Step 5: 运行定向服务端测试与构建**

Run: `npm test -- test/server.test.ts test/web-api.test.ts; npm run build`

Expected: PASS；所有变更 MCP/HTTP 请求要求版本，冲突返回最新快照，读取 API 不需要版本。

### Task 4: 让共享小窗自动附带版本并处理 HTTP 冲突

**Files:**
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.tsx`
- Modify: `plugins/plantree/ui/src/http-tool-caller.ts`
- Modify: `plugins/plantree/ui/src/http-tool-caller.test.ts`
- Modify: `plugins/plantree/ui/src/PlanTreeWindow.test.tsx`

**Interfaces:**
- `runCommand()` 对 `edit_node`、`move_node`、`simulate_execution`、`undo_last_edit`、`reset_demo` 合并 `{ expectedVersion: snapshot.version }`。
- Produces: `PlanVersionConflictClientError`，字段 `snapshot: unknown`。

- [ ] **Step 1: 写入 HTTP 适配失败测试**

```ts
it("将 409 转换为带最新快照的版本冲突错误", async () => {
  const latest = { id: "plan", version: 2 };
  const caller = createHttpToolCaller("", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "任务树已被其他入口更新，请刷新后重试。", snapshot: latest }), { status: 409 })));

  await expect(caller("move_node", { nodeId: "a" })).rejects.toMatchObject({ message: "任务树已被其他入口更新，请刷新后重试。", snapshot: latest });
});
```

- [ ] **Step 2: 写入组件失败测试**

```tsx
it("变更命令携带当前版本，冲突后使用服务端最新快照刷新", async () => {
  const latest = { ...snapshot, version: 2 };
  const caller = vi.fn().mockRejectedValue(new PlanVersionConflictClientError("任务树已被其他入口更新，请刷新后重试。", latest));
  render(<PlanTreeWindow plan={snapshot} toolCaller={caller} />);
  fireEvent.click(screen.getByRole("button", { name: "完成模拟" }));

  await waitFor(() => expect(caller).toHaveBeenCalledWith("simulate_execution", { nodeId: "first", expectedVersion: 1 }));
  expect(screen.getByRole("alert")).toHaveTextContent("任务树已被其他入口更新");
  expect(screen.getByText("版本 2")).toBeVisible();
});
```

若新版小窗不展示版本号，改为断言冲突快照中的状态/标题变化；不要仅测试 mock 是否被调用。

- [ ] **Step 3: 运行前端失败测试**

Run: `npm test -- src/http-tool-caller.test.ts src/PlanTreeWindow.test.tsx`

Expected: FAIL，因为适配器不区分 `409`，组件不注入版本或消费冲突快照。

- [ ] **Step 4: 实现冲突错误与版本注入**

在 HTTP 适配器导出：

```ts
export class PlanVersionConflictClientError extends Error {
  constructor(message: string, readonly snapshot: unknown) { super(message); }
}
```

响应 `409` 时构造该错误，其他非成功响应仍是普通 `Error`。

在组件定义 `isMutatingCommand(name)`；仅变更命令合并 `expectedVersion`。`catch` 检测 `PlanVersionConflictClientError` 或鸭子类型的 `{ snapshot }`，通过现有快照解析器替换状态、过滤不存在的选择项、保留仍可见的选择，并显示错误消息。MCP 成功与普通错误的现有行为不变。

- [ ] **Step 5: 运行定向前端测试与类型检查**

Run: `npm test -- src/http-tool-caller.test.ts src/PlanTreeWindow.test.tsx; npm run typecheck`

Expected: PASS；变更调用均带版本，HTTP 冲突刷新 UI，选择和折叠状态在节点仍存在时保留。

### Task 5: 生成示例状态、验证共享持久化并更新开发说明

**Files:**
- Modify: `plugins/plantree/README.md`
- Modify: `plugins/plantree/server/test/web-api.test.ts`
- Modify: `plugins/plantree/server/test/server.test.ts`

**Interfaces:**
- Documents: 状态文件位置、内存撤销限制、Web/MCP 共享、冲突提示和 `reset_demo` 覆盖行为。

- [ ] **Step 1: 写入跨入口失败测试**

使用 `PersistentPlanStore` 的临时路径创建两个 `DemoSession` 或两个 Web API 实例；第一个成功排序后，第二个 `read()` 必须读取到新顺序。再以旧版本调用第二个变更，断言 `409` 与最新快照。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/web-api.test.ts test/server.test.ts`

Expected: FAIL，直到测试夹具能注入同一 Store 路径，且所有写操作都使用版本。

- [ ] **Step 3: 完成可注入实例与 README 说明**

让 `createWebApi(store?: PersistentPlanStore)` 与 `createPlanTreeServer(session?: DemoSession)` 支持测试注入；生产入口仍使用默认文件路径。README 补充：

```text
运行状态：data/plantree-plan.json
首次运行：自动创建
重置演示：覆盖该文件
并发冲突：刷新后重试
撤销：仅当前运行进程可用，重启后清空
```

- [ ] **Step 4: 运行完整验证**

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

Expected: 服务端完整测试、前端完整测试、类型检查与生产构建均通过；状态示例存在且运行时状态未被加入版本控制规则之外。

## 计划自检

- 文件初始化、校验、原子写入、重置、跨实例读取与版本冲突由 Store 测试覆盖。
- 会话、MCP、HTTP 与 UI 均要求/自动传递 `expectedVersion`；HTTP 冲突使用 `409` 与当前快照。
- 计划保留现有工具名称、轻量小窗、Windows 本机范围和前端只经接口访问文件的边界。
- 计划不包含文件监听、轮询、数据库、云同步、跨设备协作、导入导出或备份目录。
