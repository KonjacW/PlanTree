# PlanTree 本地 Web 界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有 MCP 服务行为的前提下，提供可在本机浏览器操作的 PlanTree Web 页面。

**Architecture:** 新建 Node 原生 HTTP 适配层，创建独立的内存 `DemoSession` 并将任务树操作暴露为回环地址 JSON API。新增 Vite React 入口和 HTTP `toolCaller`，复用 `PlanTreeWindow` 与 CSS；MCP stdio 入口仍继续使用已有 `DemoSession` 和工具定义。

**Tech Stack:** TypeScript、Node.js `http`、Vite、React 19、Vitest、Testing Library。

## Global Constraints

- MCP 工具名、输入输出契约与 `plugins/plantree/server/src/index.ts` 的 stdio 行为不得改变。
- Web API 仅绑定 `127.0.0.1`，不请求外部网络、不使用账户或密钥。
- Web 与 MCP 分别拥有独立的内存 `DemoSession`；关闭 Web 服务后 Web 状态丢弃。
- 所有 Web 操作必须使用服务端响应中的 `PlanSnapshot` 刷新前端，前端不得自行推测节点状态。
- 第一版不实现持久化、添加节点或改写节点表单；已有的展开、裁剪、模拟、撤销与重置必须可用。
- 每个行为先写失败测试，再写最小实现；不初始化 Git，也不创建提交。

---

### Task 1: 提取可复用的命令转换与 Web 会话 API

**Files:**
- Create: `plugins/plantree/server/src/web-api.ts`
- Create: `plugins/plantree/server/test/web-api.test.ts`
- Modify: `plugins/plantree/server/src/server.ts`

**Interfaces:**
- Consumes: `DemoSession.read()`, `DemoSession.edit(command)`, `DemoSession.simulate(nodeId)`, `DemoSession.undo()`, `DemoSession.reset()`。
- Produces: `createWebApi(): WebApi`，其中 `handle(request: IncomingMessage, response: ServerResponse): Promise<void>`。
- Produces: `toEditCommand(input)`，供 MCP `edit_node` 与 `POST /api/nodes/edit` 共用，输入不完整时抛出 `Error("编辑参数不完整。")`。
- Produces: 成功响应 `{ summary: string, snapshot: PlanSnapshot }`；客户端错误响应 `{ error: string }`。

- [ ] **Step 1: 写入 API 失败测试**

```ts
it("读取、展开和撤销只影响 Web 会话", async () => {
  const api = createWebApi();
  const initial = await request(api, "GET", "/api/plan");
  const expanded = await request(api, "POST", "/api/nodes/edit", {
    operation: "expand", nodeId: "repair",
  });
  const undone = await request(api, "POST", "/api/undo");

  expect(initial.body.snapshot.nodes.repair.childIds).toEqual([]);
  expect(expanded.body.snapshot.nodes.repair.childIds).toContain("repair-locate-code");
  expect(undone.body.snapshot.nodes.repair.childIds).toEqual([]);
});

it("拒绝未知路径和不完整编辑命令", async () => {
  expect((await request(api, "GET", "/api/missing")).status).toBe(404);
  expect((await request(api, "POST", "/api/nodes/edit", { operation: "add" })).status).toBe(400);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/web-api.test.ts`

Expected: FAIL，因为 `web-api.ts` 与 `createWebApi` 尚不存在。

- [ ] **Step 3: 实现原生 HTTP 路由**

```ts
export function createWebApi() {
  const session = new DemoSession();
  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      if (request.method === "GET" && request.url === "/api/plan") return respond(response, 200, session.read());
      if (request.method === "POST" && request.url === "/api/undo") return respond(response, 200, session.undo());
      // 对 edit、simulate、reset、load 分别路由；解析 JSON 后调用 session。
    },
  };
}
```

将当前 `server.ts` 内部的 `toEditCommand` 导出，HTTP 层直接调用它；不要复制或另写编辑命令的校验规则。

- [ ] **Step 4: 运行定向服务端测试与类型检查**

Run: `npm test -- test/web-api.test.ts; npm run build`

Expected: PASS；`GET /api/plan`、展开、撤销、模拟、重置、加载及错误响应均通过。

- [ ] **Step 5: 运行 MCP 回归测试**

Run: `npm test -- test/server.test.ts`

Expected: PASS；证明提取的命令转换未改变既有 MCP 工具。

### Task 2: 提供仅本机监听的 Web 服务启动器

**Files:**
- Create: `plugins/plantree/server/src/web-server.ts`
- Create: `plugins/plantree/server/test/web-server.test.ts`
- Modify: `plugins/plantree/server/package.json`

**Interfaces:**
- Consumes: `createWebApi()`。
- Produces: `startWebServer(port?: number): Promise<{ server: Server; url: string }>`。
- Produces: `npm run web:server`，启动地址固定为 `http://127.0.0.1:4174`。

- [ ] **Step 1: 写入监听地址失败测试**

```ts
it("只绑定回环地址并可读取计划", async () => {
  const instance = await startWebServer(0);
  try {
    expect(instance.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${instance.url}/api/plan`);
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.id).toBe("demo-import-wizard-crash");
  } finally {
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/web-server.test.ts`

Expected: FAIL，因为 `startWebServer` 尚不存在。

- [ ] **Step 3: 实现启动器与命令**

```ts
export async function startWebServer(port = 4174) {
  const api = createWebApi();
  const server = createServer((request, response) => void api.handle(request, response));
  await once(server.listen(port, "127.0.0.1"), "listening");
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}
```

在 CLI 入口中打印 URL 与 `Ctrl+C` 停止提示；不调用 `open`、不打开外部浏览器。

- [ ] **Step 4: 运行定向测试**

Run: `npm test -- test/web-server.test.ts; npm run build`

Expected: PASS，且测试关闭 server 后不保留监听端口。

### Task 3: 建立 Vite 页面入口与 HTTP 工具适配器

**Files:**
- Create: `plugins/plantree/ui/index.html`
- Create: `plugins/plantree/ui/src/main.tsx`
- Create: `plugins/plantree/ui/src/http-tool-caller.ts`
- Create: `plugins/plantree/ui/src/http-tool-caller.test.ts`
- Modify: `plugins/plantree/ui/package.json`
- Modify: `plugins/plantree/ui/vitest.config.ts`

**Interfaces:**
- Consumes: `PlanTreeWindow` 的 `ToolCaller` 类型。
- Produces: `createHttpToolCaller(baseUrl: string): ToolCaller`。
- Produces: Vite `dev` 与 `build` 命令；开发服务器代理 `/api` 至 `http://127.0.0.1:4174`。

- [ ] **Step 1: 写入 HTTP 命令映射失败测试**

```ts
it("将展开命令发送给编辑 API", async () => {
  const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    summary: "已更新计划", snapshot: initialSnapshot,
  }), { status: 200 }));
  const caller = createHttpToolCaller("http://127.0.0.1:4174", fetchStub);

  await caller("edit_node", { operation: "expand", nodeId: "repair" });

  expect(fetchStub).toHaveBeenCalledWith("http://127.0.0.1:4174/api/nodes/edit", expect.objectContaining({
    method: "POST", body: JSON.stringify({ operation: "expand", nodeId: "repair" }),
  }));
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/http-tool-caller.test.ts`

Expected: FAIL，因为 HTTP 适配器不存在。

- [ ] **Step 3: 实现命令映射与页面加载**

`createHttpToolCaller` 必须按下表映射：

| 组件命令 | HTTP 请求 |
| --- | --- |
| `edit_node` | `POST /api/nodes/edit`，JSON body 为原参数 |
| `simulate_execution` | `POST /api/nodes/{nodeId}/simulate` |
| `undo_last_edit` | `POST /api/undo` |
| `reset_demo` | `POST /api/demo/reset` |

`main.tsx` 在首次渲染前请求 `/api/plan`；加载中显示“正在加载任务树”，失败时显示“无法连接本地 PlanTree 服务”。成功后传入快照与 `createHttpToolCaller("")` 渲染 `PlanTreeWindow`。

- [ ] **Step 4: 配置 Vite**

在 `package.json` 中加入：

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5174",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1 --port 5174"
  }
}
```

新增 `vite.config.ts`，将 `/api` 代理到 `http://127.0.0.1:4174`；Vitest 设置为 `jsdom` 并保留现有 setup 文件。

- [ ] **Step 5: 运行前端测试与构建**

Run: `npm test; npm run build`

Expected: PASS；生成 `dist/index.html` 和静态资源。

### Task 4: 提供一键本地 Web 开发启动与端到端验收

**Files:**
- Create: `plugins/plantree/scripts/start-web.mjs`
- Create: `plugins/plantree/package.json`
- Create: `plugins/plantree/README.md`

**Interfaces:**
- Consumes: `server` 的 `web:server` 与 `ui` 的 `dev` 脚本。
- Produces: `npm run web`，并发启动 API 服务和 Vite；进程退出时同时关闭子进程。
- Produces: 本地使用说明，包含启动地址、内存会话语义和 MCP 独立性。

- [ ] **Step 1: 写入启动脚本失败测试**

```ts
it("启动脚本声明本机 API 与 UI 命令", async () => {
  const script = await readFile(new URL("../../scripts/start-web.mjs", import.meta.url), "utf8");
  expect(script).toContain("web:server");
  expect(script).toContain("vite");
  expect(script).toContain("127.0.0.1");
});
```

将测试放入 `plugins/plantree/server/test/web-launcher.test.ts`，以现有 Vitest 环境运行。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/web-launcher.test.ts`

Expected: FAIL，因为启动脚本不存在。

- [ ] **Step 3: 实现一键脚本与说明**

创建根 `package.json`：

```json
{
  "private": true,
  "scripts": { "web": "node scripts/start-web.mjs" }
}
```

脚本使用 `node:child_process` 启动两个 npm 子进程：`npm --prefix ../server run web:server` 与 `npm --prefix ../ui run dev`；监听 `SIGINT` / `SIGTERM` 后终止二者。输出固定访问地址 `http://127.0.0.1:5174`。不自动打开浏览器，避免在自动化或 MCP 场景产生副作用。

README 必须说明：先在 `server`、`ui` 各运行一次 `npm install`，然后在 `plugins/plantree` 执行 `npm run web`；Web 状态不持久化、与 MCP 会话独立、只监听本机。

- [ ] **Step 4: 运行完整验证**

Run:

```powershell
Set-Location plugins/plantree/server; npm run build; npm test
Set-Location ../ui; npm test; npm run build
Set-Location ..; npm run web
```

Expected:

- 服务端 32 项既有测试加新增 Web 测试全部通过。
- UI 测试与 Vite 构建通过。
- `http://127.0.0.1:5174` 可加载页面，`GET /api/plan` 返回 `demo-import-wizard-crash`。
- 在页面执行“展开”和“重置”后，版本与审计记录依服务端快照刷新。

- [ ] **Step 5: 记录无 Git 提交状态**

运行 `git status --short`。若仍显示“not a git repository”，在最终交接中说明项目未初始化 Git；不得执行 `git init`。

## 计划自检

- 覆盖设计中的双入口、独立内存会话、回环监听、无持久化与 UI 复用。
- 每个新接口均定义了输入、输出与先失败后实现的验证步骤。
- 未计划修改 MCP `.mcp.json`、stdio 入口或现有 MCP 工具契约。
- 未引入后端 HTTP 框架、数据库、账户或外部网络。
