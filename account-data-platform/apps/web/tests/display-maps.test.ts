import { describe, expect, test } from "bun:test";
import { statusColor, statusText } from "../src/lib/display-maps";
import { agentHeartbeatAt, agentStatus, baseStatus, type DeviceRow } from "../src/routes/DeviceList";

describe("Agent status presentation", () => {
  test("presents an expired Agent heartbeat as Agent unreachable", () => {
    expect(statusText("offline")).toBe("Agent 失联");
    expect(statusColor("offline")).toBe("default");
  });

  test("uses Agent fields ahead of legacy device fields when present", () => {
    const device: DeviceRow = {
      id: "device-a",
      deviceCode: "device-a",
      status: "offline",
      effectiveStatus: "offline",
      lastHeartbeatAt: "2026-08-12T08:00:00.000Z",
      agentStatus: "paused",
      agentLastHeartbeatAt: "2026-08-12T08:01:00.000Z",
      agentReachable: true
    };

    expect(agentStatus(device)).toBe("paused");
    expect(agentHeartbeatAt(device)).toBe("2026-08-12T08:01:00.000Z");
  });

  test("shows the native base as pending until it reports independently", () => {
    const device: DeviceRow = {
      id: "device-a",
      deviceCode: "device-a",
      status: "running",
      effectiveStatus: "running"
    };

    expect(baseStatus(device)).toBe("unknown");
    expect(statusText("unknown")).toBe("底座待接入");
    expect(statusText("agent_unreachable")).toBe("Agent 失联");
    expect(statusColor("unknown")).toBe("default");
  });
});
