import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DemoSession } from "../src/application/demo-session.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { PLANTREE_RUNTIME_VERSION } from "../src/runtime-version.js";
import { closePlanTreeSidebarForTests, ensurePlanTreeSidebar } from "../src/sidebar-runtime.js";

describe("PlanTree sidebar runtime", () => {
  let staleServer: Server | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await closePlanTreeSidebarForTests();
    if (staleServer?.listening) {
      staleServer.close();
      await once(staleServer, "close");
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("旧版本占用首选端口时在空闲端口启动当前侧栏", async () => {
    staleServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "plantree" }));
    });
    staleServer.listen(0, "127.0.0.1");
    await once(staleServer, "listening");
    const staleAddress = staleServer.address() as AddressInfo;

    directory = await mkdtemp(join(tmpdir(), "plantree-sidebar-runtime-"));
    const url = await ensurePlanTreeSidebar(
      new DemoSession(new PersistentPlanStore(join(directory, "plan.json"))),
      undefined,
      staleAddress.port,
    );

    expect(url).not.toBe(`http://127.0.0.1:${staleAddress.port}`);
    await expect(fetch(`${url}/api/health`).then((response) => response.json())).resolves.toEqual({
      service: "plantree",
      version: PLANTREE_RUNTIME_VERSION,
    });
  });
});
