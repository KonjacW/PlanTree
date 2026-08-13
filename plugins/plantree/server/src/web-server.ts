import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";

import { createWebApi } from "./web-api.js";

export type WebServerInstance = { server: Server; url: string };

export async function startWebServer(port = 4174): Promise<WebServerInstance> {
  const api = createWebApi();
  const server = createServer((request, response) => void api.handle(request, response));
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function main(): Promise<void> {
  const { url } = await startWebServer();
  console.log(`PlanTree 本地 API 已启动：${url}`);
  console.log("按 Ctrl+C 停止服务。");
}

if (process.argv[1]?.endsWith("web-server.js")) {
  void main();
}
