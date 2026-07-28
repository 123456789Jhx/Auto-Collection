import type {
  CreateRemoteScriptConfigPayload,
  RemoteScriptConfigListQuery,
  UpdateRemoteScriptConfigPayload
} from "@pkg/types";
import { mutate, patch, remove, request } from "./api-client";

export type RemoteScriptStatus = "ENABLED" | "DISABLED";

export type RemoteScriptDefinition = {
  id: string;
  scriptKey: string;
  scriptName?: string;
  displayName?: string;
  description?: string | null;
  version?: string;
  configSchema: Record<string, unknown>;
  status: RemoteScriptStatus;
  updatedAt: string;
};

export type RemoteScriptConfig = {
  id: string;
  tenantId: string;
  scriptKey: string;
  configName: string;
  configPayload: Record<string, unknown>;
  configHash: string;
  revision: number;
  status: RemoteScriptStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  bindingCount: number;
};

export type RemoteScriptBinding = {
  id: string;
  configId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  priority: number;
  enabled: boolean;
  updatedAt: string;
};

export type RemoteScriptConfigPage = {
  data: RemoteScriptConfig[];
  page: number;
  pageSize: number;
  total: number;
};

export function getRemoteScriptDefinitions() {
  return request<RemoteScriptDefinition[]>("/admin/remote-scripts/definitions");
}

export function getRemoteScriptConfigs(query: RemoteScriptConfigListQuery) {
  return request<RemoteScriptConfigPage>("/admin/remote-scripts/configs", query);
}

export function createRemoteScriptConfig(payload: CreateRemoteScriptConfigPayload) {
  return mutate<RemoteScriptConfig>("/admin/remote-scripts/configs", payload);
}

export function updateRemoteScriptConfig(id: string, payload: UpdateRemoteScriptConfigPayload) {
  return patch<RemoteScriptConfig>(`/admin/remote-scripts/configs/${encodeURIComponent(id)}`, payload);
}

export function deleteRemoteScriptConfig(id: string) {
  return remove<{ success: boolean }>(`/admin/remote-scripts/configs/${encodeURIComponent(id)}`);
}

export function getRemoteScriptBindings(configId: string) {
  return request<{ data: RemoteScriptBinding[] }>(
    `/admin/remote-scripts/configs/${encodeURIComponent(configId)}/bindings`
  );
}

export function bindRemoteScriptDevice(configId: string, payload: { deviceCode: string; priority: number }) {
  return mutate<RemoteScriptBinding>(
    `/admin/remote-scripts/configs/${encodeURIComponent(configId)}/bindings`,
    payload
  );
}

export function unbindRemoteScriptDevice(configId: string, deviceCode: string) {
  return remove<unknown>(
    `/admin/remote-scripts/configs/${encodeURIComponent(configId)}/bindings/${encodeURIComponent(deviceCode)}`
  );
}
