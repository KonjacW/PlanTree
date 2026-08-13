# Codexzh 环境下 MCP 工具未暴露调试记录

## 目的

记录 Plantree 本地 MCP 服务在 Codex Desktop / CLI 中未进入任务可调用工具列表的问题，供 `codexzh` 技术支持或代理实现维护者复现与排查。

本文不要求切换模型提供商，也不包含 API Key、访问令牌或其他敏感信息。

## 运行环境

| 项目 | 当前值 |
| --- | --- |
| 操作系统 | Windows 11 |
| 工作区 | `D:\Project\Cambridge\PlanTree` |
| 模型提供商 | `codexzh` |
| 接口类型 | Responses API 兼容模式 |
| MCP 传输 | 本地 stdio |
| Node.js | `D:\software\Node.js\node.exe`，v24.17.0 |
| MCP SDK | `@modelcontextprotocol/sdk` 1.30.0 |

相关的 Codex 配置保留如下结构：

```toml
model_provider = "codexzh"

[model_providers.codexzh]
base_url = "https://api.codexzh.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

## 预期行为

Codex 成功连接 MCP 服务器后，应将 `tools/list` 返回的工具注入新任务的工具面。对于 Plantree，任务中应存在以下可调用工具：

```text
mcp__plantree__create_or_load_demo
mcp__plantree__edit_node
mcp__plantree__simulate_execution
mcp__plantree__undo_last_edit
mcp__plantree__reset_demo
mcp__plantree__render_plan_tree
```

## 实际行为

1. `codex mcp list` 和 `codex mcp get plantree` 均显示服务器已启用。
2. 单独使用标准 MCP 客户端连接服务时，`initialize` 和 `tools/list` 均成功。
3. 使用当前 `codexzh` 提供商创建真实 Codex CLI / Desktop 任务时，任务可调用工具列表中没有任何 Plantree 工具。
4. CLI 输出会在任务结束时出现以下警告：

```text
MCP startup failed: handshaking with MCP server failed:
connection closed: initialize response
```

此时任务仍能看到插件的工作说明（skill），但不能调用 MCP 工具。这说明“插件/技能发现”与“MCP 工具挂载”发生了分离。

## 已验证的服务端行为

Plantree 服务使用预编译 JavaScript 启动，避免 `tsx` 即时编译造成的启动延迟：

```json
{
  "mcpServers": {
    "plantree": {
      "command": "D:\\software\\Node.js\\node.exe",
      "args": ["${PLUGIN_ROOT}/server/dist/index.js"]
    }
  }
}
```

向服务写入标准 `initialize` 报文，可获得合法响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "codex", "version": "0.1.0" }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "resources": { "listChanged": true },
      "tools": { "listChanged": true }
    },
    "serverInfo": { "name": "plantree-mcp", "version": "0.1.0" }
  }
}
```

同一服务对 `2025-06-18`、`2025-03-26` 也可完成协议协商。预编译入口收到初始化请求的实测响应时间约为 `0.56` 秒。

## 已执行的排查与结果

| 检查项 | 结果 | 结论 |
| --- | --- | --- |
| 插件市场安装、启用状态 | 正常 | 不是插件未启用 |
| 源码与插件缓存一致性 | 已重新安装后同步 | 不是缓存未刷新 |
| Node 路径 | 已固定为绝对路径 | 不是 PATH 解析问题 |
| stdio 服务持续运行 | 正常 | 不是进程提前退出 |
| 原始 `initialize` | 正常 | 不是 MCP 协议版本不兼容 |
| SDK 客户端 `tools/list` | 返回全部 6 个工具 | 不是 Plantree 未声明工具 |
| TypeScript 即时启动 | 已替换为预编译入口 | 不是编译启动延迟 |
| 独立全局 MCP 直连 | 任务仍未暴露工具 | 不是插件桥接层问题 |
| `startup_timeout_sec = 30` | 仍未暴露工具 | 不是默认启动超时过短 |

Plantree 项目内的构建与测试结果：

```text
npm run build          # 成功
npm test               # 10 个测试文件、32 个测试全部通过
```

## 最小复现步骤

在保持 `model_provider = "codexzh"` 的前提下执行：

```powershell
codex mcp add plantree-stdio-test -- `
  D:\software\Node.js\node.exe `
  D:\Project\Cambridge\PlanTree\plugins\plantree\server\dist\index.js

codex mcp get plantree-stdio-test

codex exec --json --ephemeral --skip-git-repo-check `
  -C D:\Project\Cambridge\PlanTree `
  "请只列出所有以 mcp__plantree-stdio-test__ 开头的可调用工具名称。不要执行命令、不要读写文件。"
```

预期：输出 Plantree 的 MCP 工具名。

实际：代理回复当前没有该前缀的可调用工具；会话结束时出现前述 MCP 初始化失败警告。

测试结束后可清理：

```powershell
codex mcp remove plantree-stdio-test
```

## 请 codexzh 核查的事项

请确认 `codexzh` 的 Responses 兼容层是否完整支持 Codex 的以下能力，而不仅是普通文本和固定 function calling：

1. MCP 服务器的动态工具定义进入 Responses 请求的工具清单。
2. 线程/任务级动态工具或延迟工具（deferred tools）的注册与透传。
3. MCP `tools/list` 发现结果到模型请求工具面的映射。
4. Codex Desktop 与 `codex exec` 通过自定义 `model_provider` 运行时，是否会过滤、截断或拒绝 MCP 工具定义。
5. 对含 UI 元数据的 MCP 工具（例如 `_meta.ui.resourceUri`）是否存在额外过滤；即使存在，也不应影响其余无 UI 工具暴露。
6. 在 MCP 连接由 Codex 本地客户端建立、工具定义再通过 Responses API 发给模型的场景中，代理是否支持完整的请求字段和响应事件流。

建议在服务商侧记录同一次 Codex 任务的原始 Responses 请求（脱敏后），检查其中是否包含 `mcp__plantree-stdio-test__...` 的工具定义：

- **请求中不存在工具定义**：问题位于 Codex 本地客户端 / Desktop 的 MCP 挂载与索引层。
- **请求中存在工具定义，但模型侧不可调用或响应报错**：问题位于 `codexzh` 的 Responses 兼容、工具调用事件或流式响应转发层。

## 相关公开问题

- [CodexPlusPlus #1346](https://github.com/BigPizzaV3/CodexPlusPlus/issues/1346)：MCP 进程和配置正常，但工具未暴露给 Agent。
- [openai/codex #19425](https://github.com/openai/codex/issues/19425)：自定义 stdio MCP 已成功完成 `tools/list`，但工具未注入 Desktop 线程工具面。
- [openai/codex #30922](https://github.com/openai/codex/issues/30922)：Desktop 能读取 MCP 资源，却未暴露 MCP 工具。
- [openai/codex #36685](https://github.com/openai/codex/issues/36685)：`initialize response` 前连接关闭的同类启动报错。

## 当前判断

根据现有验证，Plantree 服务、Node 运行时、stdio 通信、协议协商、工具声明、插件缓存、启动时间和直连配置均已排除为主要原因。

当前最可能的故障边界是：Codex 在 `codexzh` 提供商模式下，未将 MCP 发现到的工具注册进任务的模型可调用工具面，或该工具面未被完整透传到兼容的 Responses API 请求中。
