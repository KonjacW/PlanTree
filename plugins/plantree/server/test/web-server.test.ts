import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { startWebServer } from "../src/web-server.js";

describe("PlanTree Web 服务", () => {
  it("只绑定回环地址并可读取计划", async () => {
    const instance = await startWebServer(0);

    try {
      expect(instance.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const response = await fetch(`${instance.url}/api/plan`);
      expect(response.status).toBe(200);
      expect((await response.json()).snapshot.id).toBe("demo-import-wizard-crash");
    } finally {
      instance.server.close();
      await once(instance.server, "close");
    }
  });
});
