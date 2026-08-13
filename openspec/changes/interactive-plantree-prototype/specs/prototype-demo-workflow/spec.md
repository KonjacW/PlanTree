## ADDED Requirements

### Requirement: 缺陷修复演示任务
插件 MUST 内置一个虚构但具体的软件缺陷修复任务，其根目标、调查、修复、测试、验证和提交说明均使用稳定的演示数据。演示数据 MUST 不包含真实仓库、用户凭据、网络链接或可执行脚本。

#### Scenario: 初次进入演示
- **WHEN** 用户在 Codex 中调用 PlanTree 插件的演示工具
- **THEN** MCP 服务加载预置缺陷修复任务，并返回可开始编辑的初始树、有效性状态与初始化日志

### Requirement: 可复位演示会话
系统 MUST 提供重置演示操作，将内存中的计划、执行状态和审计日志恢复为预置初始状态。重置 MUST 在用户确认后执行，且不会访问或删除本地项目文件。

#### Scenario: 重置编辑后的演示
- **WHEN** 用户确认重置一个包含编辑和模拟执行记录的演示会话
- **THEN** 系统恢复初始任务树、清空会话内编辑历史，并生成新的初始化日志

### Requirement: Codex 插件小窗呈现
插件 MUST 声明一个 MCP App UI 资源，并仅由专用渲染工具返回该资源。该资源 MUST 在 Codex 会话内以 Picture-in-Picture 小窗呈现任务树、节点详情、有效性、影响范围、模拟执行状态和审计日志；它 MUST NOT 打开独立浏览器窗口。

#### Scenario: 渲染交互式任务树小窗
- **WHEN** Codex 调用渲染工具并传入当前计划快照
- **THEN** 工具返回结构化计划数据及关联 UI 资源，使 Codex 在会话内显示 PlanTree 小窗

### Requirement: MCP 工具降级行为
插件 MUST 提供创建或加载会话、提交编辑、模拟执行、撤销、重置和渲染计划的 MCP 工具。除渲染工具外，工具 MUST 在 UI 无法呈现时仍返回完整的结构化结果和人类可读摘要。

#### Scenario: 无 UI 的编辑
- **WHEN** Codex 调用节点改写工具但客户端未呈现小窗
- **THEN** MCP 服务完成编辑、局部重规划、验证与审计，并返回更新后的计划快照和重规划摘要

### Requirement: 本地运行边界
插件的 MCP 服务和小窗组件 MUST 在本地 Codex 环境中完成第一阶段演示交互。第一阶段 MUST NOT 调用真实 LLM、SWE-bench、GitHub API、云端数据库、容器、终端命令或真实代码执行环境。

#### Scenario: 演示中的重规划
- **WHEN** 用户通过 Codex 小窗或 MCP 工具编辑节点并触发重规划
- **THEN** MCP 服务仅使用内置模拟规则完成操作，且不产生任何外部请求
