import {
  collectorDevices,
  featureRolloutControlEvents,
  featureRolloutControls,
  featureRolloutDeviceAllowlist
} from "@pkg/db/schema";
import type { FeatureRolloutKey } from "@pkg/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DefaultFeatureRolloutControl = Pick<
  typeof featureRolloutControls.$inferInsert,
  "featureKey" | "enabled" | "minAppVersion" | "requiredCapabilitiesJson" | "capabilityTtlSeconds" | "reason"
>;

const defaultFeatureRolloutControls: DefaultFeatureRolloutControl[] = [
  {
    featureKey: "commerce_card_workflow_v2",
    enabled: true,
    minAppVersion: "1.0.41",
    requiredCapabilitiesJson: ["workflow_v2", "checkpoint_v2", "pause_resume", "stable_room_key"],
    capabilityTtlSeconds: 600,
    reason: "商品卡养号启动链路已收敛，默认允许具备运行能力的 1.0.41+ 设备启动。"
  },
  {
    featureKey: "commerce_card_real_comment",
    enabled: false,
    minAppVersion: "1.0.41",
    requiredCapabilitiesJson: [
      "workflow_v2",
      "checkpoint_v2",
      "pause_resume",
      "stable_room_key",
      "idempotent_comment",
      "short_lived_comment_permit"
    ],
    capabilityTtlSeconds: 600,
    reason: "真实评论仍默认关闭，需运营明确开启全局开关并在目标配置中开启发送。"
  }
];

export async function ensureDefaultFeatureRolloutControls() {
  await db
    .insert(featureRolloutControls)
    .values(defaultFeatureRolloutControls.map((control) => ({
      tenantId: config.tenantId,
      ...control,
      createdBy: "system",
      updatedBy: "system"
    })))
    .onConflictDoNothing();
}

export async function listFeatureRolloutControlRows() {
  await ensureDefaultFeatureRolloutControls();
  return db
    .select()
    .from(featureRolloutControls)
    .where(and(
      eq(featureRolloutControls.tenantId, config.tenantId),
      isNull(featureRolloutControls.deletedAt)
    ))
    .orderBy(asc(featureRolloutControls.featureKey));
}

export async function findFeatureRolloutControlRow(featureKey: FeatureRolloutKey) {
  await ensureDefaultFeatureRolloutControls();
  const [row] = await db
    .select()
    .from(featureRolloutControls)
    .where(and(
      eq(featureRolloutControls.tenantId, config.tenantId),
      eq(featureRolloutControls.featureKey, featureKey),
      isNull(featureRolloutControls.deletedAt)
    ))
    .limit(1);
  return row ?? null;
}

export async function listFeatureRolloutAllowlistRows(featureKeys?: FeatureRolloutKey[]) {
  const filters = [
    eq(featureRolloutDeviceAllowlist.tenantId, config.tenantId),
    eq(featureRolloutDeviceAllowlist.enabled, true),
    isNull(featureRolloutDeviceAllowlist.deletedAt),
    isNull(collectorDevices.deletedAt)
  ];
  if (featureKeys?.length) {
    filters.push(inArray(featureRolloutDeviceAllowlist.featureKey, featureKeys));
  }
  return db
    .select({
      featureKey: featureRolloutDeviceAllowlist.featureKey,
      deviceId: featureRolloutDeviceAllowlist.deviceId,
      deviceCode: collectorDevices.deviceCode
    })
    .from(featureRolloutDeviceAllowlist)
    .innerJoin(collectorDevices, eq(featureRolloutDeviceAllowlist.deviceId, collectorDevices.id))
    .where(and(...filters))
    .orderBy(asc(featureRolloutDeviceAllowlist.featureKey), asc(collectorDevices.deviceCode));
}

export async function updateFeatureRolloutControlAggregate(input: {
  featureKey: FeatureRolloutKey;
  enabled: boolean;
  expectedRevision: number;
  minAppVersion: string | null;
  requiredCapabilities: string[];
  capabilityTtlSeconds: number;
  deviceCodes: string[];
  reason: string;
  actor: string;
}) {
  await ensureDefaultFeatureRolloutControls();
  return db.transaction(async (transaction) => {
    const [control] = await transaction
      .select()
      .from(featureRolloutControls)
      .where(and(
        eq(featureRolloutControls.tenantId, config.tenantId),
        eq(featureRolloutControls.featureKey, input.featureKey),
        isNull(featureRolloutControls.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (!control) {
      throw new Error("FEATURE_ROLLOUT_CONTROL_NOT_FOUND");
    }
    if (control.revision !== input.expectedRevision) {
      throw new FeatureControlRevisionConflictError(control.revision);
    }

    const devices = input.deviceCodes.length
      ? await transaction
          .select()
          .from(collectorDevices)
          .where(and(
            eq(collectorDevices.tenantId, config.tenantId),
            inArray(collectorDevices.deviceCode, input.deviceCodes),
            isNull(collectorDevices.deletedAt)
          ))
      : [];
    const existingCodes = new Set(devices.map((device) => device.deviceCode));
    const missingDeviceCodes = input.deviceCodes.filter((deviceCode) => !existingCodes.has(deviceCode));
    if (missingDeviceCodes.length > 0) {
      throw new FeatureAllowlistDeviceNotFoundError(missingDeviceCodes);
    }

    const currentAllowlist = await transaction
      .select({ deviceId: featureRolloutDeviceAllowlist.deviceId })
      .from(featureRolloutDeviceAllowlist)
      .where(and(
        eq(featureRolloutDeviceAllowlist.tenantId, config.tenantId),
        eq(featureRolloutDeviceAllowlist.featureKey, input.featureKey),
        eq(featureRolloutDeviceAllowlist.enabled, true),
        isNull(featureRolloutDeviceAllowlist.deletedAt)
      ));

    const now = new Date();
    const [updated] = await transaction
      .update(featureRolloutControls)
      .set({
        enabled: input.enabled,
        revision: control.revision + 1,
        minAppVersion: input.minAppVersion,
        requiredCapabilitiesJson: input.requiredCapabilities,
        capabilityTtlSeconds: input.capabilityTtlSeconds,
        reason: input.reason,
        updatedAt: now,
        updatedBy: input.actor
      })
      .where(eq(featureRolloutControls.id, control.id))
      .returning();
    if (!updated) {
      throw new Error("FEATURE_ROLLOUT_CONTROL_UPDATE_FAILED");
    }

    await transaction
      .update(featureRolloutDeviceAllowlist)
      .set({ deletedAt: now, updatedAt: now, updatedBy: input.actor })
      .where(and(
        eq(featureRolloutDeviceAllowlist.tenantId, config.tenantId),
        eq(featureRolloutDeviceAllowlist.featureKey, input.featureKey),
        isNull(featureRolloutDeviceAllowlist.deletedAt)
      ));
    if (devices.length > 0) {
      await insertAllowlistRows(transaction, input.featureKey, devices, input.actor);
    }

    await transaction.insert(featureRolloutControlEvents).values({
      tenantId: config.tenantId,
      controlId: control.id,
      featureKey: input.featureKey,
      fromRevision: control.revision,
      toRevision: updated.revision,
      beforeJson: {
        enabled: control.enabled,
        minAppVersion: control.minAppVersion,
        requiredCapabilities: control.requiredCapabilitiesJson,
        capabilityTtlSeconds: control.capabilityTtlSeconds,
        deviceIds: currentAllowlist.map((item) => item.deviceId)
      },
      afterJson: {
        enabled: updated.enabled,
        minAppVersion: updated.minAppVersion,
        requiredCapabilities: updated.requiredCapabilitiesJson,
        capabilityTtlSeconds: updated.capabilityTtlSeconds,
        deviceIds: devices.map((device) => device.id)
      },
      reason: input.reason,
      actor: input.actor,
      occurredAt: now,
      createdBy: input.actor,
      updatedBy: input.actor
    });
    return updated;
  });
}

async function insertAllowlistRows(
  transaction: DatabaseTransaction,
  featureKey: FeatureRolloutKey,
  devices: Array<typeof collectorDevices.$inferSelect>,
  actor: string
) {
  await transaction.insert(featureRolloutDeviceAllowlist).values(devices.map((device) => ({
    tenantId: config.tenantId,
    featureKey,
    deviceId: device.id,
    enabled: true,
    createdBy: actor,
    updatedBy: actor
  })));
}

export class FeatureControlRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("FEATURE_CONTROL_REVISION_CONFLICT");
    this.currentRevision = currentRevision;
  }
}

export class FeatureAllowlistDeviceNotFoundError extends Error {
  readonly deviceCodes: string[];

  constructor(deviceCodes: string[]) {
    super("FEATURE_ALLOWLIST_DEVICE_NOT_FOUND");
    this.deviceCodes = deviceCodes;
  }
}
