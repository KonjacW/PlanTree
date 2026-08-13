import { describe, expect, it } from "vitest";

import { getTaskRelationPath } from "./TaskRelationEdge";

describe("getTaskRelationPath", () => {
  it("使用 Preview 的左右端点三次贝塞尔曲线", () => {
    expect(getTaskRelationPath(185, 306, 276, 104)).toBe("M 185 306 C 243 306, 218 104, 276 104");
    expect(getTaskRelationPath(427, 232, 520, 212)).toBe("M 427 232 C 485 232, 462 212, 520 212");
    expect(getTaskRelationPath(185, 305.5, 276, 103.5)).toBe("M 185 306 C 243 306, 218 104, 276 104");
  });
});
