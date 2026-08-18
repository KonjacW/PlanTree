const outputShape = `{
  "schemaVersion": "1.0",
  "treeId": "tree-...",
  "rootId": "n1",
  "nodes": [
    {
      "id": "n1",
      "task": "单一且明确的任务",
      "method": "可选：完成该任务采用的唯一方法",
      "acceptance": [
        {
          "type": "test | metric | evaluation",
          "criterion": "用户明确给出的验收要求"
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "父节点 ID",
      "target": "子节点 ID",
      "order": 0
    }
  ]
}`;

export function buildPlannerPrompt(userTask: string): string {
  const task = userTask.trim();
  if (!task) throw new Error("用户总目标不能为空。");
  return `你是 PlanTree 规划器。只规划任务树，不执行任务，不修改文件。

根据用户任务生成一棵有向任务树，并严格输出 JSON。

<user_task>
${task}
</user_task>

规划规则：
1. 每个节点只表达一个任务；不要在 task 中添加“仅完成”，执行阶段会自动添加。
2. method 是可选字段。一个节点最多包含一种方法；若要用多种方法尝试同一任务，拆成多个子节点。
3. acceptance 是可选字段，只保留用户明确提出的测试、指标或工作评价。不得虚构测试命令、数值阈值或评价要求；没有时省略该字段。
4. 有子节点的节点用于分解任务；没有子节点的节点必须可以独立执行。需要汇总或比较时，创建一个单独的叶节点。
5. edges 只表达父子关系，方向为父节点 source 指向子节点 target。同一父节点下从 order=0 连续编号。
6. 必须只有一个 rootId；除根节点外，每个节点恰好有一个父节点；不得出现环、孤立节点或不存在的引用。
7. 保持计划精简：通常生成 3–12 个节点，最多 4 层，不创建仅仅复述父任务的节点。

输出结构：
${outputShape}

只输出一个合法 JSON 对象，不要使用 Markdown 代码块，不要添加解释。`;
}
