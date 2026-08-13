import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const defaultRootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createWebBuildSpec(rootDirectory = defaultRootDirectory, nodePath = process.execPath) {
  const serverDirectory = resolve(rootDirectory, "server");
  return {
    command: nodePath,
    args: [resolve(serverDirectory, "node_modules", "typescript", "bin", "tsc"), "--project", resolve(serverDirectory, "tsconfig.build.json")],
    cwd: serverDirectory,
  };
}

async function runBuild(rootDirectory) {
  const spec = createWebBuildSpec(rootDirectory);
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("PlanTree 服务端构建失败。");
}

async function startApi(rootDirectory) {
  const moduleUrl = pathToFileURL(resolve(rootDirectory, "server", "dist", "web-server.js"));
  moduleUrl.searchParams.set("build", String(Date.now()));
  const { startWebServer } = await import(moduleUrl.href);
  const instance = await startWebServer(4174);
  return { close: () => new Promise((resolveClose, reject) => instance.server.close((error) => error ? reject(error) : resolveClose())) };
}

export function createWebUiConfig(rootDirectory = defaultRootDirectory) {
  const uiDirectory = resolve(rootDirectory, "ui");
  return {
    root: uiDirectory,
    configFile: resolve(uiDirectory, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  };
}

async function startUi(rootDirectory) {
  const uiDirectory = resolve(rootDirectory, "ui");
  const viteUrl = pathToFileURL(resolve(uiDirectory, "node_modules", "vite", "dist", "node", "index.js"));
  const { createServer } = await import(viteUrl.href);
  const server = await createServer(createWebUiConfig(rootDirectory));
  await server.listen();
  return { close: () => server.close() };
}

export async function startWebRuntime(rootDirectory = defaultRootDirectory, overrides = {}) {
  const dependencies = {
    runBuild,
    startApi,
    startUi,
    onApiStarted: () => undefined,
    onUiStarted: () => undefined,
    ...overrides,
  };

  await dependencies.runBuild(rootDirectory);
  const api = await dependencies.startApi(rootDirectory);
  dependencies.onApiStarted();
  try {
    const ui = await dependencies.startUi(rootDirectory);
    dependencies.onUiStarted();
    let uiClosed = false;
    let apiClosed = false;
    return {
      async close() {
        let closeError;
        if (!uiClosed) {
          try {
            await ui.close();
            uiClosed = true;
          } catch (error) {
            closeError = error;
          }
        }
        if (!apiClosed) {
          try {
            await api.close();
            apiClosed = true;
          } catch (error) {
            closeError ??= error;
          }
        }
        if (closeError) throw closeError;
      },
    };
  } catch (error) {
    await api.close();
    throw error;
  }
}

export async function startWeb(rootDirectory = defaultRootDirectory) {
  const runtime = await startWebRuntime(rootDirectory);
  console.log("PlanTree Web 页面：http://127.0.0.1:5174");
  console.log("按 Ctrl+C 停止本地服务。");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startWeb().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
