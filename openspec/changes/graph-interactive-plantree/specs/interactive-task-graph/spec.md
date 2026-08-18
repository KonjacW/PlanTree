## ADDED Requirements

### Requirement: 交互式任务图呈现
系统 MUST 将当前 `PlanSnapshot` 呈现为 React Flow 图形画布。每个未跳过节点 MUST 显示标题、状态和截断目标；父子关系 MUST 显示为从父节点到子节点的实线，`dependsOn` 关系 MUST 显示为从依赖节点到被依赖节点的虚线。节点的层级位置 MUST 由稳定的根向下布局根据 `childIds` 顺序生成。

#### Scenario: 同时查看层级与依赖
- **WHEN** 当前计划含有父子关系和跨节点依赖
- **THEN** 画布显示每个未跳过节点、父子实线和依赖虚线，且相同快照重复渲染得到相同节点顺序与位置

### Requirement: 图形画布轻量导航
系统 MUST 允许用户在画布内进行平移、缩放和适配视图，并在初始渲染时使根节点及其可见后代位于小窗可视区域内。系统 MUST 在窄小窗口中保持节点内容可读且不显示全屏工作台布局。

#### Scenario: 小窗初次显示任务图
- **WHEN** 用户在 Codex 侧栏打开任务树
- **THEN** 画布以适合可视区域的缩放显示根节点与可见分支，并保留可点击的缩放与帮助入口

### Requirement: 视觉节点位置不改变任务语义
系统 MUST 允许用户拖动图节点以调整当前 UI 会话内的视觉位置。节点拖动 MUST NOT 调用 `move_node`、MUST NOT 修改 `PlanSnapshot` 的 `childIds`、`parentId`、`dependsOn` 或版本号。

#### Scenario: 拖动节点阅读图形
- **WHEN** 用户拖动一个任务节点到画布的另一位置
- **THEN** 该节点在当前画布中使用新视觉位置，且服务端未收到变更任务树的调用
