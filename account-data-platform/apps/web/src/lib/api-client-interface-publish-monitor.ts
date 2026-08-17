import type {
  InterfacePublishErrorCategory,
  InterfacePublishReservationStatus,
  InterfacePublishRunStatus,
  InterfacePublishSlot,
  InterfacePublishSlotStatus
} from "@pkg/types";
import { mutate, request } from "./api-client";

export type InterfacePublishMonitorRun = {
  id: string;
  status: InterfacePublishRunStatus;
  configId: string;
  morningPublishTime: string;
  afternoonPublishTime: string;
  maxConcurrentPublishing: number;
  noMaterialRetryMinutes: number;
  startedBy: string;
  startedAt: string;
  stoppedAt: string | null;
};

export type InterfacePublishMonitorBinding = {
  id: string;
  bindingId: string;
  deviceId: string;
  deviceCode: string;
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  status: string;
  reservationStatus: InterfacePublishReservationStatus;
  reservationReason: string | null;
  nextReservationRetryAt: string | null;
  skippedForRun: boolean;
};

export type InterfacePublishMonitorSlot = {
  id: string;
  bindingId: string;
  businessDate: string;
  slot: InterfacePublishSlot;
  status: InterfacePublishSlotStatus;
  publishTaskId: string | null;
  externalTaskId: string | null;
  nextRetryAt: string | null;
  attemptCount: number;
  errorCategory: InterfacePublishErrorCategory | null;
  lastError: string | null;
  publishedAt: string | null;
};

export type InterfacePublishMonitorAlert = {
  id: string;
  runId: string;
  slotExecutionId: string | null;
  code: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  detailsJson: Record<string, unknown> | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type InterfacePublishRunDetails = {
  run: InterfacePublishMonitorRun;
  bindings: InterfacePublishMonitorBinding[];
  slots: InterfacePublishMonitorSlot[];
  alerts: InterfacePublishMonitorAlert[];
};

const monitorPath = "/admin/interface-publish/monitor";

export function getInterfacePublishRunDetails(runId: string) {
  return request<{ data: InterfacePublishRunDetails }>(
    `${monitorPath}/runs/${encodeURIComponent(runId)}`
  );
}

export function markInterfacePublishAlertRead(alertId: string) {
  return mutate<{ data: unknown }>(`${monitorPath}/alerts/${encodeURIComponent(alertId)}/read`, {});
}

export function resolveInterfacePublishResultUnknown(
  publishTaskId: string,
  payload: { resolution: "PUBLISHED" | "FAILED"; evidence: string }
) {
  return mutate<{ data: unknown }>(
    `${monitorPath}/tasks/${encodeURIComponent(publishTaskId)}/resolve-result`,
    payload
  );
}

export function resolveInterfacePublishClaimUnknown(slotExecutionId: string, evidence: string) {
  return mutate<{ data: unknown }>(
    `${monitorPath}/slots/${encodeURIComponent(slotExecutionId)}/resolve-claim`,
    { resolution: "SAFE_TO_RETRY", evidence }
  );
}
