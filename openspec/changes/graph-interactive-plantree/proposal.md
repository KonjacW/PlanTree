## Why

当前 PlanTree 小窗以紧凑列表树呈现任务，已具备基础选择、框选和键盘导航，但难以直观看到父子层级与跨分支依赖，也无法高效浏览每个节点的规划提示词。现在需要在不扩大为全屏工作台、也不改变 MCP 与本地 Web 共享状态边界的前提下，升级为轻量、可操作的图形任务树。

## What Changes

- 使用 React Flow 作为 PlanTree MCP 小窗和本地 Web 的共用图形画布，替换现有列表树主视图。
- 将任务树 JSON 适配为图节点和两类边：父子关系实线、`dependsOn` 依赖虚线；保留现有服务端命令和版本冲突保护。
- 提供可折叠的节点提示词详情面板，展示基于节点目标、类型、状态、依赖和子节点生成的本地规划上下文；自动提示词保持纯函数派生，用户也可为节点保存独立的人工提示词覆盖、恢复自动生成并识别可能过期的覆盖内容。人工提示词仅写入本地任务树，不发送到外部服务。
- 支持鼠标在画布空白处拖拽框选、追加选择与清除选择；节点拖动仅改变当前客户端的视觉位置，不改变任务树顺序或结构。
- 增加轻量快捷键：`P` 提示词详情、`Enter` 模拟执行、`E` 展开、`Delete` 经确认后裁剪、`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Y` 重做、`Esc` 取消/关闭、`?` 帮助；明确不提供 `F` 聚焦快捷键。
- 更新小窗视觉层级、状态颜色、可访问焦点和窄宽度降级，使图形交互在 Codex PiP 与本地 Web 中保持一致。

## Capabilities

### New Capabilities
- `interactive-task-graph`: 将共享 PlanTree 快照映射为轻量、可选择的 React Flow 任务图，并表达父子与依赖关系。
- `node-prompt-inspection`: 为单个任务节点生成并展示本地规划提示词与相关上下文，并允许保存、编辑、恢复和检查人工提示词覆盖。
- `graph-selection-and-shortcuts`: 提供画布框选、多选、视觉位置拖动、键盘操作与确认保护。
- `graph-tree-integration`: 将图形浏览与现有任务树编辑命令、版本冲突保护、MCP 小窗和本地 Web 入口保持一致。

### Modified Capabilities

无。当前仓库尚未归档形成可修改的主规格；本变更以新增能力描述对既有原型实现的演进。

## Impact

- 修改 `plugins/plantree/ui` 的依赖、主组件、样式和组件测试；新增图模型、提示词生成、人工提示词编辑、快捷键与确认交互的前端模块。
- 扩展 `PlanNode`，增加可选的 `customPrompt` 与 `customPromptBaseVersion`；扩展现有 `edit_node` 以保存或清除人工提示词覆盖。
- 复用现有 `PlanSnapshot`、`edit_node`、`simulate_execution`、`undo_last_edit`、版本冲突与 HTTP/MCP 调用协议，并增加 `redo_last_edit` MCP 工具和 `/api/redo` HTTP 路由；所有写操作继续携带 `expectedVersion`。
- 服务端增加与现有撤销栈一致的会话级重做栈；撤销后的新变更和重置会清空重做历史，服务端重启后撤销与重做历史均清空。
- 不新增云端服务、数据库、外部 API、代理设置或第三方运行时依赖；节点拖动仍不持久化，自动及人工提示词均不发送到外部服务。
- 增加 `@xyflow/react`（MIT）作为前端运行时依赖；Graphviz/DOT 仅可作为后续导出或诊断方向，不作为本变更的运行时依赖。
