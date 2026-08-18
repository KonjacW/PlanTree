import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DemoSession } from "../src/application/demo-session.js";
import { CodexConversationBridge } from "../src/application/codex-conversation-bridge.js";
import { ConversationBindingStore } from "../src/application/conversation-binding-store.js";
import { ExecutionRequestStore } from "../src/application/execution-request-store.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";
import { createWebApi } from "../src/web-api.js";

describe("侧栏一次点击执行", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("从 HTTP 执行请求贯穿到原 Codex 对话的新回合", async () => {
    directory = await mkdtemp(join(tmpdir(), "plantree-sidebar-execution-"));
    const session = new DemoSession(new PersistentPlanStore(join(directory, "plan.json")));
    const requests = new ExecutionRequestStore(join(directory, "execution-request.json"));
    const bindings = new ConversationBindingStore(join(directory, "binding.json"));
    const threadId = "019ff54b-adcb-7982-880f-15db0ce32449";
    const launches: readonly string[][] = [];
    const mutableLaunches = launches as string[][];
    const bridge = new CodexConversationBridge(async () => "codex-test", async (_command, args) => { mutableLaunches.push([...args]); });

    const initial = await session.read();
    await session.importTaskTree({
      schemaVersion: "1.0",
      treeId: "sidebar-execution-test",
      rootId: "root",
      nodes: [
        { id: "root", task: "验证侧栏执行交接" },
        { id: "first", task: "领取第一项" },
        { id: "second", task: "领取第二项" },
      ],
      edges: [
        { id: "e1", source: "root", target: "first", order: 0 },
        { id: "e2", source: "root", target: "second", order: 1 },
      ],
    }, initial.snapshot.version);
    const before = await session.compileExecutionChain();
    await bindings.bind(before.snapshot.id, threadId, directory);
    const api = createWebApi(session, requests, bindings, bridge);
    server = createServer((request, response) => void api.handle(request, response));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const firstRemaining = before.chain.tasks.find((task) => task.status !== "completed");
    expect(firstRemaining).toBeDefined();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/execution/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: before.snapshot.id, snapshotVersion: before.snapshot.version }),
    });
    expect(response.status).toBe(200);

    const request = await requests.waitAfter(0, 1);
    expect(request).toMatchObject({ planId: before.snapshot.id, snapshotVersion: before.snapshot.version });
    expect(launches).toHaveLength(1);
    expect(launches[0]).toEqual(expect.arrayContaining(["resume", threadId, expect.stringContaining(`expectedVersion=${request!.snapshotVersion}`)]));
  });
});
