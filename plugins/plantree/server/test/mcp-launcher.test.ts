import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type McpConfig = { mcpServers: { plantree: { command: string; args: string[] } } };

describe("PlanTree 插件 MCP 启动器", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("可从任意工作目录启动，而不依赖未展开的 PLUGIN_ROOT 字面量", async () => {
    const pluginRoot = dirname(dirname(dirname(fileURLToPath(new URL(import.meta.url)))));
    const config = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8")) as McpConfig;
    expect(config.mcpServers.plantree.args.join(" ")).not.toContain("${PLUGIN_ROOT}");

    temporaryDirectory = await mkdtemp(join(tmpdir(), "plantree-launcher-"));
    const environment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    environment.PLANTREE_PLUGIN_ROOT = pluginRoot;
    const transport = new StdioClientTransport({
      ...config.mcpServers.plantree,
      cwd: temporaryDirectory,
      env: environment,
      stderr: "pipe",
    });
    const client = new Client({ name: "plantree-launcher-test", version: "1" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("render_plan_tree");
    } finally {
      await client.close();
    }
  }, 15_000);
});
