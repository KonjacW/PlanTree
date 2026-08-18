import { createRoot } from "react-dom/client";

import { PlanTreeWindow } from "./PlanTreeWindow";
import { createHttpMessageSender, createHttpToolCaller } from "./http-tool-caller";

type SnapshotResponse = { snapshot: Parameters<typeof PlanTreeWindow>[0]["plan"] };

async function bootstrap(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  root.render(<p>正在加载任务树</p>);

  try {
    const response = await fetch("/api/plan");
    if (!response.ok) throw new Error("无法读取计划。");
    const { snapshot } = await response.json() as SnapshotResponse;
    root.render(<PlanTreeWindow plan={snapshot} toolCaller={createHttpToolCaller("")} messageSender={createHttpMessageSender("")} webMode />);
  } catch {
    root.render(<p role="alert">无法连接本地 PlanTree 服务</p>);
  }
}

void bootstrap();
