import type { PublishAccountBinding, PublishDeviceSchedule } from "@pkg/types";
import { mutate, put, request } from "./api-client";

export type PublishScheduleConnectionResult = {
  reachable: true;
  httpStatus: number;
  message: string;
};

export function testPublishScheduleConnection(configId: string) {
  return mutate<PublishScheduleConnectionResult>(
    `/admin/publish-schedules/${encodeURIComponent(configId)}/test-connection`,
    {}
  );
}

export type PublishAccountBindingRecord = PublishAccountBinding & {
  id: string;
  accountNo: string | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type PublishDeviceScheduleRecord = PublishDeviceSchedule & {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export function getPublishAccountBindings(deviceCode?: string) {
  return request<{ data: PublishAccountBindingRecord[] }>(
    "/admin/publish-schedules/device-bindings",
    deviceCode ? { deviceCode } : undefined
  );
}

export function savePublishAccountBinding(payload: PublishAccountBinding) {
  return put<PublishAccountBindingRecord>("/admin/publish-schedules/device-bindings", payload);
}

export function getPublishDevicePlans(configId?: string) {
  return request<{ data: PublishDeviceScheduleRecord[] }>(
    "/admin/publish-schedules/device-plans",
    configId ? { configId } : undefined
  );
}

export function savePublishDevicePlan(payload: PublishDeviceSchedule) {
  return put<PublishDeviceScheduleRecord>("/admin/publish-schedules/device-plans", payload);
}
