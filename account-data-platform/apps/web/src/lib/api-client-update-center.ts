import { mutate, request } from "./api-client";

const bizScriptBuildTimeoutMs = 310_000;

export type BizScriptReleaseStatus = "DRAFT" | "PUBLISHED" | "REVOKED";
export type AgentReleaseStatus = BizScriptReleaseStatus;
export type AgentReleaseChannel = "stable" | "gray" | "dev" | "biz-scripts";

export type BizScriptRelease = {
  id: string;
  version: string;
  channel: "biz-scripts";
  packageUrl: string | null;
  sha256: string | null;
  entryFile: string;
  releaseNote: string | null;
  status: BizScriptReleaseStatus;
  publishedAt: string | null;
  createdAt: string;
  idempotent?: boolean;
};

export type PublishBizScriptReleasePayload = {
  version: string;
  packageUrl: string;
  sha256: string;
  releaseNote?: string;
};

export type BuildBizScriptReleasePayload = {
  releaseNote?: string;
  forceUpdate?: boolean;
  files?: string[];
  baseVersion?: string;
};

export type BizScriptFileCatalog = { data: string[] };

export type DeviceUpdateStatus = {
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  deviceStatus: string;
  lastHeartbeatAt: string | null;
  currentVersion: string | null;
  targetVersion: string | null;
  updateStatus: string | null;
  eventMessage: string | null;
  updatedAt: string | null;
  isCurrent: boolean;
};

export type DeviceUpdateSummary = {
  total: number;
  applied: number;
  pending: number;
  failed: number;
  noReport: number;
};

export type BizScriptReleasePage = { data: BizScriptRelease[] };
export type AgentRelease = {
  id: string;
  version: string;
  channel: AgentReleaseChannel;
  minSupportedVersion: string | null;
  packageUrl: string | null;
  sha256: string | null;
  entryFile: string;
  releaseNote: string | null;
  forceUpdate: boolean;
  status: AgentReleaseStatus;
  publishedAt: string | null;
  createdAt: string;
};

export type AgentReleasePage = { data: AgentRelease[] };

export type DeviceUpdateStatusPage = {
  data: DeviceUpdateStatus[];
  targetVersion: string | null;
  summary: DeviceUpdateSummary;
};

export function publishBizScriptRelease(payload: PublishBizScriptReleasePayload) {
  return mutate<BizScriptRelease>("/admin/remote-scripts/releases", {
    ...payload,
    sha256: payload.sha256.toLowerCase(),
    channel: "biz-scripts",
    entryFile: "biz-script-manifest.json",
    status: "PUBLISHED",
    forceUpdate: false
  });
}

export function buildAndPublishBizScripts(payload: BuildBizScriptReleasePayload) {
  return mutate<BizScriptRelease>("/admin/remote-scripts/releases/build", payload, true, bizScriptBuildTimeoutMs);
}

export function getBizScriptReleases() {
  return request<BizScriptReleasePage>("/admin/remote-scripts/releases", {
    channel: "biz-scripts",
    limit: 100
  });
}

export function getAgentReleases(channel: AgentReleaseChannel = "stable") {
  return request<AgentReleasePage>("/admin/remote-scripts/releases", {
    channel: channel,
    limit: 100
  });
}

export function getBizScriptFiles() {
  return request<BizScriptFileCatalog>("/admin/remote-scripts/files", { roots: "features,domain" });
}

export function getDeviceUpdateStatuses() {
  return getAgentDeviceUpdateStatuses("biz-scripts");
}

export function getAgentDeviceUpdateStatuses(channel: AgentReleaseChannel = "stable") {
  return request<DeviceUpdateStatusPage>("/admin/remote-scripts/device-update-status", {
    channel: channel
  });
}
