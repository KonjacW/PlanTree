# PlanTree 四阶段执行工作流设计

## 目标

在不将 Agent 业务逻辑放入前端的前提下，为 PlanTree 提供可实时同步的四阶段界面。前端负责展示权威状态、收集人工操作、发送命令、编辑本地草稿和审阅结果；后端负责树生成、结构变更、提示词生成、执行与所有状态判定。

## 阶段

| 阶段 | 标识 | 前端可用操作 | 后端职责 |
| --- | --- | --- | --- |
| 初步设计 | `structure_draft` | 查看生成进度、接受初始快照 | Agent 生成初始计划树 |
| 结构审阅 | `structure_review` | 展开、裁剪、编辑节点、增删依赖关系、确认结构 | 处理版本化结构命令 |
| 提示词生成 | `prompt_generation` | 对全树或受影响范围发起生成、查看节点进度 | Agent 生成建议提示词 |
| 提示词审阅与执行 | `prompt_review_execution` | 编辑/采纳提示词、执行单个节点并停止、回到结构审阅 | 保存确认提示词、执行节点、推送运行状态 |

阶段不是不可逆向的锁。执行过程中可在任意节点完成并停止后返回 `structure_review`，但已完成节点保留历史记录且第一版禁止编辑，只显示不可编辑原因。显式“返工”命令延后到实际需要修改已完成节点时再实现。

## 节点与提示词状态

节点执行状态：`pending`、`running`、`completed`、`failed`、`stopped`。

提示词状态：`missing`、`draft`、`confirmed`、`stale`。每份提示词保存它生成或确认时的 `treeVersion`。树结构、目标、类型或父节点变化时，变更节点及其未执行后代标记为 `stale`；依赖关系变化时，仅标记被编辑依赖的目标节点。第一版不自动将所有依赖者标记为 `stale`，用户可显式选择重生成范围。

人工编辑过的提示词绝不被 Agent 自动覆盖。第 3 阶段只生成 `suggestedPrompt`；第 4 阶段由用户选择采纳建议、保留已确认文本或继续编辑。只有人工保存或明确采纳后，`confirmedPrompt` 才能更新为可执行版本。

## 关系接口

前端从规范化关系读取图，而不是让画布直接依赖 `parent` 与 `dependency` 字段：

```ts
type Relation = {
  id: string;
  from: string;
  to: string;
  type: 'tree' | 'dependency' | string;
  metadata?: Record<string, unknown>;
};

getRelations(snapshot): Relation[]
upsertRelation(relation, expectedVersion): CommandResult
removeRelation(relationId, expectedVersion): CommandResult
```

`tree` 决定单侧布局；`dependency` 保留领域数据。当前画布隐藏同一父节点下仅表示顺序的依赖线，但不得删除其数据。未知 `type` 必须保留在 JSON 并在节点详情中显示其原始信息；第一版画布不渲染未知类型，避免预先设计没有需求的视觉样式。

第一版必须支持人工编辑 `dependency`：用户在单节点详情中选择另一个节点作为前置依赖，或移除已有前置依赖。新增和删除均调用 `upsertRelation` / `removeRelation`，携带 `expectedVersion`，由服务端拒绝无效节点、环形依赖或已执行节点的不允许变更。为保持轻量，第一版不提供画布上的自由拉线、拖拽创建连线或可视化边编辑；画布只负责展示服务端确认后的关系。

## 实时协议

第一版采用 HTTP JSON 命令与 SSE JSON 事件流，不引入 WebSocket、事件回放或前端命令队列。

HTTP 仅用于改变权威状态的命令。实时 Web 前端使用 `POST /api/commands`；旧 HTTP 路由和 MCP 工具保留兼容，但它们都必须委托给同一个后端命令分发函数。每个请求必须包含 `commandId`、`expectedVersion`、`planId`、命令类型与负载。服务端返回结果及完整最新快照，HTTP 409 返回冲突时的完整快照。

`GET /api/events` 使用 SSE 推送 `snapshot`（完整最新 `PlanSnapshot`）、`progress`（规划、提示词生成或执行进度）和 `error`（失败或冲突）。第一版不建立完整执行日志流，只在快照中保留节点最新摘要。任一入口（HTTP、MCP 或 Agent）写入状态文件后，都必须由状态写入层触发新的完整快照事件；计划规模较小，不做增量补放。

前端以服务端 `version` 为唯一权威。SSE 断线由浏览器自动重连，重连后前端调用 `GET /api/plan` 取得完整快照。收到 409 或更高版本快照时，前端刷新权威状态，并将正在编辑的人工文本保留为本地草稿，提示用户比较后手动提交。

## 前端状态边界

```text
权威状态：计划树、关系、提示词、阶段、执行状态、version
本地草稿：正在编辑的节点/提示词、尚未发送的关系修改
视图状态：选择、缩放、平移、面板、连接状态、命令等待状态
```

当前 Demo 的节点视觉坐标始终属于视图状态，不写入后端计划快照。前端不得自行决定提示词是否有效、节点是否完成或 Agent 是否应继续；它只展示后端推送并发送经过用户触发的命令。

## 可扩展前端契约

第一版使用一个薄 API 适配器，不引入通用插件注册表。阶段页面、画布组件和按钮只调用以下稳定函数，不直接处理路由或 SSE 消息格式：

```ts
type PlanApi = {
  loadPlan(planId: string): Promise<PlanSnapshot>;
  sendCommand(command: PlanCommand): Promise<CommandResult>;
  subscribeToPlanEvents(planId: string, onEvent: (event: PlanEvent) => void): Unsubscribe;
};

type PlanCommand = {
  commandId: string;
  planId: string;
  expectedVersion: number;
  type: string;
  payload: Record<string, unknown>;
};

```

`PlanApi` 是唯一网络边界：现有本地 Demo 可注入内存实现，生产环境注入 HTTP + SSE 实现，测试环境注入可控假实现。未来实际出现第二类 Agent 能力时，再从 `sendCommand` 上层抽出能力注册表；第一版不预先实现。

所有服务端新增字段必须以可选字段和未知值安全处理：前端保留原始事件与未知关系类型，不丢弃数据；无法识别的能力显示为禁用或中性“待支持”项，绝不导致整个快照失效。

## 一致性设计约束

界面复用现有 CSS 变量、按钮、标签、详情面板和确认弹层，不创建独立设计系统。新增阶段轨道、提示词编辑区、活动信息和连接状态都沿用这些现有视觉令牌与交互语义。

新增功能必须遵循同一交互合同：操作在现有节点详情或操作栏中出现；异步过程仅显示最新进度摘要；所有命令显示等待、成功、失败和冲突反馈；不可用操作说明原因；破坏性操作必须经现有确认弹层。这样阶段增加或能力扩展时，用户仍能预测按钮位置、状态色、错误处理和快捷键语义。

## 演进边界

实现保持三层：`domain`（JSON 类型、关系和受影响范围纯函数）、`api`（HTTP/SSE 适配器）和 `ui`（现有窗口组件与阶段面板）。UI 不得直接写状态文件或判断 Agent 业务结果。未来引入新关系、新阶段或新 Agent 命令时，先扩展 `domain` 类型和 `PlanCommand`，再在既有 UI 中呈现。

## 验收准则

1. 人可在结构审阅阶段修改未执行树，并在节点详情中增删依赖关系，随后看到服务端版本更新。
2. 结构变更后，受影响提示词显示为 `stale`，人工确认文本不丢失。
3. 提示词生成只产生建议稿，必须人工采纳或保存后才能执行。
4. 用户可命令 Agent 完成一个节点后停止，并回到结构审阅修改未执行部分。
5. 网络断开、重连和版本冲突不会静默覆盖人工草稿。
6. 关系新增、更新和删除均经版本化命令执行，画布由规范化关系重绘。
7. 新增命令经 `PlanApi` 通信，并复用既有按钮、标签、反馈与确认组件。
8. 未识别的事件、关系类型和可选字段不会导致前端崩溃或静默丢失服务端数据。
