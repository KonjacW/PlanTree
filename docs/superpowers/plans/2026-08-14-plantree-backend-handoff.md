# PlanTree Backend Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 PlanTree Node.js + TypeScript 项目整理为可由 Windows 本地后端开发者直接接手维护的完整工程交付物。

**Architecture:** 保持现有源码、协议和运行时行为不变，以 `plugins/plantree/README.md` 为入口，在 `plugins/plantree/docs/` 建立按职责拆分的维护文档。增加无依赖的 `.editorconfig`，使用源码、测试和 OpenSpec 作为事实来源，并通过集中监测点验证交付结果。

**Tech Stack:** Markdown、EditorConfig、Node.js、TypeScript、React、Vite、Vitest、OpenSpec、Windows PowerShell。

## Global Constraints

- 不修改 MCP 工具名、HTTP 路由、任务树 JSON 结构或版本冲突规则。
- 不改变任务图布局、提示词、快捷键或其他 UI 行为。
- 不新增运行依赖、开发依赖、文档生成器或部署工具。
- 运行环境限定为 Windows 本地与 Codex 插件。
- 保留 `plugins/plantree/data/plantree-plan.json`、锁文件、示例数据和正式构建产物。
- OpenSpec `graph-interactive-plantree` 的 5.4 保持未完成，直至用户人工验收。
- 项目无 Git 元数据，不创建 commit 或初始化仓库。

---

### Task 1: 轻量工程规范与入口文档

**Files:**
- Create: `.editorconfig`
- Modify: `plugins/plantree/README.md`
- Inspect: `plugins/plantree/.gitignore`

**Interfaces:**
- Consumes: 当前 `package.json` 脚本、`.mcp.json`、`.codex-plugin/plugin.json` 和启动器行为。
- Produces: 后端接手者的统一文档入口和无依赖文本格式约定。

- [ ] **Step 1: 增加轻量 EditorConfig**

创建 UTF-8、LF、末尾换行、行末空格和两空格缩进约定；Markdown 保留有意义的行末空格。

- [ ] **Step 2: 收敛 README**

保留项目简介、五分钟启动、Web/API/MCP 入口、常用验证命令、安全边界和专题文档导航；将长篇原理移入专题文档。

- [ ] **Step 3: 复核忽略规则**

确认 `.gitignore` 继续忽略 `node_modules/`、`dist/`、运行时计划、临时计划和日志，不忽略示例计划或锁文件。

### Task 2: 架构、接口与数据契约文档

**Files:**
- Create: `plugins/plantree/docs/architecture.md`
- Create: `plugins/plantree/docs/api-contracts.md`
- Create: `plugins/plantree/docs/data-and-persistence.md`

**Interfaces:**
- Consumes: `server/src/domain/**`、`server/src/application/**`、`server/src/server.ts`、`server/src/web-api.ts`、`ui/src/plan-types.ts`。
- Produces: 现有分层、双入口数据流、MCP/HTTP 契约和持久化语义的事实说明。

- [ ] **Step 1: 编写架构说明**

记录领域层、应用层、持久化层、MCP/HTTP 适配层和 UI 共享层职责，并说明共享文件与独立会话历史。

- [ ] **Step 2: 编写接口契约**

逐项记录 8 个 MCP 工具、HTTP 路由、编辑操作、成功响应、参数错误、404、409 和 `expectedVersion` 规则。

- [ ] **Step 3: 编写数据与持久化说明**

记录快照、节点、校验和审计字段，说明树顺序、显式依赖、人工提示词、原子写入、版本增长及撤销/重做生命周期。

### Task 3: 开发、排障与交接清单

**Files:**
- Create: `plugins/plantree/docs/development.md`
- Create: `plugins/plantree/docs/troubleshooting.md`
- Create: `plugins/plantree/docs/handoff-checklist.md`

**Interfaces:**
- Consumes: 根/UI/server `package.json` 脚本、启动器、测试配置、OpenSpec 当前状态。
- Produces: Windows 本地开发流程、问题处置步骤和正式交接验收矩阵。

- [ ] **Step 1: 编写开发与验证指南**

提供安装、统一 Web 启动、MCP 构建、定向验证、完整验证和产物目录说明。

- [ ] **Step 2: 编写故障排查指南**

按“现象—原因—检查—处理”说明端口、旧进程、旧构建、状态文件、冲突、历史和 PiP 问题。

- [ ] **Step 3: 编写交接清单**

包含环境检查、功能入口、改动范围回归矩阵、架构禁区、OpenSpec `25/26` 和 5.4 人工验收说明。

### Task 4: 集中验证与目录收口

**Files:**
- Verify: `.editorconfig`
- Verify: `plugins/plantree/README.md`
- Verify: `plugins/plantree/docs/*.md`
- Verify: `plugins/plantree/data/plantree-plan.json`

**Interfaces:**
- Consumes: Tasks 1–3 的全部交付物。
- Produces: 可复查的文档链接、命令、测试和规范状态证据。

- [ ] **Step 1: 静态文档检查**

使用 `rg` 检查占位符、文档链接目标、MCP 工具名、HTTP 路由和关键路径；确认无新增依赖差异和临时文件。

- [ ] **Step 2: 执行集中测试**

运行 `npm test`（服务端，包含 MCP UI 构建和服务端构建前置步骤）、`npm run typecheck`（UI）以及 `openspec validate graph-interactive-plantree --strict`。

- [ ] **Step 3: 核对交付状态**

确认任务树运行数据存在且未被文档整理覆盖，OpenSpec 保持 `25/26`，5.4 未误标完成，项目没有新增临时文件。
