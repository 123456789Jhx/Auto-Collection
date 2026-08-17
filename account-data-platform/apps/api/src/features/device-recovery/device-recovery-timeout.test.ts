import { describe, expect, test } from "bun:test";
import type { DeviceRecoveryErrorCode, DeviceRecoveryStage } from "@pkg/types";
import { evaluateDeviceRecoveryTimeout, projectDeviceRecovery } from "./device-recovery-timeout";

function session(stage: string, overrides: Record<string, unknown> = {}) {
  return {
    stage,
    startedAt: new Date("2026-08-12T09:00:00.000Z"),
    lastStageAt: new Date("2026-08-12T09:00:00.000Z"),
    resultStatus: undefined,
    completedAt: undefined,
    ...overrides
  } as any;
}

const timeoutCases = [
  ["WAITING_DEVICE", 60, "DEVICE_UNREACHABLE"],
  ["SYSTEM_BOOTED", 120, "NETWORK_READY_TIMEOUT"],
  ["NETWORK_CONNECTED", 30, "AGENT_LAUNCH_TIMEOUT"],
  ["AGENT_LAUNCHED", 60, "DEVICE_REGISTRATION_TIMEOUT"],
  ["DEVICE_REGISTERED", 60, "HEARTBEAT_RESTORE_TIMEOUT"],
  ["HEARTBEAT_RESTORED", 60, "COMMAND_CHANNEL_TIMEOUT"]
] satisfies Array<[DeviceRecoveryStage, number, DeviceRecoveryErrorCode]>;

describe("device recovery timeout projection", () => {
  test.each(timeoutCases)("maps %s to its first failed boundary", (stage, seconds, errorCode) => {
    const before = new Date(`2026-08-12T09:00:${String(Math.min(59, Number(seconds) - 1)).padStart(2, "0")}.000Z`);
    const after = new Date(new Date("2026-08-12T09:00:00.000Z").getTime() + Number(seconds) * 1000 + 1);

    expect(evaluateDeviceRecoveryTimeout(session(stage), before)).toBeNull();
    expect(evaluateDeviceRecoveryTimeout(session(stage), after)?.errorCode).toBe(errorCode);
  });

  test("does not expire terminal or command-ready sessions", () => {
    const late = new Date("2026-08-12T10:00:00.000Z");
    expect(evaluateDeviceRecoveryTimeout(session("COMMAND_CHANNEL_READY"), late)).toBeNull();
    expect(evaluateDeviceRecoveryTimeout(session("WAITING_DEVICE", { resultStatus: "FAILED" }), late)).toBeNull();
  });

  test("projects deadline, elapsed duration and operator action", () => {
    const projection = projectDeviceRecovery(
      session("SYSTEM_BOOTED"),
      new Date("2026-08-12T09:00:30.000Z")
    );

    expect(projection.active).toBe(true);
    expect(projection.deadlineAt).toBe("2026-08-12T09:02:00.000Z");
    expect(projection.elapsedMs).toBe(30_000);
    expect(projection.remainingMs).toBe(90_000);
    expect(projection.requiresUserAction).toBe(false);
  });
});
