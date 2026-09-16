import type { BizScriptDevice, BizScriptPreview, BizScriptPreviewInput, BizScriptScopeInput, BizScriptWorkspace } from "@pkg/types";
import { mutate, request } from "./api-client";

const root = "/admin/remote-scripts";
export const bizScriptWorkspaceKey = ["bizScriptWorkspace"] as const;
export const bizScriptPreviewsKey = ["bizScriptPreviews"] as const;
export const bizScriptDevicesKey = ["bizScriptWorkspaceDevices"] as const;

export function getBizScriptWorkspace() {
  return request<BizScriptWorkspace>(`${root}/workspace`);
}

export function getBizScriptPreviews() {
  return request<{ data: BizScriptPreview[] }>(`${root}/previews`);
}

export function getBizScriptWorkspaceDevices() {
  return request<{ data: BizScriptDevice[] }>(`${root}/workspace/devices`);
}

export function createBizScriptPreview(input: BizScriptPreviewInput) {
  return mutate<BizScriptPreview>(`${root}/previews`, input, true, 120_000);
}

export function testBizScriptPreview(id: string, input: BizScriptScopeInput) {
  return mutate<BizScriptPreview>(`${root}/previews/${encodeURIComponent(id)}/test`, input);
}

export function promoteBizScriptPreview(id: string, input: BizScriptScopeInput) {
  return mutate<BizScriptPreview>(`${root}/previews/${encodeURIComponent(id)}/promote`, input);
}

export function revokeBizScriptPreview(id: string, revision: number) {
  return mutate<BizScriptPreview>(`${root}/previews/${encodeURIComponent(id)}/revoke`, { revision });
}
