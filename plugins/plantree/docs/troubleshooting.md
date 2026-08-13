# 故障排查

## `4174` 或 `5174` 已被占用

**现象**：`npm run web` 启动失败，提示端口占用。

**常见原因**：旧 PlanTree 实例仍在运行。Vite 配置为固定 `5174`，不会静默切换端口。

**检查**：

```powershell
Get-NetTCPConnection -LocalPort 4174,5174 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

使用返回的 PID 核对命令行：

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" |
  Select-Object ProcessId,ParentProcessId,CommandLine
```

**处理**：优先回到旧实例终端按 `Ctrl+C`。只有确认 PID 的命令行属于 `scripts/start-web.mjs` 后，才考虑停止该明确进程。

## 关闭终端后服务仍存在

**现象**：终端看似关闭，但端口仍被占用。

**原因**：终端或外部执行器可能强制结束包装 shell，而没有传递正常的中断信号。

**处理**：按上一节核对监听 PID 和完整命令行，只停止已确认的 PlanTree 启动器进程。日常停止统一使用启动终端中的 `Ctrl+C`。

## 页面显示“编辑参数不完整”

**现象**：新 UI 可以打开，但保存人工提示词等新操作返回旧参数错误。

**原因**：页面连接到旧 `server/dist` 或旧 API 进程。

**处理**：

1. 停止所有已确认的 PlanTree Web 实例。
2. 从插件根重新运行统一启动器：

```powershell
npm --prefix plugins/plantree run web
```

统一启动器会先重新编译服务端。不要另开终端执行 `npm run web:server`。

## `server/dist/index.js` 不存在

**现象**：Codex MCP 无法启动，或测试提示发布入口不存在。

**处理**：

```powershell
npm --prefix plugins/plantree/server run build
```

确认构建完成后再重载 Codex 插件。不要手工创建空的 `dist/index.js`。

## “任务树状态文件无效”

**现象**：读取计划返回状态文件无效。

**原因**：`data/plantree-plan.json` 不是合法 JSON，或缺少最低快照结构。

**处理**：

1. 停止 Web 和 MCP 服务。
2. 备份 `plugins/plantree/data/plantree-plan.json`。
3. 检查 JSON 语法以及 `id`、`version`、`rootNodeId`、`nodes`、`validation`、`audit`。
4. 如果确认不需要保留当前数据，将损坏文件移动到明确备份位置；下一次读取会创建演示计划。

不要用 `plantree-plan.example.json` 自动覆盖尚未备份的运行数据。

## HTTP `409` 或 MCP 版本冲突

**现象**：提示“任务树已被其他入口更新，请刷新后重试。”。

**原因**：请求的 `expectedVersion` 已过期，通常是 Web 与 MCP 中另一入口先完成了写入。

**处理**：使用错误结果携带的最新服务端快照刷新当前界面，再由用户决定是否重新执行操作。不要修改请求版本后盲目重发旧内容。

## 没有可撤销或重做的编辑

**现象**：撤销或重做返回相应历史为空。

**原因**：

- 服务刚重启，内存历史已清空。
- 重置清空了历史。
- 撤销后发生了新编辑，重做栈已清空。
- 当前入口没有产生相应历史；另一入口的历史不会共享。

这是当前会话级设计，不是数据丢失。任务树本身仍在状态文件中。

## Web 正常但 Codex PiP 不显示

**检查顺序**：

1. 运行 `server/npm run build`，确认 MCP UI 和 `server/dist/index.js` 均生成。
2. 在 PowerShell 中执行 `Get-Command node`，确认 Node.js 已加入 PATH；完全重启 Codex 以重新读取环境变量。
3. 核对 Codex 加载的是当前插件目录，而不是旧缓存版本。
4. 通过数据工具读取或编辑任务树，确认 MCP stdio 服务本身是否正常。
5. 重新调用 `render_plan_tree`。

PiP 是否渲染取决于 Codex 宿主能力。宿主不显示小窗时，不能据此认定服务端数据工具失败。

## 构建出现 `use client` ignored 警告

Vite 构建 `@xyflow/react` 时可能报告模块级 `"use client"` 指令被忽略。当前 Web 与 MCP 构建均能成功，该信息属于已知上游打包警告。

只有当构建退出码非零、产物缺失或页面运行失败时，才将其视为阻塞；不要通过复制或修改第三方包源码消除警告。

## 排障后最小回归

```powershell
npm --prefix plugins/plantree/server test
npm --prefix plugins/plantree/ui run typecheck
```

若排障涉及 OpenSpec 行为，再运行 strict validate。
