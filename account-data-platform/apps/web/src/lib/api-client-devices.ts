import type { DeviceAccountBinding } from "@pkg/types";
import { patch } from "./api-client";

export type { DeviceAccountBinding };

export function updateDeviceAccountBinding(deviceCode: string, accountProfile: DeviceAccountBinding) {
  return patch<{ accountProfile: DeviceAccountBinding }>(
    `/admin/devices/${encodeURIComponent(deviceCode)}`,
    { accountProfile }
  );
}
