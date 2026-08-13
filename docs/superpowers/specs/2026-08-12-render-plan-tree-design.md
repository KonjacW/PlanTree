# render_plan_tree 资源设计

## 目标

将 PlanTree 任务树作为 Codex 会话内的 MCP App 小窗呈现。该设计不启动独立浏览器、桌面窗口或本地网页服务；计划状态仍只保存在本地 stdio MCP 服务的内存会话中。

## 资源与工具边界

- 固定 UI 资源 URI：`ui://plantree/plan-tree.html`。
- 资源 MIME 类型：`text/html;profile=mcp-app`。
- 只有 `render_plan_tree` 在工具定义的 `_meta["ui/resourceUri"]` 中声明该 URI。
- `create_or_load_demo`、`edit_node`、`simulate_execution`、`undo_last_edit`、`reset_demo` 不含 UI 资源元数据；它们在 UI 不可用时仍可独立工作。
- `.app.json` 只描述插件打包的小窗资源及其最小权限。它不保存计划，也不替代 MCP 服务的资源注册。

## 调用与数据流

1. 调用者先使用任一数据工具取得权威快照，或直接调用 `render_plan_tree`。
2. `render_plan_tree` 接受可选 `snapshot`；未提供时读取当前会话快照。若提供，则仅把该快照用于本次呈现，不写回会话。
3. 工具返回文本摘要与 `{ summary, snapshot }` 结构化内容，并以 `ui/resourceUri` 关联固定资源。
4. Codex 宿主读取同一 URI 后在沙箱 iframe 的 PiP 模式中展示小窗。
5. 小窗将鼠标操作或未来的已聚焦快捷键映射为同一命令入口，经 MCP Apps bridge 调用数据工具。每个工具结果中的服务端快照刷新界面。

## 状态与错误处理

- MCP 服务是计划、版本、撤销栈和审计日志的唯一权威来源。
- UI 仅保存选中节点、展开状态和未提交表单草稿。
- 无效编辑或不可执行节点由现有数据工具返回明确的错误或阻断摘要；小窗不在本地推测或修改计划。
- 若宿主不支持 MCP App，数据工具与 `render_plan_tree` 的结构化结果仍可被 Codex 用于继续任务流程。

## 安全边界

- 初始资源不请求网络连接、外部静态资源、嵌套 iframe、摄像头、麦克风、地理位置或剪贴板权限。
- 第 5.4 项将把上述空权限和内容安全策略写入资源声明，并进行“不打开外部浏览器”的验证。

## 验收标准

- 工具列表中仅 `render_plan_tree` 带 `_meta["ui/resourceUri"]`。
- `render_plan_tree` 返回的结构化快照满足与数据工具相同的 `{ summary, snapshot }` 契约。
- 数据工具无论是否存在 UI 宿主都不携带 UI 元数据。
- MCP 集成测试使用内存传输完成，不发起网络或文件系统副作用。
