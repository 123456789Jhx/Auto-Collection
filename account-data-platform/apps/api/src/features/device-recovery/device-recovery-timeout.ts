import type { DeviceRecoveryErrorCode, DeviceRecoveryStage } from "@pkg/types";
import type { DeviceRecoverySessionRecord } from "./device-recovery.repository";

const timeoutRules: Partial<Record<DeviceRecoveryStage, {
  timeoutMs: number;
  errorCode: DeviceRecoveryErrorCode;
  message: string;
}>> = {
  WAITING_DEVICE: {
    timeoutMs: 60_000,
    errorCode: "DEVICE_UNREACHABLE",
    message: "Device did not become reachable. Confirm the phone is powered on."
  },
  SYSTEM_BOOTED: {
    timeoutMs: 120_000,
    errorCode: "NETWORK_READY_TIMEOUT",
    message: "Phone started but network readiness was not reported within 120 seconds."
  },
  NETWORK_CONNECTED: {
    timeoutMs: 30_000,
    errorCode: "AGENT_LAUNCH_TIMEOUT",
    message: "Network connected but the Agent did not launch within 30 seconds."
  },
  AGENT_LAUNCHED: {
    timeoutMs: 60_000,
    errorCode: "DEVICE_REGISTRATION_TIMEOUT",
    message: "Agent launched but device registration did not complete within 60 seconds."
  },
  DEVICE_REGISTERED: {
    timeoutMs: 60_000,
    errorCode: "HEARTBEAT_RESTORE_TIMEOUT",
    message: "Device registered but heartbeat did not recover within 60 seconds."
  },
  HEARTBEAT_RESTORED: {
    timeoutMs: 60_000,
    errorCode: "COMMAND_CHANNEL_TIMEOUT",
    message: "Heartbeat recovered but the command channel was not ready within 60 seconds."
  }
};

export function evaluateDeviceRecoveryTimeout(session: DeviceRecoverySessionRecord, at = new Date()) {
  if (session.resultStatus || session.stage === "COMMAND_CHANNEL_READY") return null;
  const rule = timeoutRules[session.stage];
  if (!rule) return null;
  const deadlineAt = new Date(session.lastStageAt.getTime() + rule.timeoutMs);
  if (at.getTime() <= deadlineAt.getTime()) return null;
  return {
    resultStatus: "TIMED_OUT" as const,
    errorCode: rule.errorCode,
    errorMessage: rule.message,
    completedAt: at,
    deadlineAt
  };
}

export function projectDeviceRecovery(session: DeviceRecoverySessionRecord, at = new Date()) {
  const rule = timeoutRules[session.stage];
  const endAt = session.completedAt ?? at;
  const deadlineAt = !session.resultStatus && rule
    ? new Date(session.lastStageAt.getTime() + rule.timeoutMs)
    : undefined;
  return {
    active: !session.resultStatus && session.stage !== "COMMAND_CHANNEL_READY",
    deadlineAt: deadlineAt?.toISOString(),
    elapsedMs: Math.max(0, endAt.getTime() - session.startedAt.getTime()),
    remainingMs: deadlineAt ? Math.max(0, deadlineAt.getTime() - at.getTime()) : 0,
    requiresUserAction: session.errorCode === "DEVICE_UNREACHABLE" ||
      session.errorCode === "SECURE_KEYGUARD_REQUIRES_USER"
  };
}
