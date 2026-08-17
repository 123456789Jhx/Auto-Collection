import { mutate, request } from "./api-client";

export type SingleInterfacePublishStatus =
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "SUCCEEDED"
  | "FAILED";

export type SingleInterfacePublishRun = {
  runId?: string | null;
  taskId?: string | null;
  externalTaskId?: string | null;
  deviceCode?: string | null;
  deviceName?: string | null;
  deviceStatus?: string | null;
  accountName?: string | null;
  douyinId?: string | null;
  title?: string | null;
  status: SingleInterfacePublishStatus;
  error?: string | null;
  updatedAt?: string | null;
};

export function startSingleInterfacePublish() {
  return mutate<SingleInterfacePublishRun>("/admin/single-interface-publish/start", {});
}

export function getCurrentSingleInterfacePublish() {
  return request<SingleInterfacePublishRun>("/admin/single-interface-publish/current");
}

export function stopSingleInterfacePublish() {
  return mutate<SingleInterfacePublishRun>("/admin/single-interface-publish/stop", {});
}
