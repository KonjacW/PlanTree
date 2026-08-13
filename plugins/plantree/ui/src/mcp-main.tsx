import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";

import { createAppToolCaller, PlanTreeWindow } from "./PlanTreeWindow";
import type { PlanSnapshot } from "./plan-types";

const root = createRoot(document.getElementById("root")!);
const app = new App({ name: "PlanTree", version: "0.1.0" }, {});

function snapshotFromResult(result: { structuredContent?: Record<string, unknown> }): PlanSnapshot | undefined {
  const snapshot = result.structuredContent?.snapshot;
  return snapshot && typeof snapshot === "object" && "rootNodeId" in snapshot && "nodes" in snapshot
    ? snapshot as PlanSnapshot
    : undefined;
}

app.ontoolresult = (result) => {
  const snapshot = snapshotFromResult(result);
  if (snapshot) root.render(<PlanTreeWindow plan={snapshot} toolCaller={createAppToolCaller(app)} />);
};

root.render(<main className="plantree-preview"><p>正在加载任务树</p></main>);
void app.connect().catch(() => root.render(<main className="plantree-preview"><p role="alert">无法连接 PlanTree MCP App</p></main>));
