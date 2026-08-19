import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DemoSession } from "./application/demo-session.js";
import { PromptFileClipboard } from "./application/prompt-file-clipboard.js";
import { createWebApi } from "./web-api.js";

export type WebServerInstance = { server: Server; url: string };

export async function startWebServer(port = 4174, session = new DemoSession(), promptClipboard = new PromptFileClipboard()): Promise<WebServerInstance> {
  const api = createWebApi(session, promptClipboard);
  const uiDirectory = fileURLToPath(new URL("../../ui/dist/", import.meta.url));
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/api/")) return void api.handle(request, response);
    void serveUi(uiDirectory, request.method ?? "GET", url, response);
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function serveUi(uiDirectory: string, method: string, requestUrl: string, response: import("node:http").ServerResponse): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(uiDirectory, requested);
  const escaped = relative(uiDirectory, candidate);
  if (escaped.startsWith("..") || resolve(candidate) === resolve(uiDirectory)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error();
    const body = await readFile(candidate);
    response.writeHead(200, { "content-type": contentType(candidate), "cache-control": "no-cache" });
    response.end(method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

function contentType(filePath: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(filePath)] ?? "application/octet-stream";
}

async function main(): Promise<void> {
  const { url } = await startWebServer();
  console.log(`PlanTree 本地 API 已启动：${url}`);
  console.log("按 Ctrl+C 停止服务。");
}

if (process.argv[1]?.endsWith("web-server.js")) {
  void main();
}
