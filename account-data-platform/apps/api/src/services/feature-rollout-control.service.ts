import type {
  CommerceCardAgentCapabilities,
  FeatureRolloutControl,
  FeatureRolloutControlUpdate,
  FeatureRolloutKey
} from "@pkg/types";
import { findDeviceByCode } from "../repositories/device.repository";
import {
  findFeatureRolloutControlRow,
  listFeatureRolloutAllowlistRows,
  listFeatureRolloutControlRows,
  updateFeatureRolloutControlAggregate
} from "../repositories/feature-rollout.repository";

const activationReadyByFeature: Record<FeatureRolloutKey, boolean> = {
  commerce_card_workflow_v2: false,
  commerce_card_real_comment: false
};

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapControl(
  row: Awaited<ReturnType<typeof listFeatureRolloutControlRows>>[number],
  deviceCodes: string[]
): FeatureRolloutControl {
  const featureKey = row.featureKey as FeatureRolloutKey;
  return {
    featureKey,
    enabled: row.enabled,
    revision: row.revision,
    minAppVersion: row.minAppVersion,
    requiredCapabilities: row.requiredCapabilitiesJson,
    capabilityTtlSeconds: row.capabilityTtlSeconds,
    deviceCodes,
    activationReady: activationReadyByFeature[featureKey],
    reason: row.reason,
    updatedBy: row.updatedBy,
    updatedAt: toIsoString(row.updatedAt)
  };
}

export async function listFeatureRolloutControls(): Promise<FeatureRolloutControl[]> {
  const [controls, allowlist] = await Promise.all([
    listFeatureRolloutControlRows(),
    listFeatureRolloutAllowlistRows()
  ]);
  return controls.map((control) => mapControl(
    control,
    allowlist
      .filter((item) => item.featureKey === control.featureKey)
      .map((item) => item.deviceCode)
  ));
}

export async function getFeatureRolloutControl(featureKey: FeatureRolloutKey) {
  const [control, allowlist] = await Promise.all([
    findFeatureRolloutControlRow(featureKey),
    listFeatureRolloutAllowlistRows([featureKey])
  ]);
  return control ? mapControl(control, allowlist.map((item) => item.deviceCode)) : null;
}

export async function updateFeatureRolloutControl(
  featureKey: FeatureRolloutKey,
  payload: FeatureRolloutControlUpdate,
  actor: string
) {
  if (payload.enabled && !activationReadyByFeature[featureKey]) {
    throw new FeatureActivationNotReadyError(featureKey);
  }
  await updateFeatureRolloutControlAggregate({ featureKey, ...payload, actor });
  return getFeatureRolloutControl(featureKey);
}

function versionParts(value: string) {
  return value.split(/[^0-9]+/).filter(Boolean).map((part) => Number(part));
}

function isVersionAtLeast(current: string | null, minimum: string | null) {
  if (!minimum) return true;
  if (!current) return false;
  const currentParts = versionParts(current);
  const minimumParts = versionParts(minimum);
  const length = Math.max(currentParts.length, minimumParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (currentParts[index] ?? 0) - (minimumParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function hasCapability(capabilities: CommerceCardAgentCapabilities, capability: string) {
  if (capability === "workflow_v2") return capabilities.workflowVersion >= 2;
  if (capability === "checkpoint_v2") return capabilities.checkpointVersion >= 2;
  if (capability === "pause_resume") return capabilities.pauseResume;
  if (capability === "stable_room_key") return capabilities.stableRoomKey;
  if (capability === "idempotent_comment") return capabilities.idempotentComment;
  if (capability === "short_lived_comment_permit") return capabilities.shortLivedCommentPermit;
  return false;
}

export async function evaluateFeatureRolloutForDevice(
  featureKey: FeatureRolloutKey,
  deviceCode: string
) {
  const [control, device] = await Promise.all([
    getFeatureRolloutControl(featureKey),
    findDeviceByCode(deviceCode)
  ]);
  const reasons: string[] = [];
  if (!control) reasons.push("FEATURE_CONTROL_MISSING");
  if (!device) reasons.push("DEVICE_UNREGISTERED");
  if (!control || !device) return { allowed: false, reasons, control, device };
  if (!control.activationReady) reasons.push("FEATURE_ACTIVATION_NOT_READY");
  if (!control.enabled) reasons.push("FEATURE_DISABLED");
  if (control.deviceCodes.length > 0 && !control.deviceCodes.includes(device.deviceCode)) {
    reasons.push("DEVICE_NOT_ALLOWLISTED");
  }
  if (!isVersionAtLeast(device.appVersion, control.minAppVersion)) {
    reasons.push("APP_VERSION_UNSUPPORTED");
  }
  const reportedAt = device.capabilitiesReportedAt ? new Date(device.capabilitiesReportedAt).getTime() : 0;
  if (!reportedAt || Date.now() - reportedAt > control.capabilityTtlSeconds * 1000) {
    reasons.push("CAPABILITIES_STALE");
  }
  const capabilities = device.capabilitiesJson as CommerceCardAgentCapabilities | null;
  if (!capabilities) {
    reasons.push("CAPABILITIES_MISSING");
  } else {
    for (const capability of control.requiredCapabilities) {
      if (!hasCapability(capabilities, capability)) {
        reasons.push(`CAPABILITY_MISSING:${capability}`);
      }
    }
  }
  return { allowed: reasons.length === 0, reasons, control, device };
}

export async function assertCommerceCardWorkflowV2Allowed(deviceCode: string) {
  const evaluation = await evaluateFeatureRolloutForDevice("commerce_card_workflow_v2", deviceCode);
  if (!evaluation.allowed) {
    throw new FeatureRolloutRejectedError(evaluation.reasons);
  }
  return evaluation;
}

export class FeatureActivationNotReadyError extends Error {
  readonly featureKey: FeatureRolloutKey;

  constructor(featureKey: FeatureRolloutKey) {
    super("FEATURE_ACTIVATION_NOT_READY");
    this.featureKey = featureKey;
  }
}

export class FeatureRolloutRejectedError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super("FEATURE_ROLLOUT_REJECTED");
    this.reasons = reasons;
  }
}
