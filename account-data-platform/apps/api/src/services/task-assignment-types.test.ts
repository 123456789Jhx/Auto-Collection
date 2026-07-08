import { describe, expect, test } from "bun:test";
import { createTaskAssignmentSchema } from "@pkg/types";

describe("task assignment types", () => {
  test("商品卡直播评论使用独立任务类型", () => {
    const parsed = createTaskAssignmentSchema.safeParse({
      deviceId: "device-001",
      taskType: "commerce_card_live_comment",
      commandType: "START",
      reason: "manual_commerce_card_live_comment"
    });

    expect(parsed.success).toBe(true);
  });
});
