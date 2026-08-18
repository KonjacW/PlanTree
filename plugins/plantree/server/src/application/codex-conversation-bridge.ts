import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ConversationBinding } from "./conversation-binding-store.js";
import { isThreadId } from "./conversation-binding-store.js";
import type { ExecutionRequest } from "./execution-request-store.js";

export interface CodexLaunch {
  readonly threadId: string;
  readonly requestId: number;
}

export type CodexSpawner = (command: string, args: readonly string[], options: { cwd: string }) => Promise<void>;

export class CodexConversationBridge {
  constructor(
    private readonly resolveCommand: () => Promise<string> = resolveCodexCommand,
    private readonly spawnCodex: CodexSpawner = spawnDetachedCodex,
  ) {}

  async launchExecution(request: ExecutionRequest, binding: ConversationBinding): Promise<CodexLaunch> {
    if (binding.planId !== request.planId) throw new Error("当前任务树未绑定到创建它的 Codex 对话，请在该对话中重新打开 PlanTree。");
    if (!isThreadId(binding.threadId)) throw new Error("PlanTree 保存的 Codex 对话标识无效，请重新打开任务树。");
    const command = await this.resolveCommand();
    await this.spawnCodex(command, [
      "exec",
      "resume",
      "--skip-git-repo-check",
      binding.threadId,
      buildExecutionPrompt(request),
    ], { cwd: binding.cwd });
    return { threadId: binding.threadId, requestId: request.requestId };
  }
}

export function buildExecutionPrompt(request: ExecutionRequest): string {
  return [
    "$plantree-workflow",
    `PlanTree UI 已授权自动执行计划“${request.planId}”的请求 #${request.requestId}，快照版本 ${request.snapshotVersion}。`,
    "这是执行请求：不要重新规划、不要重新渲染任务树，也不要等待另一个执行请求。",
    `立即调用 start_next_task(expectedVersion=${request.snapshotVersion})，实际执行返回的 task.prompt；验收通过后调用 complete_task，再领取下一项，循环直到 done=true。`,
    "若任务失败、受阻、需要批准或验收未通过，保留当前任务状态并在本对话说明；不要虚假标记完成。",
  ].join("\n");
}

export async function resolveCodexCommand(): Promise<string> {
  const override = process.env.PLANTREE_CODEX_PATH?.trim();
  if (override) return override;
  if (process.platform !== "win32") return "codex";
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "codex.exe";
  const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const directories = await readdir(binRoot, { withFileTypes: true });
    const candidates = await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const path = join(binRoot, entry.name, "codex.exe");
      try { return { path, modified: (await stat(path)).mtimeMs }; } catch { return undefined; }
    }));
    const newest = candidates.filter((candidate): candidate is { path: string; modified: number } => Boolean(candidate)).sort((left, right) => right.modified - left.modified)[0];
    return newest?.path ?? "codex.exe";
  } catch {
    return "codex.exe";
  }
}

async function spawnDetachedCodex(command: string, args: readonly string[], options: { cwd: string }): Promise<void> {
  await new Promise<void>((resolveSpawn, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolveSpawn(); });
  });
}
