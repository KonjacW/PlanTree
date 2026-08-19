# 后端交接清单

## 接手环境

- [ ] 使用 Windows PowerShell。
- [ ] `node --version` 与 `npm --version` 可正常执行。
- [ ] 已在 `server/` 和 `ui/` 分别安装依赖。
- [ ] `Get-Command node` 可用，Codex 能通过 PATH 启动 `.mcp.json` 中的 `node`。
- [ ] 未将运行时 `data/plantree-plan.json` 当作示例文件提交或覆盖。

## 启动与入口

- [ ] 在插件根运行 `npm run web` 后，`4174` 和 `5174` 均由同一启动器进程监听。
- [ ] `GET http://127.0.0.1:4174/api/plan` 返回任务树。
- [ ] `http://127.0.0.1:5174` 显示图形任务树。
- [ ] 在启动终端按 `Ctrl+C` 后两个端口均释放。
- [ ] `server/npm run build` 生成 `server/dist/index.js` 和侧栏 UI 资源。
- [ ] Codex 能加载 MCP 数据工具，侧栏无需等待 Codex 回合。

## 核心语义确认

- [ ] 服务端是任务树语义和持久化的权威来源。
- [ ] 所有写操作都要求 `expectedVersion`。
- [ ] HTTP 冲突返回 `409` 和最新服务端快照。
- [ ] MCP 与 Web 共享状态文件，但不共享撤销/重做栈。
- [ ] `childIds` 决定树关系和顺序，`dependsOn` 表示显式依赖。
- [ ] 前端视觉拖动不调用 `move_node`，不改变业务顺序。
- [ ] UI 只编辑任务、方法和验收；图关系、状态和 ID 不进入可编辑正文。
- [ ] 执行提示词只由节点结构化内容派生；没有显式验收时要求 Agent 自评。

## 按改动范围选择回归

| 改动范围 | 最小检查 |
| --- | --- |
| 领域编辑、校验、规划、执行 | 对应领域测试 + 服务端 `npm test` |
| 持久化或版本冲突 | `persistent-plan-store`、会话、MCP、HTTP 协议测试 + 服务端 `npm test` |
| MCP 工具或输入参数 | MCP 注册测试、服务端测试、`npm run build`、Codex 数据工具人工调用 |
| HTTP 路由或响应 | Web API 测试、HTTP `ToolCaller` 测试、Web 冒烟 |
| 共享任务树类型 | 服务端测试、UI 测试、UI typecheck、旧示例 JSON 加载 |
| 图模型或提示词纯函数 | 对应 UI 测试、UI typecheck |
| React 交互 | `PlanTreeWindow` 测试、UI typecheck、Web 人工走查 |
| 侧栏提示文件交接 | UI `npm run build`、服务端 `npm run build`、剪贴板文件粘贴人工走查 |
| 仅文档或 EditorConfig | 静态链接/名称检查、服务端 `npm test`、UI typecheck、OpenSpec validate |

## 交付前集中验证

```powershell
npm --prefix plugins/plantree/server test
npm --prefix plugins/plantree/ui run typecheck
openspec validate graph-interactive-plantree --strict
```

功能变更或正式发布前再补完整 UI 测试、UI build 和 server build。

## 禁止突破的边界

- [ ] 不绕过 `PersistentPlanStore.write()` 直接覆盖运行时 JSON。
- [ ] 不删除或放宽 `expectedVersion` 检查。
- [ ] 不把 Web API 暴露到非回环地址，除非另立安全设计。
- [ ] 不将 UI 选择、面板状态、草稿或节点坐标写入任务树。
- [ ] 不把图形自由连线映射为未定义的服务端关系。
- [ ] 不新增 Graphviz、WASM、数据库、WebSocket、远程渲染或重型状态管理库。
- [ ] 不将 `move_node` 用于前端视觉拖动。
- [ ] 不在缺少真实侧栏点击和文件粘贴实测时宣称交接验收完成。

## 当前交付状态

- OpenSpec 变更：`graph-interactive-plantree`。
- 当前进度：`25/26`。
- 已完成：本地 Web 图形走查、UI/服务端自动化验证、类型检查、侧栏构建、OpenSpec strict validate、结构化节点内容编辑与重做能力。
- 唯一待完成：`5.4 在 Codex 中走查侧栏一次点击后自动进入完整剩余任务链。`

### 5.4 侧栏执行人工验收记录

- [ ] Codex MCP 服务成功加载。
- [ ] `render_plan_tree` 返回侧栏链接，不依赖 Codex 对话标识。
- [ ] 侧栏中节点、树边和显式依赖边正确显示。
- [ ] 侧栏中选择、查看/编辑任务、方法与验收、撤销和重做正常。
- [ ] 点击“复制执行文件”后生成 `plantree-prompt.md`。
- [ ] 剪贴板中是可粘贴的文件对象；粘贴到目标 Codex 对话后包含完整剩余任务链。
- [ ] 写操作继续携带版本，冲突时刷新到服务端快照。
- [ ] 验收后才在 `openspec/changes/graph-interactive-plantree/tasks.md` 勾选 5.4。

## 交付说明

- 本轮规范化不修改源码、MCP/HTTP 契约、任务树 JSON 或运行语义。
- 未新增 npm 依赖或文档工具。
- GitHub 交付仓库使用 `main` 分支；提交前确认运行数据、依赖和构建产物仍被忽略。
