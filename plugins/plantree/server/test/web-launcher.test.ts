import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createWebBuildSpec, createWebUiConfig, startWebRuntime } from "../../scripts/start-web.mjs";

const execFileAsync = promisify(execFile);

describe("PlanTree Web 启动器", () => {
  it("使用项目内 TypeScript 编译器生成最新服务端构建", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const spec = createWebBuildSpec(root, process.execPath);

    expect(spec).toEqual({
      command: process.execPath,
      args: [expect.stringMatching(/server[\\/]node_modules[\\/]typescript[\\/]bin[\\/]tsc$/), "--project", expect.stringMatching(/server[\\/]tsconfig\.build\.json$/)],
      cwd: expect.stringMatching(/server$/),
    });
  });

  it("固定使用 5174 端口且端口占用时直接失败", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));

    expect(createWebUiConfig(root)).toMatchObject({
      server: { host: "127.0.0.1", port: 5174, strictPort: true },
    });
  });

  it("按编译、API、UI 顺序启动，并在同一进程内关闭两个服务", async () => {
    const events: string[] = [];
    const runtime = await startWebRuntime(fileURLToPath(new URL("../..", import.meta.url)), {
      runBuild: async () => { events.push("build"); },
      startApi: async () => ({ close: async () => { events.push("close-api"); } }),
      startUi: async () => ({ close: async () => { events.push("close-ui"); } }),
      onApiStarted: () => { events.push("api"); },
      onUiStarted: () => { events.push("ui"); },
    });

    expect(events).toEqual(["build", "api", "ui"]);

    await runtime.close();
    expect(events).toEqual(["build", "api", "ui", "close-ui", "close-api"]);
  });

  it("UI 关闭失败时仍关闭 API，并可再次尝试关闭", async () => {
    const events: string[] = [];
    let uiCloseAttempts = 0;
    const runtime = await startWebRuntime(fileURLToPath(new URL("../..", import.meta.url)), {
      runBuild: async () => undefined,
      startApi: async () => ({ close: async () => { events.push("close-api"); } }),
      startUi: async () => ({
        close: async () => {
          uiCloseAttempts += 1;
          events.push(`close-ui-${uiCloseAttempts}`);
          if (uiCloseAttempts === 1) throw new Error("UI close failed");
        },
      }),
    });

    await expect(runtime.close()).rejects.toThrow("UI close failed");
    expect(events).toEqual(["close-ui-1", "close-api"]);

    await expect(runtime.close()).resolves.toBeUndefined();
    expect(events).toEqual(["close-ui-1", "close-api", "close-ui-2"]);
  });

  it("可被 Node 作为 JavaScript 启动器解析", async () => {
    const launcher = fileURLToPath(new URL("../../scripts/start-web.mjs", import.meta.url));

    await expect(execFileAsync(process.execPath, ["--check", launcher])).resolves.toMatchObject({ stderr: "" });
  });
});
