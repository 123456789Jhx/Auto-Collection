import { describe, expect, test } from "bun:test";
import { createTaskAssignmentSchema, featureRolloutControlUpdateSchema, mobileHeartbeatSchema } from "@pkg/types";

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

  test("控制命令可以携带既有 assignment 继续同一运行实例", () => {
    const parsed = createTaskAssignmentSchema.safeParse({
      deviceId: "device-001",
      taskType: "commerce_card_live_comment",
      assignmentId: "11111111-1111-4111-8111-111111111111",
      commandType: "PAUSE",
      expectedStateVersion: 3,
      commandIdempotencyKey: "admin:assignment:pause:001",
      reason: "manual_pause"
    });

    expect(parsed.success).toBe(true);
  });

  test("心跳接受结构化商品卡能力上报", () => {
    const parsed = mobileHeartbeatSchema.safeParse({
      taskId: "task-001",
      deviceId: "device-001",
      status: "idle",
      capabilities: {
        workflowVersion: 2,
        checkpointVersion: 2,
        pauseResume: true,
        stableRoomKey: true,
        idempotentComment: false,
        shortLivedCommentPermit: false
      }
    });

    expect(parsed.success).toBe(true);
  });

  test("运行门禁更新要求 revision 和审计原因", () => {
    const valid = featureRolloutControlUpdateSchema.safeParse({
      enabled: false,
      expectedRevision: 1,
      minAppVersion: null,
      requiredCapabilities: ["workflow_v2"],
      capabilityTtlSeconds: 600,
      deviceCodes: ["device-001"],
      reason: "阶段 A 参数校验"
    });
    const missingReason = featureRolloutControlUpdateSchema.safeParse({
      enabled: false,
      expectedRevision: 1,
      minAppVersion: null,
      requiredCapabilities: [],
      capabilityTtlSeconds: 600,
      deviceCodes: [],
      reason: ""
    });

    expect(valid.success).toBe(true);
    expect(missingReason.success).toBe(false);
  });
});
