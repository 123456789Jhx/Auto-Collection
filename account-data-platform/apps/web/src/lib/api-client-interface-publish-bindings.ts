import { put, remove, request } from "./api-client";

export type InterfacePublishBindingStatus =
  | "MATCHED"
  | "BINDING_INCOMPLETE"
  | "BINDING_CONFLICT"
  | "DEVICE_OFFLINE"
  | "DEVICE_BUSY"
  | "UNBOUND";

export type InterfacePublishBindingRecord = {
  deviceId: string | null;
  deviceCode: string;
  deviceName: string | null;
  deviceStatus: string;
  lastHeartbeatAt: string | null;
  bindingId: string | null;
  accountName: string | null;
  accountNo: string | null;
  externalAccountKey: string | null;
  bindingEnabled: boolean | null;
  activeAssignmentId: string | null;
};

export type InterfacePublishBindingPreflightRecord = {
  bindingId: string | null;
  deviceId: string | null;
  deviceCode: string;
  deviceName: string | null;
  accountName: string | null;
  accountNo: string | null;
  externalAccountKey: string | null;
  status: InterfacePublishBindingStatus;
};

export type SaveInterfacePublishBindingPayload = {
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  enabled: boolean;
};

const bindingsPath = "/admin/interface-publish/bindings";

export function getInterfacePublishBindings() {
  return request<{ data: InterfacePublishBindingRecord[] }>(bindingsPath);
}

export function saveInterfacePublishBinding(
  deviceCode: string,
  payload: SaveInterfacePublishBindingPayload
) {
  return put<{ data: unknown }>(`${bindingsPath}/${encodeURIComponent(deviceCode)}`, payload);
}

export function removeInterfacePublishBinding(deviceCode: string) {
  return remove<{ data: { deleted: true; deviceCode: string } }>(
    `${bindingsPath}/${encodeURIComponent(deviceCode)}`
  );
}

export function getInterfacePublishBindingPreflight() {
  return request<{ data: InterfacePublishBindingPreflightRecord[] }>(`${bindingsPath}/preflight`);
}
