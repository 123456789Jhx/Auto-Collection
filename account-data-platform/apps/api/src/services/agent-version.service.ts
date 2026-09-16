import type {
  AgentUpdateEventListQuery,
  AgentVersionListQuery,
  CreateAgentVersionPayload,
  MobileAgentUpdateEventPayload
} from "@pkg/types";
import { config } from "../config";
import {
  createAgentUpdateEvent,
  createAgentVersion,
  findAgentVersion,
  findLatestPublishedAgentVersion,
  listAgentUpdateEvents,
  listAgentVersions,
  listDevicesWithUpdateEvents
} from "../repositories/agent-version.repository";
import { findDeviceByToken, resolveDeviceByToken } from "../repositories/device.repository";
import { parseOptionalDate } from "../lib/date";
import { findScopedBizScriptVersion, listBizScriptDevices } from "./biz-script-delivery.service";

function compareVersion(left: string, right: string) {
  const leftParts = left.split(".").map((item) => Number(item) || 0);
  const rightParts = right.split(".").map((item) => Number(item) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveVersionDevice(deviceId: string, appVersion?: string, deviceToken?: string) {
  if (!deviceToken) {
    throw new Error("DEVICE_TOKEN_REQUIRED");
  }
  return resolveDeviceByToken({ deviceToken, appVersion, expectedDeviceCode: deviceId });
}

async function resolveBizScriptDevice(deviceId: string, deviceToken?: string) {
  if (!deviceToken) throw new Error("DEVICE_TOKEN_REQUIRED");
  const device = await findDeviceByToken(deviceToken);
  if (!device) throw new Error("DEVICE_UNREGISTERED");
  if (!device.enabled) throw new Error("DEVICE_DISABLED");
  if (device.deviceCode !== deviceId) throw new Error("DEVICE_TOKEN_MISMATCH");
  return device;
}

export class AgentVersionServiceError extends Error {
  constructor(
    readonly code: "VERSION_CONFLICT" | "SCOPED_RELEASE_REQUIRED",
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export async function getAgentVersionCheck(deviceId: string, currentVersion: string, channel = "stable", deviceToken?: string) {
  const isBizScript = channel === "biz-scripts";
  const device = await (isBizScript ? resolveBizScriptDevice(deviceId, deviceToken)
    : resolveVersionDevice(deviceId, currentVersion, deviceToken));
  const latest = await (isBizScript ? findScopedBizScriptVersion(device.id, currentVersion)
    : findLatestPublishedAgentVersion(channel));
  if (!latest) {
    return {
      deviceId: device.deviceCode,
      currentVersion,
      updateAvailable: false,
      forceUpdate: false
    };
  }

  const updateAvailable = compareVersion(currentVersion, latest.version) < 0;
  const belowMinSupported = latest.minSupportedVersion ? compareVersion(currentVersion, latest.minSupportedVersion) < 0 : false;
  return {
    deviceId: device.deviceCode,
    currentVersion,
    updateAvailable,
    forceUpdate: latest.forceUpdate || belowMinSupported,
    latestVersion: {
      id: latest.id,
      version: latest.version,
      channel: latest.channel,
      minSupportedVersion: latest.minSupportedVersion,
      packageUrl: latest.packageUrl,
      sha256: latest.sha256,
      entryFile: latest.entryFile,
      releaseNote: latest.releaseNote,
      publishedAt: latest.publishedAt
    }
  };
}

export async function getAgentVersions(query?: Partial<AgentVersionListQuery>) {
  return listAgentVersions(query?.limit ?? 100, query?.channel);
}

export async function publishAgentVersion(payload: CreateAgentVersionPayload) {
  if (payload.channel === "biz-scripts") {
    throw new AgentVersionServiceError("SCOPED_RELEASE_REQUIRED", "业务脚本请通过目录预览、指定试运行设备和推广流程发布");
  }
  const existing = await findAgentVersion(payload.channel, payload.version);
  if (existing) return resolveExistingVersion(existing, payload);
  const values = {
    tenantId: config.tenantId,
    version: payload.version,
    channel: payload.channel,
    minSupportedVersion: payload.minSupportedVersion,
    packageUrl: payload.packageUrl,
    sha256: payload.sha256,
    entryFile: payload.entryFile,
    releaseNote: payload.releaseNote,
    forceUpdate: payload.forceUpdate,
    status: payload.status,
    publishedAt: new Date(),
    createdBy: "admin",
    updatedBy: "admin"
  };
  try {
    return { ...await createAgentVersion(values), idempotent: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrent = await findAgentVersion(payload.channel, payload.version);
    if (!concurrent) throw error;
    return resolveExistingVersion(concurrent, payload);
  }
}

type SavedAgentVersion = NonNullable<Awaited<ReturnType<typeof findAgentVersion>>>;

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function resolveExistingVersion(existing: SavedAgentVersion, payload: CreateAgentVersionPayload) {
  const same = existing.packageUrl === (payload.packageUrl ?? null)
    && (existing.sha256?.toLowerCase() ?? null) === (payload.sha256?.toLowerCase() ?? null)
    && existing.entryFile === payload.entryFile
    && existing.status === payload.status
    && existing.forceUpdate === payload.forceUpdate
    && existing.minSupportedVersion === (payload.minSupportedVersion ?? null)
    && existing.releaseNote === (payload.releaseNote ?? null);
  if (!same) {
    throw new AgentVersionServiceError(
      "VERSION_CONFLICT",
      "同一通道下该版本已存在，但包地址、哈希或入口文件不同",
      { channel: payload.channel, version: payload.version, existingId: existing.id }
    );
  }
  return { ...existing, idempotent: true };
}

export function getAgentUpdateEvents(query: AgentUpdateEventListQuery) {
  return listAgentUpdateEvents(query);
}

export async function getAgentDeviceUpdateStatus(channel: string) {
  if (channel === "biz-scripts") {
    const devices = await listBizScriptDevices();
    const data = devices.map((device) => ({
      ...device, deviceStatus: device.fresh ? "online" : "offline", updateStatus: device.state,
      updatedAt: device.lastHeartbeatAt, isCurrent: device.state === "CURRENT"
    }));
    const summary = data.reduce((counts, device) => {
      if (device.isCurrent) counts.applied += 1;
      else if (device.state === "FAILED" || device.state === "REJECTED") counts.failed += 1;
      else if (!device.currentVersion) counts.noReport += 1;
      else counts.pending += 1;
      return counts;
    }, { total: data.length, applied: 0, pending: 0, failed: 0, noReport: 0 });
    return { data, targetVersion: null, summary };
  }
  const [latest, rows] = await Promise.all([
    findLatestPublishedAgentVersion(channel),
    listDevicesWithUpdateEvents(channel)
  ]);
  const seen = new Set<string>();
  const data = rows.flatMap((row) => {
    if (seen.has(row.deviceId)) return [];
    seen.add(row.deviceId);
    const currentVersion = row.updateStatus === "APPLIED" ? row.toVersion : row.fromVersion;
    return [{
      deviceId: row.deviceId,
      deviceCode: row.deviceCode,
      deviceName: row.deviceName,
      deviceStatus: row.deviceStatus,
      lastHeartbeatAt: row.lastHeartbeatAt,
      currentVersion,
      targetVersion: latest?.version ?? null,
      updateStatus: row.updateStatus,
      eventMessage: row.eventMessage,
      updatedAt: row.eventCreatedAt,
      isCurrent: Boolean(latest && currentVersion === latest.version)
    }];
  });
  const summary = data.reduce((counts, item) => {
    if (!item.updateStatus) counts.noReport += 1;
    else if (item.updateStatus === "FAILED" || item.updateStatus === "ROLLBACK") counts.failed += 1;
    else if (item.isCurrent) counts.applied += 1;
    else counts.pending += 1;
    return counts;
  }, { total: data.length, applied: 0, pending: 0, failed: 0, noReport: 0 });
  return { data, targetVersion: latest?.version ?? null, summary };
}

export async function saveAgentUpdateEvent(payload: MobileAgentUpdateEventPayload, deviceToken?: string) {
  const channel = typeof payload.payload?.channel === "string" ? payload.payload.channel : "stable";
  const isBizScriptEvent = channel === "biz-scripts";
  const device = await (isBizScriptEvent ? resolveBizScriptDevice(payload.deviceId, deviceToken)
    : resolveVersionDevice(payload.deviceId, payload.fromVersion, deviceToken));
  const savedVersion = payload.toVersion ? await findAgentVersion(channel, payload.toVersion) : null;
  return createAgentUpdateEvent({
    tenantId: config.tenantId,
    deviceId: device.id,
    agentVersionId: savedVersion?.id,
    fromVersion: payload.fromVersion,
    toVersion: payload.toVersion,
    eventType: payload.eventType,
    message: payload.message,
    payloadJson: payload.payload,
    reportedAt: parseOptionalDate(payload.reportedAt),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}
