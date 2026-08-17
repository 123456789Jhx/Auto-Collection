import { describe, expect, test } from "bun:test";
import { createInMemoryDeviceRecoveryRepository } from "./device-recovery.repository";
import { createDeviceRecoveryService } from "./device-recovery.service";

const device = {
  id: "10000000-0000-4000-8000-000000000001",
  deviceCode: "device-mi8"
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: device.deviceCode,
    bootId: "boot-2026-08-12-01",
    eventKey: "boot-2026-08-12-01:SYSTEM_BOOTED",
    source: "AUTO_BOOT" as const,
    stage: "SYSTEM_BOOTED" as const,
    occurredAt: "2026-08-12T01:00:00.000Z",
    reportedAt: "2026-08-12T01:00:05.000Z",
    ...overrides
  };
}

describe("device recovery service", () => {
  test("creates and reuses one command-linked MANUAL_WAKE session", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    const service = createDeviceRecoveryService({
      repository,
      now: () => new Date("2026-08-12T08:00:00.000Z")
    });
    const commandId = "20000000-0000-4000-8000-000000000001";

    const first = await service.startManualWake({
      deviceId: device.deviceCode,
      commandId,
      channel: "AGENT_POLL"
    });
    const repeated = await service.startManualWake({
      deviceId: device.deviceCode,
      commandId,
      channel: "AGENT_POLL"
    });

    expect(first.sessionId).toBe(repeated.sessionId);
    expect(first.source).toBe("MANUAL_WAKE");
    expect(first.commandId).toBe(commandId);
    expect(first.stage).toBe("WAITING_DEVICE");
    expect(repository.listSessions()).toHaveLength(1);
  });

  test("completes a manual wake session from the command terminal result", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    let currentTime = new Date("2026-08-12T08:00:00.000Z");
    const service = createDeviceRecoveryService({ repository, now: () => currentTime });
    const commandId = "20000000-0000-4000-8000-000000000002";
    await service.startManualWake({ deviceId: device.deviceCode, commandId, channel: "AGENT_POLL" });
    currentTime = new Date("2026-08-12T08:00:12.000Z");

    const completed = await service.completeManualWake(commandId, {
      status: "SUCCEEDED"
    });

    expect(completed?.stage).toBe("COMMAND_CHANNEL_READY");
    expect(completed?.resultStatus).toBe("SUCCEEDED");
    expect(completed?.completedAt).toBe("2026-08-12T08:00:12.000Z");
    expect(repository.allEvents().map((event) => event.eventKey)).toEqual([
      `${commandId}:COMMAND_CHANNEL_READY`
    ]);
  });

  test("persists the first timeout during latest-session projection", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    let currentTime = new Date("2026-08-12T09:00:00.000Z");
    const service = createDeviceRecoveryService({ repository, now: () => currentTime });
    await service.startManualWake({
      deviceId: device.deviceCode,
      commandId: "20000000-0000-4000-8000-000000000003",
      channel: "AGENT_POLL"
    });
    currentTime = new Date("2026-08-12T09:01:00.001Z");

    const first = await service.getLatest(device.deviceCode);
    currentTime = new Date("2026-08-12T09:02:00.000Z");
    const repeated = await service.getLatest(device.deviceCode);

    expect(first?.session.resultStatus).toBe("TIMED_OUT");
    expect(first?.session.errorCode).toBe("DEVICE_UNREACHABLE");
    expect(first?.projection.requiresUserAction).toBe(true);
    expect(repeated?.session.completedAt).toBe(first?.session.completedAt);
  });

  test("creates one AUTO_BOOT session and reuses it for later stages", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    const service = createDeviceRecoveryService({ repository });

    const first = await service.reportStage(report());
    const second = await service.reportStage(report({
      eventKey: "boot-2026-08-12-01:NETWORK_CONNECTED",
      stage: "NETWORK_CONNECTED",
      occurredAt: "2026-08-12T01:00:03.000Z"
    }));

    expect(first.session.sessionId).toBe(second.session.sessionId);
    expect(second.session.stage).toBe("NETWORK_CONNECTED");
    expect(repository.listSessions()).toHaveLength(1);
  });

  test("accepts a duplicate event as an idempotent success", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    const service = createDeviceRecoveryService({ repository });

    const first = await service.reportStage(report());
    const duplicate = await service.reportStage(report());

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(repository.allEvents()).toHaveLength(1);
  });

  test("stores delayed events without regressing the current stage", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    const service = createDeviceRecoveryService({ repository });

    await service.reportStage(report({
      eventKey: "boot-2026-08-12-01:HEARTBEAT_RESTORED",
      stage: "HEARTBEAT_RESTORED",
      occurredAt: "2026-08-12T01:00:10.000Z"
    }));
    const delayed = await service.reportStage(report({
      eventKey: "boot-2026-08-12-01:NETWORK_CONNECTED",
      stage: "NETWORK_CONNECTED",
      occurredAt: "2026-08-12T01:00:03.000Z",
      reportedAt: "2026-08-12T01:00:20.000Z"
    }));

    expect(delayed.session.stage).toBe("HEARTBEAT_RESTORED");
    expect(repository.allEvents()).toHaveLength(2);
  });

  test("marks the session successful when the command channel is ready", async () => {
    const repository = createInMemoryDeviceRecoveryRepository([device]);
    const service = createDeviceRecoveryService({ repository });

    const result = await service.reportStage(report({
      eventKey: "boot-2026-08-12-01:COMMAND_CHANNEL_READY",
      stage: "COMMAND_CHANNEL_READY",
      occurredAt: "2026-08-12T01:00:12.000Z"
    }));
    const timeline = await service.getLatest(device.deviceCode);

    expect(result.session.resultStatus).toBe("SUCCEEDED");
    expect(result.session.completedAt).toBe("2026-08-12T01:00:12.000Z");
    expect(timeline?.events[0]?.stage).toBe("COMMAND_CHANNEL_READY");
  });

  test("rejects unknown devices and AUTO_BOOT reports without a boot id", async () => {
    const service = createDeviceRecoveryService({
      repository: createInMemoryDeviceRecoveryRepository([device])
    });

    await expect(service.reportStage(report({ deviceId: "missing" }))).rejects.toThrow("DEVICE_NOT_FOUND");
    await expect(service.reportStage(report({ bootId: undefined }))).rejects.toThrow("BOOT_ID_REQUIRED");
  });
});
