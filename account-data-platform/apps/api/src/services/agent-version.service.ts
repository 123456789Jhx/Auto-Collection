import type { CreateAgentVersionPayload, MobileAgentUpdateEventPayload } from "@pkg/types";
import { config } from "../config";
import { createAgentUpdateEvent, createAgentVersion, findLatestPublishedAgentVersion, listAgentVersions } from "../repositories/agent-version.repository";
import { resolveDeviceByToken } from "../repositories/device.repository";
import { parseOptionalDate } from "../lib/date";

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
  return resolveDeviceByToken({ deviceToken, appVersion });
}

export async function getAgentVersionCheck(deviceId: string, currentVersion: string, channel = "stable", deviceToken?: string) {
  const [device, latest] = await Promise.all([resolveVersionDevice(deviceId, currentVersion, deviceToken), findLatestPublishedAgentVersion(channel)]);
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

export async function getAgentVersions() {
  return listAgentVersions(100);
}

export async function publishAgentVersion(payload: CreateAgentVersionPayload) {
  return createAgentVersion({
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
  });
}

export async function saveAgentUpdateEvent(payload: MobileAgentUpdateEventPayload, deviceToken?: string) {
  const isBizScriptEvent = payload.payload?.channel === "biz-scripts";
  const device = await resolveVersionDevice(
    payload.deviceId,
    isBizScriptEvent ? undefined : payload.fromVersion,
    deviceToken
  );
  return createAgentUpdateEvent({
    tenantId: config.tenantId,
    deviceId: device.id,
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
