## ADDED Requirements

### Requirement: 图形 UI 保持现有状态协议
图形 UI MUST 继续使用既有 `ToolCaller` 与 MCP/HTTP 协议进行服务端变更。`edit_node`、`simulate_execution`、`undo_last_edit`、`redo_last_edit` 和多选裁剪中的每次变更 MUST 携带当前快照的 `expectedVersion`。节点任务、方法和验收的保存 MUST 复用 `edit_node` 的 `rewrite` 操作。图形 UI MUST 在成功响应后使用服务端快照刷新，而不是本地推测业务状态。

#### Scenario: 图形界面展开节点
- **WHEN** 用户从图形节点操作或按下 `E` 请求展开单节点
- **THEN** 系统以当前版本调用现有 `edit_node` 工具，并用其返回快照重新生成任务图

#### Scenario: 图形界面保存节点内容
- **WHEN** 用户保存节点的任务、方法或验收
- **THEN** 系统以当前版本调用 `edit_node rewrite`，并用服务端返回快照刷新节点内容与任务图状态

### Requirement: 图形 UI 处理共享状态冲突
系统 MUST 将 HTTP 或 MCP 返回的版本冲突视为不成功的变更，并以冲突响应携带的最新快照刷新图形。系统 MUST 保留新快照中仍存在节点的选择和视觉位置，移除已不存在节点的本地选择、位置和节点内容详情。

#### Scenario: 另一入口先更新任务树
- **WHEN** 用户在图形界面提交过期版本的变更
- **THEN** 系统显示“任务树已被其他入口更新，请刷新后重试。”并以服务端最新快照替换当前任务图

### Requirement: 侧栏图形与提示文件交接
系统 MUST 只在本地侧栏 Web 显示图形任务树，不注册内嵌任务树资源。节点内容、撤销与重做结果 MUST 通过服务端快照保持一致。侧栏点击复制 MUST 校验计划 ID 和快照版本，生成包含完整剩余执行链的 `plantree-prompt.md`，并把该文件对象写入系统剪贴板。系统 MUST NOT 传输 Codex 对话标识或唤醒对话。

#### Scenario: 侧栏一次点击复制完整执行提示
- **WHEN** 用户在已确认的侧栏任务树点击“复制执行文件”
- **THEN** 系统剪贴板包含 `plantree-prompt.md` 文件对象，文件记录完整剩余执行链，用户只需在目标 Codex 对话粘贴并发送

### Requirement: 服务端线性撤销重做历史
系统 MUST 提供会话级撤销栈与重做栈。撤销 MUST 将当前快照加入重做栈后恢复最近一次变更前的快照；重做 MUST 将当前快照加入撤销栈后恢复最近一次被撤销的快照。撤销后的任意新编辑或模拟执行 MUST 清空重做栈；重置 MUST 同时清空撤销与重做栈。服务端重启后两个栈均可清空。

#### Scenario: 撤销后产生新分支
- **WHEN** 用户撤销一次变更后执行新的计划变更
- **THEN** 系统保存新变更并清空重做栈，后续重做请求返回没有可重做编辑

### Requirement: 重做协议与冲突保护
系统 MUST 注册 `redo_last_edit` MCP 工具，并提供 `/api/redo` HTTP 路由。两个入口 MUST 接收 `expectedVersion`，成功时返回权威服务端快照，版本冲突时 MUST 返回服务端最新快照并沿用现有冲突恢复机制。

#### Scenario: 过期入口请求重做
- **WHEN** 一个入口以过期版本请求 `redo_last_edit`
- **THEN** 系统拒绝重做并返回服务端最新快照，图形 UI 刷新后提示用户重试
