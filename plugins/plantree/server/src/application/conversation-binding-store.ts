import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ConversationBinding {
  readonly planId: string;
  readonly threadId: string;
  readonly cwd: string;
  readonly boundAt: string;
}

export function getDefaultConversationBindingPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/conversation-binding.json");
}

export class ConversationBindingStore {
  constructor(private readonly filePath = getDefaultConversationBindingPath()) {}

  async read(): Promise<ConversationBinding | undefined> {
    try {
      await access(this.filePath);
    } catch {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!isConversationBinding(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new Error("PlanTree 对话绑定文件无效。");
    }
  }

  async bind(planId: string, threadId: string, cwd: string): Promise<ConversationBinding> {
    if (!planId.trim() || !isThreadId(threadId) || !cwd.trim()) throw new Error("无法建立有效的 PlanTree 对话绑定。");
    const binding: ConversationBinding = { planId, threadId, cwd, boundAt: new Date().toISOString() };
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify(binding, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
      return binding;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

export function isThreadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isConversationBinding(value: unknown): value is ConversationBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Partial<ConversationBinding>;
  return typeof binding.planId === "string" && binding.planId.length > 0
    && typeof binding.threadId === "string" && isThreadId(binding.threadId)
    && typeof binding.cwd === "string" && binding.cwd.length > 0
    && typeof binding.boundAt === "string";
}
