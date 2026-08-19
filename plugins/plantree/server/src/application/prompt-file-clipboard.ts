import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExecutionChain } from "../domain/execution-chain.js";
import type { PlanSnapshot } from "../domain/types.js";

export const DEFAULT_PROMPT_FILE = fileURLToPath(new URL("../../../data/plantree-prompt.md", import.meta.url));

export type ClipboardFileWriter = (filePath: string) => Promise<void>;

export interface PromptFileCopyResult {
  readonly fileName: "plantree-prompt.md";
  readonly filePath: string;
  readonly taskCount: number;
}

export class PromptFileClipboard {
  constructor(
    private readonly filePath = DEFAULT_PROMPT_FILE,
    private readonly writeClipboardFile: ClipboardFileWriter = copyFileToWindowsClipboard,
  ) {}

  async copy(snapshot: PlanSnapshot, chain: ExecutionChain): Promise<PromptFileCopyResult> {
    const remaining = chain.tasks.filter((task) => task.status !== "completed");
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, buildPromptFile(snapshot, chain), "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    await this.writeClipboardFile(this.filePath);
    return { fileName: "plantree-prompt.md", filePath: this.filePath, taskCount: remaining.length };
  }
}

export function buildPromptFile(_snapshot: PlanSnapshot, chain: ExecutionChain): string {
  const remaining = chain.tasks.filter((task) => task.status !== "completed");
  const sections = [
    "# 任务执行要求",
    "",
    "## 执行协议",
    "",
    "1. 按下列顺序逐项实际完成任务，不要重新规划、跳项或只复述计划。",
    "2. 每项只采用该子任务给出的方法；完成后执行其验收。没有显式验收时，由 Agent 自行评价并简述依据。",
    "3. 一项完成且验收通过后才进入下一项；不得虚假宣称完成。",
    "4. 若失败、受阻、需要用户批准或验收未通过，停止在当前项并说明情况。",
    "5. 所有任务完成后，汇总实际产物、验证结果和未解决问题。",
  ];
  for (const task of remaining) {
    sections.push("", `## 子任务 ${task.sequence}`, "", task.prompt);
  }
  return `${sections.join("\n")}\n`;
}

export async function copyFileToWindowsClipboard(filePath: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("当前系统不支持把提示文件作为剪贴板文件对象复制。");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$files = New-Object System.Collections.Specialized.StringCollection",
    "[void]$files.Add($env:PLANTREE_PROMPT_FILE)",
    "[System.Windows.Forms.Clipboard]::SetFileDropList($files)",
  ].join("; ");
  await new Promise<void>((resolveCopy, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, PLANTREE_PROMPT_FILE: filePath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveCopy() : reject(new Error(stderr.trim() || `复制提示文件失败（退出码 ${code ?? "未知"}）。`)));
  });
}
