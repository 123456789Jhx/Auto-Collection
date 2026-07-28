import type { DeviceAccountBinding } from "@pkg/types";
import { patch } from "./api-client";

export type { DeviceAccountBinding };

export type DeviceAccountProfile = DeviceAccountBinding | Record<string, never>;

export function updateDeviceAccountBinding(deviceCode: string, accountProfile: DeviceAccountProfile) {
  return patch<{ accountProfile: DeviceAccountProfile }>(
    `/admin/devices/${encodeURIComponent(deviceCode)}`,
    { accountProfile }
  );
}
