---
name: plantree-workflow
description: 当用户需要从总目标生成、查看、编辑、裁剪或执行任务树时，使用 PlanTree 的本地 MCP 工具和交互 UI。适用于将线性计划转为人工确认后可自动执行的树状计划。
---

# PlanTree 工作流

当用户希望管理任务树或查看任务树计划状态时，使用 PlanTree MCP 工具。

## 工具顺序

1. 用户给出新总目标时，调用 `build_planner_prompt`，按照返回提示词生成严格 TaskTree JSON；不要执行任务。
2. 调用 `import_task_tree` 导入 JSON，再调用 `render_plan_tree`，让用户在 Codex 侧栏打开任务树。PlanTree 不提供内嵌任务树。
3. 用户通过 UI 或对话提出添加、改写、展开、排序或裁剪时，调用对应编辑工具；以最新快照为准。
4. `render_plan_tree` 会把计划绑定到发起调用的 Codex 对话。告知用户可在侧栏编辑并点击“开始自动执行”，随后可以结束当前回合；不要长轮询或要求用户回复口令。
5. 当 PlanTree 自动恢复本对话并给出带计划 ID、请求 ID 和快照版本的执行请求时，核对这些参数，跳过规划、导入和再次渲染，直接调用 `start_next_task(expectedVersion=snapshotVersion)`。
6. 循环调用 `start_next_task`，实际执行返回的 `task.prompt`；只有任务完成且验收通过后才能调用 `complete_task`。继续循环直到 `done=true`。
7. 任务失败、被阻塞、需要批准或验收未通过时，停止循环并保留 `in_progress` 状态，向用户说明。
8. 用户要求撤回最近一次成功编辑时调用 `undo_last_edit`；用户明确确认重置后调用 `reset_demo`。

## 响应约束

- 以 MCP 工具返回的最新结构化快照为准。
- `render_plan_tree` 自行管理回环地址上的本地服务；不要要求用户运行终端命令或复制本地 URL。
- 自动执行通过“侧栏 HTTP 请求 + 创建任务树时记录的 `threadId` + `codex exec resume`”启动；必须恢复原对话，不得创建无关的新对话。`wait_for_execution_request` 只为旧版本兼容，不作为正常流程。
- 侧栏链接无法打开时，继续基于数据工具的结构化结果说明树、有效性、影响范围和审计记录，并明确报告侧栏入口故障；没有收到执行请求时不得自行开始。
- 不得调用 `simulate_execution` 代替真实任务执行。
- 不得仅复述 `task.prompt` 后就标记完成；必须完成实际工作并进行验收。
- 不得执行 `skipped` 节点、越过当前节点或虚假调用 `complete_task`。
- 不得要求用户复制提示词、逐项粘贴、回复“执行计划”或手动确认每个节点完成；侧栏的一次点击必须在创建该任务树的 Codex 对话中启动新回合，并执行完整剩余队列。
