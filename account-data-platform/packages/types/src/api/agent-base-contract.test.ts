import { describe, expect, test } from "bun:test";
import { createMobileCommandSchema } from "./admin";
import { mobileBaseCommandAckSchema, mobileBaseHeartbeatSchema } from "./mobile";

describe("native base Agent contract", () => {
  test("accepts an authenticated base heartbeat with screen state", () => {
    const parsed = mobileBaseHeartbeatSchema.safeParse({
      deviceId: "mi-8-001",
      screenState: "locked",
      agentState: "running",
      reportedAt: "2026-08-12T08:00:00.000Z"
    });

    expect(parsed.success).toBe(true);
  });

  test("keeps Agent lifecycle commands separate from task commands", () => {
    expect(createMobileCommandSchema.safeParse({ deviceId: "mi-8-001", commandType: "OPEN_AGENT_APP" }).success).toBe(true);
    expect(createMobileCommandSchema.safeParse({ deviceId: "mi-8-001", commandType: "START_AGENT" }).success).toBe(true);
    expect(createMobileCommandSchema.safeParse({ deviceId: "mi-8-001", commandType: "STOP_AGENT" }).success).toBe(true);
    expect(createMobileCommandSchema.safeParse({ deviceId: "mi-8-001", commandType: "STOP" }).success).toBe(true);
  });

  test("accepts EXIT_AGENT_APP and defaults lockScreen to false", () => {
    const parsed = createMobileCommandSchema.safeParse({
      deviceId: "mi-8-001",
      commandType: "EXIT_AGENT_APP"
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.payload).toEqual({ lockScreen: false });
    }
    expect(createMobileCommandSchema.safeParse({
      deviceId: "mi-8-001",
      commandType: "EXIT_AGENT_APP",
      payload: { lockScreen: true }
    }).success).toBe(true);
  });

  test("rejects malformed EXIT_AGENT_APP payloads", () => {
    expect(createMobileCommandSchema.safeParse({
      deviceId: "mi-8-001",
      commandType: "EXIT_AGENT_APP",
      payload: { lockScreen: "yes" }
    }).success).toBe(false);
    expect(createMobileCommandSchema.safeParse({
      deviceId: "mi-8-001",
      commandType: "EXIT_AGENT_APP",
      payload: { lockScreen: false, forceStop: true }
    }).success).toBe(false);
  });

  test.each([
    ["DONE", "DONE"],
    ["DONE", "PARTIAL"],
    ["FAILED", "FAILED"]
  ] as const)("accepts %s transport status with %s exit result", (status, result) => {
    const stages = result === "FAILED"
      ? [
        { name: "STOP_AGENT", status: "FAILED", reason: "STOP_FAILED" },
        { name: "REMOVE_APP_TASK", status: "SKIPPED", reason: "NOT_RUN" },
        { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
      ]
      : [
        { name: "STOP_AGENT", status: "SUCCESS" },
        { name: "REMOVE_APP_TASK", status: "SKIPPED", reason: "NO_UI_TASK" },
        { name: "LOCK_SCREEN", status: result === "PARTIAL" ? "FAILED" : "SKIPPED", reason: result === "PARTIAL" ? "LOCK_FAILED" : "NOT_REQUESTED" }
      ];
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status,
      result: {
        commandType: "EXIT_AGENT_APP",
        result,
        stages
      }
    }).success).toBe(true);
  });

  test("rejects invalid staged exit ACK results", () => {
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: {
        commandType: "EXIT_AGENT_APP",
        result: "COMPLETE",
        stages: [{ name: "FORCE_STOP_APP", status: "SUCCESS" }]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: {
        result: "DONE",
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "REMOVE_APP_TASK", status: "SUCCESS" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
        ]
      }
    }).success).toBe(false);
  });

  test.each([
    [{ commandType: "STOP_AGENT", action: "STOPPED" }],
    [{ result: "DONE" }],
    [{ stages: [] }]
  ])("rejects partial exit-shaped ACK result %o instead of treating it as legacy", (result) => {
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result
    }).success).toBe(false);
  });

  test("preserves unrelated legacy BASE ACK results", () => {
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: { action: "RESTORED_EXISTING_TASK", reason: "ALREADY_RUNNING" }
    }).success).toBe(true);
  });

  test("rejects missing, duplicated, extra, or out-of-order exit stages", () => {
    const base = {
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE" as const,
      result: {
        commandType: "EXIT_AGENT_APP" as const,
        result: "DONE" as const
      }
    };
    expect(mobileBaseCommandAckSchema.safeParse({
      ...base,
      result: {
        ...base.result,
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
        ]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      ...base,
      result: {
        ...base.result,
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" },
          { name: "REMOVE_APP_TASK", status: "SUCCESS" }
        ]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      ...base,
      result: {
        ...base.result,
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "STOP_AGENT", status: "SKIPPED", reason: "ALREADY_STOPPED" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
        ]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      ...base,
      result: {
        ...base.result,
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "REMOVE_APP_TASK", status: "SUCCESS" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
        ]
      }
    }).success).toBe(false);
  });

  test("rejects contradictory exit transport and business states", () => {
    const stages = [
      { name: "STOP_AGENT", status: "SUCCESS" },
      { name: "REMOVE_APP_TASK", status: "SUCCESS" },
      { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
    ];
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "FAILED",
      result: { commandType: "EXIT_AGENT_APP", result: "DONE", stages }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: {
        commandType: "EXIT_AGENT_APP",
        result: "FAILED",
        stages: [
          { name: "STOP_AGENT", status: "FAILED", reason: "STOP_FAILED" },
          { name: "REMOVE_APP_TASK", status: "SKIPPED", reason: "NOT_RUN" },
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
        ]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "FAILED",
      result: {
        commandType: "EXIT_AGENT_APP",
        result: "PARTIAL",
        stages: [
          { name: "STOP_AGENT", status: "SUCCESS" },
          { name: "REMOVE_APP_TASK", status: "SUCCESS" },
          { name: "LOCK_SCREEN", status: "FAILED", reason: "LOCK_FAILED" }
        ]
      }
    }).success).toBe(false);
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: {
        commandType: "EXIT_AGENT_APP",
        result: "PARTIAL",
        stages
      }
    }).success).toBe(false);
  });
});
