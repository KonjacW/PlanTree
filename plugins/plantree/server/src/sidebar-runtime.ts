import type { Server } from "node:http";

import type { DemoSession } from "./application/demo-session.js";
import type { CodexConversationBridge } from "./application/codex-conversation-bridge.js";
import type { ConversationBindingStore } from "./application/conversation-binding-store.js";
import type { ExecutionRequestStore } from "./application/execution-request-store.js";
import { PLANTREE_RUNTIME_VERSION } from "./runtime-version.js";
import { startWebServer } from "./web-server.js";

export const PLAN_TREE_SIDEBAR_URL = "http://127.0.0.1:5174";

let sidebarServer: Server | undefined;
let sidebarUrl: string | undefined;

export async function ensurePlanTreeSidebar(session: DemoSession, requestStore: ExecutionRequestStore, bindingStore: ConversationBindingStore, bridge: CodexConversationBridge, preferredPort = 5174): Promise<string> {
  const preferredUrl = `http://127.0.0.1:${preferredPort}`;
  if (sidebarUrl && await isHealthy(sidebarUrl)) return sidebarUrl;
  if (await isHealthy(preferredUrl)) {
    sidebarUrl = preferredUrl;
    return sidebarUrl;
  }
  try {
    const instance = await startWebServer(preferredPort, session, requestStore, bindingStore, bridge);
    sidebarServer = instance.server;
    sidebarUrl = instance.url;
    return sidebarUrl;
  } catch (error) {
    if (await isHealthy(preferredUrl)) {
      sidebarUrl = preferredUrl;
      return sidebarUrl;
    }
    if (!isAddressInUse(error)) throw error;

    // An older PlanTree process may still own 5174 after a plugin update. Do
    // not reuse it and do not kill it; serve the current build on a free port.
    const instance = await startWebServer(0, session, requestStore, bindingStore, bridge);
    sidebarServer = instance.server;
    sidebarUrl = instance.url;
    return sidebarUrl;
  }
}

export async function closePlanTreeSidebarForTests(): Promise<void> {
  const server = sidebarServer;
  sidebarServer = undefined;
  sidebarUrl = undefined;
  if (!server) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const body = await response.json() as { service?: string; version?: string };
    return body.service === "plantree" && body.version === PLANTREE_RUNTIME_VERSION;
  } catch {
    return false;
  }
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}
