import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { initialDemoPlan } from "../src/domain/demo.js";
import { PersistentPlanStore } from "../src/application/persistent-plan-store.js";

describe("PersistentPlanStore", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("首次读取创建状态文件，其他 Store 实例可读取同一快照", async () => {
    const filePath = await createPath();
    const first = new PersistentPlanStore(filePath);
    const initial = await first.read();
    const second = new PersistentPlanStore(filePath);

    expect(initial.id).toBe("demo-import-wizard-crash");
    expect(await second.read()).toEqual(initial);
    await expect(access(filePath)).resolves.toBeUndefined();
  });

  it("仅在版本匹配时写入，并向过期写入返回最新快照", async () => {
    const store = new PersistentPlanStore(await createPath());
    const initial = await store.read();
    const next = { ...initial, version: initial.version + 1 };
    await store.write(next, initial.version);

    await expect(store.write({ ...next, version: next.version + 1 }, initial.version))
      .rejects.toMatchObject({ message: "任务树已被其他入口更新，请刷新后重试。", snapshot: next });
    expect(await store.read()).toEqual(next);
  });

  it("拒绝无效状态文件，并在重置时覆盖为演示计划", async () => {
    const filePath = await createPath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{invalid", "utf8");
    const store = new PersistentPlanStore(filePath);
    await expect(store.read()).rejects.toThrow("任务树状态文件无效。");

    await writeFile(filePath, JSON.stringify({ ...initialDemoPlan, version: 7 }), "utf8");
    expect((await store.reset(7)).version).toBe(8);
  });

  async function createPath(): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "plantree-store-"));
    return join(directory, "state", "plantree-plan.json");
  }
});
