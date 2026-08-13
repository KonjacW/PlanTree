# PlanTree 共享持久化任务树设计

## 目标

将 PlanTree 从独立内存演示会话改为本机单用户共享的持久化任务树：MCP 服务与本地 Web API 访问同一 JSON 状态文件，重启后恢复任务树，并在下一次读写时看到另一入口的最新保存结果。

## 范围与约束

- 保留现有 MCP 工具名称、轻量小窗和 Web 页面；不修改 `codexzh` 或任何代理配置。
- 状态文件仅由后端读写，前端和 Agent 必须通过 HTTP/MCP 接口操作任务树。
- 仅支持 Windows 本机单用户；不使用数据库、云同步、文件监听或跨设备协作。
- 每次读取和写入前重新读取状态文件；不在 MCP 与 Web 服务中保留权威内存快照。
- `reset_demo` 恢复预置演示任务并直接覆盖实际状态文件。

## 文件布局

```text
plugins/plantree/
  data/
    plantree-plan.json          # 运行时状态，忽略提交
    plantree-plan.example.json  # 初始示例，提交到 GitHub
```

`plantree-plan.json` 不存在时，后端以 `initialDemoPlan` 创建等价快照并写入文件。示例文件仅用于说明 JSON 结构与 GitHub 分发；运行时不从示例文件复制，避免用户修改示例文件影响真实初始化行为。

## 架构与数据流

```text
MCP 工具 / Codex Agent ─┐
                        ├─ PersistentPlanStore ──> plantree-plan.json
Web HTTP API ───────────┘             │
                                      └─ 原子替换临时文件

PlanTreeWindow / Web ──< 最新 PlanSnapshot JSON 响应
```

`PersistentPlanStore` 是唯一的持久化边界：负责加载、初始化、版本检查、原子写入与重置。`DemoSession` 改为一个使用 Store 的应用服务，保留当前编辑、模拟执行、影响分析、依赖同步和撤销的业务语义。

MCP stdio 服务与 Web HTTP 服务各自创建自己的 Store 实例，但两者指向同一个绝对状态文件路径；每一次 Store 读写均访问磁盘，所以不会因各自的内存缓存而长期分叉。

## JSON 结构

文件内容为完整 `PlanSnapshot`：

```json
{
  "id": "demo-import-wizard-crash",
  "version": 1,
  "rootNodeId": "goal",
  "nodes": { "goal": { "id": "goal" } },
  "validation": { "valid": true, "issues": [] },
  "audit": []
}
```

读入时检查顶层字段、`version` 为非负整数、根节点存在、`nodes` 为对象；不符合条件时拒绝当前操作并报告状态文件无效，不自动覆盖用户文件。

## 原子写入

写入始终经过同目录临时文件：

1. 将 JSON 格式化为 UTF-8 字符串；
2. 写入 `plantree-plan.json.tmp`；
3. 使用 Windows 文件替换/重命名将临时文件替换为正式文件；
4. 发生失败时保留原正式文件，并尽力清理临时文件。

写入前创建 `data/` 目录。临时文件路径固定且只在该目录内生成，不接受用户输入的文件路径。

## 版本冲突保护

所有会改变任务树的动作必须携带 `expectedVersion`：`edit_node`、`move_node`、`simulate_execution`、`undo_last_edit`、`reset_demo`。

处理写入动作时：

1. Store 从文件重新读入当前快照；
2. 若 `current.version !== expectedVersion`，不执行任何业务操作、不写文件，并抛出 `PlanVersionConflictError`；
3. 若版本相同，按现有领域逻辑构造新快照、写入文件并返回新快照；
4. 冲突错误消息固定为“任务树已被其他入口更新，请刷新后重试。”，并携带当前快照供调用方刷新。

`GET /api/plan`、`create_or_load_demo` 和 `render_plan_tree` 为读取操作，不要求版本。

## MCP 与 HTTP 契约

### MCP

- 现有工具名称保持不变。
- `edit_node`、`move_node`、`simulate_execution`、`undo_last_edit`、`reset_demo` 增加必填 `expectedVersion: number`。
- 正常输出保持 `{ summary, snapshot }`；发生版本冲突时以工具错误返回固定消息，并包含当前快照的结构化内容。

### HTTP

- `POST /api/nodes/edit`、`POST /api/nodes/move`、`POST /api/nodes/:nodeId/simulate`、`POST /api/undo`、`POST /api/demo/reset` 的 JSON body 增加 `expectedVersion`。
- 版本冲突返回 HTTP `409` 与：

```json
{
  "error": "任务树已被其他入口更新，请刷新后重试。",
  "snapshot": { "...": "当前最新快照" }
}
```

- 其他业务校验错误仍返回 `400`；未知路径仍返回 `404`。

## 前端行为

`PlanTreeWindow` 在发起变更命令时自动从当前快照注入 `expectedVersion`。响应成功时仍以服务端返回快照刷新。

HTTP 调用收到 `409` 时，适配器保留响应中的快照并抛出可识别的冲突错误；组件使用该最新快照更新界面，保留仍存在的本地选中与折叠状态，并显示“任务树已被其他入口更新，请刷新后重试。”。用户再次操作时将自动携带新版本。

MCP 小窗从下一次显式工具调用或渲染调用取得最新快照；工具错误文本提示用户刷新/重新渲染。

## 撤销与重置

撤销栈仅属于当前运行进程，不能跨重启恢复；每个撤销写入前同样进行 `expectedVersion` 检查。若另一入口已写入，撤销被拒绝而不会覆盖对方更新。

`reset_demo` 也要求 `expectedVersion`，成功后以预置演示快照覆盖状态文件，并清空当前进程的撤销栈。

## 测试与验收

- Store：首次自动初始化、读写、格式校验、原子写入失败保留旧文件、重置覆盖文件。
- Store：版本一致可写入、版本不一致返回当前快照且不改文件。
- 应用服务：编辑、移动、模拟、撤销均写入文件；新 Store 实例读取到结果。
- MCP：变更工具要求版本；版本冲突返回固定错误与当前快照；读取工具无需版本。
- HTTP：变更路由要求版本；版本冲突返回 `409` 与当前快照。
- UI：每个变更命令带当前版本；HTTP `409` 后用响应快照刷新、显示冲突提示、保留仍有效的选择。
- 人工验收：同时启动 MCP 与 Web；在一个入口操作，在另一个入口读取并确认看到更新；用旧版本请求确认得到冲突；重启 Web 后状态仍保留。

## 非目标

- 前端直接编辑 JSON 文件。
- 自动刷新、轮询、文件监听或实时推送。
- 多进程文件锁、多人协作、云同步、数据库与跨设备一致性。
- 备份目录、导入导出和历史版本管理；这些作为独立后续功能。
