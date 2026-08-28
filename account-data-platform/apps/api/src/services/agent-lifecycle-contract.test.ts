import { describe, expect, test } from "bun:test";
import { collectorDevices } from "@pkg/db/schema";
import { mobileHeartbeatSchema } from "@pkg/types";

describe("Agent lifecycle contract", () => {
  test("persists actual lifecycle fields on collector devices", () => {
    expect(collectorDevices.agentLifecycleState).toBeDefined();
    expect(collectorDevices.pollingEnabled).toBeDefined();
    expect(collectorDevices.agentStateReason).toBeDefined();
    expect(collectorDevices.agentStateChangedAt).toBeDefined();
    expect(collectorDevices.agentSessionId).toBeDefined();
  });

  test("accepts a stopped heartbeat from the local stop button", () => {
    const parsed = mobileHeartbeatSchema.safeParse({
      taskId: "task-001",
      deviceId: "device-001",
      status: "stopped",
      agentLifecycleState: "STOPPED",
      pollingEnabled: false,
      agentStateReason: "LOCAL_STOP_BUTTON",
      agentStateChangedAt: "2026-08-28T10:00:00.000Z",
      agentSessionId: "agent-session-001"
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.agentLifecycleState).toBe("STOPPED");
      expect(parsed.data.pollingEnabled).toBe(false);
      expect(parsed.data.agentStateReason).toBe("LOCAL_STOP_BUTTON");
      expect(parsed.data.agentSessionId).toBe("agent-session-001");
    }
  });
});
