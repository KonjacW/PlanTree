import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ExecutionRequest {
  readonly requestId: number;
  readonly planId: string;
  readonly snapshotVersion: number;
  readonly requestedAt: string;
}

const emptyRequest: ExecutionRequest = {
  requestId: 0,
  planId: "",
  snapshotVersion: 0,
  requestedAt: "",
};

export function getDefaultExecutionRequestPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/execution-request.json");
}

export class ExecutionRequestStore {
  constructor(private readonly filePath = getDefaultExecutionRequestPath()) {}

  async read(): Promise<ExecutionRequest> {
    try {
      await access(this.filePath);
    } catch {
      return structuredClone(emptyRequest);
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!isExecutionRequest(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new Error("PlanTree 执行请求文件无效。");
    }
  }

  async create(planId: string, snapshotVersion: number): Promise<ExecutionRequest> {
    const current = await this.read();
    const next: ExecutionRequest = {
      requestId: current.requestId + 1,
      planId,
      snapshotVersion,
      requestedAt: new Date().toISOString(),
    };
    await this.writeAtomically(next);
    return next;
  }

  async waitAfter(afterRequestId: number, timeoutSeconds: number): Promise<ExecutionRequest | undefined> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    do {
      const current = await this.read();
      if (current.requestId > afterRequestId) return current;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    } while (Date.now() < deadline);
    return undefined;
  }

  private async writeAtomically(request: ExecutionRequest): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify(request, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function isExecutionRequest(value: unknown): value is ExecutionRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<ExecutionRequest>;
  return Number.isInteger(request.requestId) && typeof request.requestId === "number" && request.requestId >= 0
    && typeof request.planId === "string"
    && Number.isInteger(request.snapshotVersion) && typeof request.snapshotVersion === "number" && request.snapshotVersion >= 0
    && typeof request.requestedAt === "string";
}
