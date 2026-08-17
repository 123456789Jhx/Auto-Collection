import type {
  DeviceRecoveryErrorCode,
  DeviceRecoveryResultStatus,
  DeviceRecoverySource,
  DeviceRecoveryStage
} from "@pkg/types";
import { ApiError, request } from "../../lib/api-client";

export type DeviceRecoveryTimeline = {
  session: {
    sessionId: string;
    deviceId: string;
    commandId?: string;
    bootId?: string;
    source: DeviceRecoverySource;
    channel?: "AGENT_POLL" | "XIAOMI_PUSH";
    stage: DeviceRecoveryStage;
    resultStatus?: DeviceRecoveryResultStatus;
    errorCode?: DeviceRecoveryErrorCode;
    errorMessage?: string;
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
  };
  events: Array<{
    eventId: string;
    eventKey: string;
    stage: DeviceRecoveryStage;
    occurredAt: string;
    reportedAt: string;
    details?: Record<string, unknown>;
  }>;
  projection: {
    active: boolean;
    deadlineAt?: string;
    elapsedMs: number;
    remainingMs: number;
    requiresUserAction: boolean;
  };
};

export async function getLatestDeviceRecovery(deviceId: string) {
  try {
    return await request<{ data: DeviceRecoveryTimeline | null }>(
      `/admin/device-recovery/devices/${encodeURIComponent(deviceId)}/latest`
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === "RECOVERY_SESSION_NOT_FOUND") {
      return { data: null };
    }
    throw error;
  }
}
