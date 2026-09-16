import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";

export type BizScriptEventEvidence = {
  eventType: string;
  toVersion: string | null;
  message: string | null;
  createdAt: Date;
  payloadJson: Record<string, unknown> | null;
};

export type BizScriptDeviceEvidence = {
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  enabled: boolean;
  heartbeatAt: Date | null;
  rawPayload: Record<string, unknown> | null;
  latestEvent: BizScriptEventEvidence | null;
  latestFailure: BizScriptEventEvidence | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function compareBizScriptVersions(left: string, right: string): number {
  if (!/^\d+(?:\.\d+)*$/.test(left) || !/^\d+(?:\.\d+)*$/.test(right)) return NaN;
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0n) - (b[index] ?? 0n);
    if (delta !== 0n) return delta > 0n ? 1 : -1;
  }
  return 0;
}

export function isBizScriptActuallyLoaded(device: BizScriptDevice, preview: BizScriptPreview): boolean {
  return device.enabled && device.fresh && device.hotUpdateAllowed && device.source === "overlay"
    && device.state !== "FAILED" && device.state !== "REJECTED"
    && device.currentVersion === preview.version && device.sourceSha256 === preview.sourceSha256
    && device.baseCompatibilityId === preview.baseCompatibilityId;
}

export function deriveBizScriptDevice(
  evidence: BizScriptDeviceEvidence,
  target: BizScriptPreview | null,
  previews: BizScriptPreview[],
  now = new Date()
): BizScriptDevice {
  const runtime = record(evidence.rawPayload?.bizScriptRuntime);
  const source = runtime.source === "overlay" || runtime.source === "baseline" ? runtime.source : null;
  const currentVersion = text(runtime.version);
  const baseCompatibilityId = text(runtime.baseCompatibilityId);
  const sourceSha256 = text(runtime.sourceSha256);
  const age = evidence.heartbeatAt ? now.getTime() - evidence.heartbeatAt.getTime() : Infinity;
  const fresh = age >= 0 && age <= 90_000;
  const metadataValid = Boolean(source && currentVersion && text(runtime.baselineVersion) && text(runtime.apkBuildId)
    && baseCompatibilityId && /^[a-f0-9]{64}$/i.test(baseCompatibilityId)
    && sourceSha256 && /^[a-f0-9]{64}$/i.test(sourceSha256)
    && Number.isFinite(compareBizScriptVersions(currentVersion, text(runtime.baselineVersion) ?? "")));
  const device: BizScriptDevice = {
    deviceId: evidence.deviceId, deviceCode: evidence.deviceCode, deviceName: evidence.deviceName,
    enabled: evidence.enabled, lastHeartbeatAt: evidence.heartbeatAt?.toISOString() ?? null,
    currentVersion, pendingVersion: text(evidence.rawPayload?.pendingBizScriptsVersion), source,
    baseCompatibilityId, sourceSha256, hotUpdateAllowed: metadataValid && runtime.hotUpdateAllowed === true,
    fresh, targetVersion: target?.version ?? null, state: "UNKNOWN", eventMessage: null
  };
  const failure = evidence.latestFailure;
  const failedPreview = failure && previews.find((preview) => preview.version === failure.toVersion);
  const recoveredPreview = failure && previews.find((preview) => isBizScriptActuallyLoaded(device, preview)
    && compareBizScriptVersions(preview.version, failure.toVersion ?? "") >= 0
    && (!failedPreview || preview.baseCompatibilityId === failedPreview.baseCompatibilityId));
  const recovered = Boolean(failure && recoveredPreview && evidence.heartbeatAt
    && evidence.heartbeatAt.getTime() > failure.createdAt.getTime()
    && !text(runtime.rejectionReason));
  if (failure && !recovered) {
    device.state = "FAILED";
    device.eventMessage = failure.message;
  } else if (text(runtime.rejectionReason)) {
    device.state = "REJECTED";
    device.eventMessage = text(runtime.rejectionReason);
  } else if (!evidence.heartbeatAt) {
    device.state = "UNKNOWN";
  } else if (!fresh || !evidence.enabled) {
    device.state = "OFFLINE";
  } else if (!device.hotUpdateAllowed || (target && target.baseCompatibilityId !== baseCompatibilityId)) {
    device.state = "NEEDS_APK";
  } else if (target && isBizScriptActuallyLoaded(device, target)) {
    device.state = "CURRENT";
  } else if ((device.pendingVersion && device.pendingVersion !== currentVersion)
    || (evidence.latestEvent?.eventType === "APPLIED" && evidence.latestEvent.toVersion !== currentVersion
      && (!evidence.heartbeatAt || evidence.latestEvent.createdAt > evidence.heartbeatAt))) {
    device.state = "PENDING_RESTART";
  } else {
    device.state = target ? "PENDING" : "READY";
  }
  return device;
}
