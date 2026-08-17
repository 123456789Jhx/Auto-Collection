import type {
  InterfacePublishBindingStatus,
  InterfacePublishRunConfig,
  InterfacePublishRunStatus
} from "@pkg/types";
import { mutate, request } from "./api-client";

export type InterfacePublishRunRecord = InterfacePublishRunConfig & {
  id: string;
  status: InterfacePublishRunStatus;
};

export type InterfacePublishRunPreflightRow = {
  bindingId: string | null;
  deviceId: string | null;
  deviceCode: string;
  deviceName: string | null;
  accountName: string | null;
  accountNo: string | null;
  externalAccountKey: string | null;
  status: InterfacePublishBindingStatus;
};

export type InterfacePublishPreflightResponse = {
  run: InterfacePublishRunRecord;
  preflight: InterfacePublishRunPreflightRow[];
  startTime: {
    valid: boolean;
    businessDate: string;
    morning?: string;
    afternoon?: string;
  };
};

const runsPath = "/admin/interface-publish/runs";

export function getCurrentInterfacePublishRun() {
  return request<{ data: InterfacePublishRunRecord | null }>(`${runsPath}/current`);
}

export function preflightInterfacePublishRun(config: InterfacePublishRunConfig) {
  return mutate<{ data: InterfacePublishPreflightResponse }>(`${runsPath}/preflight`, config);
}

export function confirmInterfacePublishRun(runId: string, skippedBindingIds: string[]) {
  return mutate<{ data: { run: InterfacePublishRunRecord } }>(
    `${runsPath}/${encodeURIComponent(runId)}/confirm`,
    { skippedBindingIds }
  );
}

export function stopInterfacePublishRun(
  runId: string,
  confirmedDailyFallbackRisk: boolean
) {
  return mutate<{ data: InterfacePublishRunRecord }>(
    `${runsPath}/${encodeURIComponent(runId)}/stop`,
    { confirmedDailyFallbackRisk }
  );
}
