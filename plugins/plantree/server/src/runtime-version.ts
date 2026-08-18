import { readFileSync } from "node:fs";

type PluginManifest = { version?: unknown };

function readRuntimeVersion(): string {
  const manifestUrl = new URL("../../.codex-plugin/plugin.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as PluginManifest;
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("PlanTree 插件清单缺少有效版本号。");
  }
  return manifest.version;
}

// Capture the version when this process starts. A stale process therefore keeps
// reporting its old version even if the source plugin is updated on disk.
export const PLANTREE_RUNTIME_VERSION = readRuntimeVersion();
