# 数据结构与持久化

## `PlanSnapshot`

```ts
interface PlanSnapshot {
  id: string;
  version: number;
  rootNodeId: string;
  nodes: Readonly<Record<string, PlanNode>>;
  validation: ValidationResult;
  audit: readonly AuditEntry[];
}
```

- `version` 是计划级乐观并发版本，必须是非负整数。
- `rootNodeId` 必须存在于 `nodes`。
- 服务端写命令返回完整快照，不返回局部补丁。

## `PlanNode`

| 字段 | 类型与含义 |
| --- | --- |
| `id` | 节点稳定标识，同时是 `nodes` 映射键。 |
| `title` | 节点标题。 |
| `objective` | 节点目标。 |
| `kind` | `goal`、`phase`、`task` 或 `checkpoint`。 |
| `status` | `pending_planning`、`pending`、`in_progress`、`completed`、`skipped` 或 `invalid`。 |
| `parentId` | 父节点 ID；根节点为 `null`。 |
| `childIds` | 权威子节点列表及同层顺序。 |
| `dependsOn` | 显式依赖节点 ID 列表。 |
| `version` | 节点内容版本，用于识别节点变化。 |
| `source` | `demo`、`user` 或 `planner`。 |
| `method` | 可选方法；一个节点最多表示一种方法组合。 |
| `acceptance` | 可选测试、指标或评价验收；为空时执行提示词要求 Agent 自评。 |
| `customPrompt` | 旧客户端兼容字段；当前 UI 与执行链忽略它，结构化改写时会清除。 |
| `customPromptBaseVersion` | 旧客户端兼容字段；当前 UI 与执行链忽略它。 |

树关系只由 `parentId` 和 `childIds` 表示；显式依赖只由 `dependsOn` 表示。不要从数组位置推导额外业务依赖。

## 校验与审计

`validation` 包含：

- `valid: boolean`
- `issues: string[]`

`audit` 记录初始化、编辑、影响分析、重规划、校验、模拟执行、撤销和重置等领域事件。当前 UI 类型只消费审计记录的 `id` 与 `summary`，服务端保留完整字段。

## 状态文件

| 路径 | 用途 |
| --- | --- |
| `data/plantree-plan.example.json` | 可提交的初始示例。 |
| `data/plantree-plan.json` | Web 与 MCP 共用的运行时状态。已在 `.gitignore` 中忽略。 |
| `data/plantree-plan.json.tmp` | 原子写入临时文件；成功后重命名，失败时清理。 |

默认路径由 `DemoSession.getDefaultStorePath()` 根据编译后模块位置解析到插件根目录的 `data/plantree-plan.json`。

不要使用 `server/data/plantree-plan.json` 作为正式运行路径；维护时应以 `DemoSession` 的默认路径和插件根 `data/` 为准。

## 读取与写入

首次读取时，如果运行时状态不存在，服务端会写入 `initialDemoPlan`。读取时执行最低结构校验：

- 快照 ID 和根节点 ID 是字符串。
- 版本是非负整数。
- `nodes` 是对象且包含根节点。
- `validation` 是对象。
- `audit` 是数组。

JSON 无法解析或最低结构校验失败时返回“任务树状态文件无效。”，不会静默覆盖损坏文件。

写入流程：

1. 重新读取当前文件。
2. 比较当前 `version` 与调用方 `expectedVersion`。
3. 不一致时抛出版本冲突并携带最新快照。
4. 一致时写入 `.tmp`。
5. 使用重命名替换正式状态文件。
6. 失败时删除 `.tmp`。

## 版本语义

- 计划级 `version` 用于跨入口并发控制。
- 节点级 `version` 用于识别单节点内容变化。
- 撤销、重做和重置也生成新的计划版本，不回退版本号。
- 客户端不能自行修改版本或用旧快照直接覆盖服务端文件。

## 撤销与重做

`DemoSession` 在内存中维护 `undoStack`、`redoStack` 和 `historyHeadVersion`：

- 成功编辑或模拟执行把写入前快照推入撤销栈，并清空重做栈。
- 撤销把当前快照推入重做栈。
- 重做把当前快照推回撤销栈。
- 撤销后的新编辑清空重做栈。
- 重置清空两个历史栈。
- 服务进程重启后历史消失，但持久化任务树保留。
- 另一入口更新状态后，旧历史头不再匹配当前版本，撤销或重做返回版本冲突。

## 数据恢复原则

- 修复损坏文件前先停止 Web 和 MCP 服务，并备份原文件。
- 如果不需要保留运行数据，可以在明确确认后移走损坏的 `data/plantree-plan.json`，下次读取会创建初始演示计划。
- 不要编辑 `.tmp` 作为正式状态，也不要同时让多个人工编辑器写同一 JSON 文件。
