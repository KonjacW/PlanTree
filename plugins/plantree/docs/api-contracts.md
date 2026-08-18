# MCP 与 HTTP 接口契约

## 通用约定

- 所有改变任务树的操作必须携带非负整数 `expectedVersion`。
- 成功结果包含 `summary` 和完整 `snapshot`。
- MCP 成功结果同时返回文本 `content` 与 `structuredContent`。
- MCP 版本冲突返回错误结果，并在 `structuredContent.snapshot` 携带最新快照。
- HTTP 成功返回 `200` JSON；版本冲突返回 `409`：

```json
{
  "error": "任务树已被其他入口更新，请刷新后重试。",
  "snapshot": {}
}
```

- HTTP 参数或领域错误返回 `400`；未知资源返回 `404`。

## MCP 工具

| 工具 | 输入 | 是否写入 | 说明 |
| --- | --- | --- | --- |
| `build_planner_prompt` | `goal` | 否 | 为 Codex 生成只输出 TaskTree JSON 的规划提示词。 |
| `import_task_tree` | `tree`、`expectedVersion` | 是 | 校验并导入 Codex 生成的 TaskTree JSON。 |
| `compile_execution_chain` | 无 | 否 | 按深度优先叶节点顺序生成执行链和每项提示词。 |
| `start_next_task` | `expectedVersion` | 条件写入 | 领取首个未完成任务并标记为 `in_progress`；已有任务执行中时幂等返回。 |
| `complete_task` | `nodeId`、`expectedVersion` | 是 | 只允许完成当前执行中节点，并返回下一项或 `done: true`。 |
| `create_or_load_demo` | 无 | 否 | 读取当前持久化任务树；首次读取时创建演示状态。 |
| `edit_node` | 编辑参数、`expectedVersion` | 是 | 添加、改写、展开或裁剪节点；UI 使用 `rewrite` 编辑任务、方法和验收。 |
| `simulate_execution` | `nodeId`、`expectedVersion` | 条件写入 | 执行合法叶节点；阻塞时返回原快照。 |
| `move_node` | `nodeId`、`parentId`、`position`、`expectedVersion` | 是 | 调整同一父节点下的业务顺序。与前端视觉拖动无关。 |
| `undo_last_edit` | `expectedVersion` | 是 | 撤销当前 MCP 进程最近一次可撤销操作。 |
| `redo_last_edit` | `expectedVersion` | 是 | 重做当前 MCP 进程最近一次撤销。 |
| `reset_demo` | `expectedVersion` | 是 | 写入初始演示内容并清空当前进程历史。 |
| `render_plan_tree` | 可选 `snapshot` | 否 | 启动侧栏任务树，把计划绑定到当前 Codex `threadId`，并返回快照和侧栏链接。 |
| `wait_for_execution_request` | `afterRequestId`、`timeoutSeconds` | 否 | 兼容旧客户端的执行请求轮询；正常流程不使用。 |

### `edit_node` 操作

公共字段：

```json
{
  "operation": "add | rewrite | expand | prune | prompt",
  "expectedVersion": 0
}
```

| 操作 | 必填字段 | 行为 |
| --- | --- | --- |
| `add` | `parentId`、`node` | 添加节点；`node` 需要 `id`、`title`、`objective`、`kind`、`dependsOn`。 |
| `rewrite` | `nodeId`、非空 `objective` | 改写节点内容并触发既有重规划流程；可提供 `title`、`method`、`acceptance`，`method: null` 清除方法，空 `acceptance` 清除显式验收。改写会清除遗留 `customPrompt`。 |
| `expand` | `nodeId` | 使用现有模拟规划逻辑展开节点。 |
| `prune` | `nodeId` | 裁剪非根节点及其子树。 |
| `prompt` | `nodeId` | 仅为旧客户端保留；UI 和执行链不再读取人工自由文本覆盖。 |

参数组合不完整时抛出“编辑参数不完整。”。

## HTTP 路由

| 方法与路径 | 请求体 | 对应应用操作 |
| --- | --- | --- |
| `GET /api/plan` | 无 | `session.read()` |
| `POST /api/planner/prompt` | `{ goal }` | 生成 TaskTree 规划提示词。 |
| `POST /api/plan/import` | `{ tree, expectedVersion }` | `session.importTaskTree()` |
| `POST /api/execution/chain` | `{}` | `session.compileExecutionChain()` |
| `POST /api/execution/request` | `{ planId, snapshotVersion }` | 校验快照与对话绑定，写入递增请求，并在绑定的 Codex 对话启动执行回合。 |
| `POST /api/execution/next` | `{ expectedVersion }` | `session.startNext()` |
| `POST /api/execution/{nodeId}/complete` | `{ expectedVersion }` | `session.complete()` |
| `POST /api/demo/load` | `{ expectedVersion }` | 当前实现与重置相同，调用 `session.reset()`。 |
| `POST /api/demo/reset` | `{ expectedVersion }` | `session.reset()` |
| `POST /api/undo` | `{ expectedVersion }` | `session.undo()` |
| `POST /api/redo` | `{ expectedVersion }` | `session.redo()` |
| `POST /api/nodes/edit` | `edit_node` 参数 | `session.edit()` |
| `POST /api/nodes/move` | `{ nodeId, parentId, position, expectedVersion }` | `session.move()` |
| `POST /api/nodes/{nodeId}/simulate` | `{ expectedVersion }` | `session.simulate()` |

请求体必须是 JSON。除 `GET /api/plan` 外，所有现有 HTTP 路由都是 `POST`。

## HTTP 客户端映射

`ui/src/http-tool-caller.ts` 支持 UI 实际使用的写命令：

- `move_node`
- `edit_node`
- `simulate_execution`
- `compile_execution_chain`
- `start_next_task`
- `complete_task`
- `undo_last_edit`
- `redo_last_edit`
- `reset_demo`

初始快照通过 Web 入口直接读取 `GET /api/plan`。增加新命令时，需要同步修改服务端路由、HTTP `ToolCaller`、MCP 注册和协议测试。

## 版本冲突处理

客户端不得在冲突后重复提交旧请求。正确流程是：

1. 接收错误中的服务端最新 `snapshot`。
2. 使用该快照刷新界面和版本。
3. 清理已删除节点对应的选择、坐标覆盖和节点内容草稿。
4. 用户确认后，基于新版本重新发起操作。

撤销/重做还要求当前持久化版本与该服务进程的历史头版本一致，因此另一入口写入后，旧进程历史不能覆盖新内容。
