import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createPlanTreeServer } from "./server.js";

async function main(): Promise<void> {
  const server = createPlanTreeServer();
  await server.connect(new StdioServerTransport());
}

void main();
