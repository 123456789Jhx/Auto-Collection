import { expect, test } from "bun:test";
import {
  DEVICE_RECOVERY_STAGES,
  deviceRecoveryErrorCodeSchema,
  deviceRecoverySessionSchema,
  deviceRecoveryStageReportSchema
} from "./device-recovery";

test("automatic boot and manual wake share one recovery session contract", () => {
  const automatic = deviceRecoverySessionSchema.parse({
    sessionId: "00000000-0000-4000-8000-000000000101",
    deviceId: "device_3c306f2e5ac76e97",
    source: "AUTO_BOOT",
    stage: "NETWORK_CONNECTED",
    startedAt: "2026-08-12T06:00:00.000Z",
    updatedAt: "2026-08-12T06:00:05.000Z"
  });
  const manual = deviceRecoverySessionSchema.parse({
    sessionId: "00000000-0000-4000-8000-000000000102",
    deviceId: "device_3c306f2e5ac76e97",
    commandId: "00000000-0000-4000-8000-000000000103",
    source: "MANUAL_WAKE",
    channel: "AGENT_POLL",
    stage: "WAITING_DEVICE",
    startedAt: "2026-08-12T06:01:00.000Z",
    updatedAt: "2026-08-12T06:01:00.000Z"
  });

  expect(automatic.commandId).toBeUndefined();
  expect(manual.commandId).toBeDefined();
  expect(automatic.source).toBe("AUTO_BOOT");
  expect(manual.source).toBe("MANUAL_WAKE");
});

test("recovery stages preserve the user-visible readiness order", () => {
  expect(DEVICE_RECOVERY_STAGES).toEqual([
    "WAITING_DEVICE",
    "SYSTEM_BOOTED",
    "NETWORK_CONNECTED",
    "AGENT_LAUNCHED",
    "DEVICE_REGISTERED",
    "HEARTBEAT_RESTORED",
    "COMMAND_CHANNEL_READY"
  ]);
});

test("stage reports carry an idempotency key and original device timestamp", () => {
  const report = deviceRecoveryStageReportSchema.parse({
    deviceId: "device_3c306f2e5ac76e97",
    bootId: "boot-20260812-140000",
    eventKey: "boot-20260812-140000:NETWORK_CONNECTED",
    source: "AUTO_BOOT",
    stage: "NETWORK_CONNECTED",
    occurredAt: "2026-08-12T06:00:17.000Z",
    reportedAt: "2026-08-12T06:01:48.000Z",
    details: { networkType: "CELLULAR" }
  });

  expect(report.occurredAt).toBe("2026-08-12T06:00:17.000Z");
  expect(report.reportedAt).toBe("2026-08-12T06:01:48.000Z");
  expect(report.eventKey).toContain("NETWORK_CONNECTED");
});

test("recovery errors identify the first failed boundary", () => {
  expect(deviceRecoveryErrorCodeSchema.parse("NETWORK_READY_TIMEOUT")).toBe("NETWORK_READY_TIMEOUT");
  expect(deviceRecoveryErrorCodeSchema.parse("COMMAND_CHANNEL_TIMEOUT")).toBe("COMMAND_CHANNEL_TIMEOUT");
  expect(deviceRecoveryErrorCodeSchema.safeParse("GENERIC_TIMEOUT").success).toBe(false);
});
