import { collectorDevices, publishAccountBindings, publishClaimQuarantines, publishDeviceSchedules } from "@pkg/db/schema";
import type { PublishAccountBinding, PublishDeviceSchedule, PublishRoutingPlatform } from "@pkg/types";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type BindingDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function now() {
  return new Date();
}

function profileBindings(deviceCode: string, profile: Record<string, unknown> | null | undefined) {
  const douyinAccountName = typeof profile?.douyinAccountName === "string" ? profile.douyinAccountName.trim() : "";
  const douyinAccountNo = typeof profile?.douyinAccountId === "string" ? profile.douyinAccountId.trim() : "";
  const channelsAccountName = typeof profile?.wechatChannelsName === "string" ? profile.wechatChannelsName.trim() : "";
  const bindings: PublishAccountBinding[] = [];
  if (douyinAccountName) bindings.push({
    deviceCode,
    platform: "DOUYIN",
    accountName: douyinAccountName,
    ...(douyinAccountNo ? { accountNo: douyinAccountNo } : {}),
    externalAccountKey: douyinAccountName,
    enabled: true
  });
  if (channelsAccountName) bindings.push({
    deviceCode,
    platform: "WECHAT_CHANNELS",
    accountName: channelsAccountName,
    externalAccountKey: channelsAccountName,
    enabled: true
  });
  return bindings;
}

export async function assertPublishAccountBindingsAvailable(
  deviceCode: string,
  profile: Record<string, unknown> | null | undefined
) {
  for (const binding of profileBindings(deviceCode, profile)) {
    const [conflict] = await db.select({ id: publishAccountBindings.id }).from(publishAccountBindings).where(and(
      eq(publishAccountBindings.tenantId, config.tenantId),
      eq(publishAccountBindings.platform, binding.platform),
      eq(publishAccountBindings.accountName, binding.accountName),
      eq(publishAccountBindings.enabled, true),
      isNull(publishAccountBindings.deletedAt),
      ne(publishAccountBindings.deviceCode, deviceCode)
    )).limit(1);
    if (conflict) throw new Error("PUBLISH_ACCOUNT_BINDING_CONFLICT");
  }
}

export async function syncPublishAccountBindings(
  deviceCode: string,
  profile: Record<string, unknown> | null | undefined,
  actor: string,
  database: BindingDatabase = db
) {
  const bindings = profileBindings(deviceCode, profile);
  const timestamp = now();
  await database.update(publishAccountBindings).set({
    enabled: false,
    deletedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actor
  }).where(and(
    eq(publishAccountBindings.tenantId, config.tenantId),
    eq(publishAccountBindings.deviceCode, deviceCode),
    isNull(publishAccountBindings.deletedAt)
  ));
  if (bindings.length) {
    await database.insert(publishAccountBindings).values(bindings.map((binding) => ({
      tenantId: config.tenantId,
      deviceCode: binding.deviceCode,
      platform: binding.platform,
      accountName: binding.accountName,
      accountNo: binding.accountNo ?? null,
      externalAccountKey: binding.externalAccountKey,
      enabled: binding.enabled,
      createdBy: actor,
      updatedBy: actor
    })));
  }
  return bindings;
}

export function listPublishAccountBindings(deviceCode?: string) {
  const conditions = [
    eq(publishAccountBindings.tenantId, config.tenantId),
    isNull(publishAccountBindings.deletedAt)
  ];
  if (deviceCode) conditions.push(eq(publishAccountBindings.deviceCode, deviceCode));
  return db.select().from(publishAccountBindings).where(and(...conditions));
}

export async function savePublishAccountBinding(input: PublishAccountBinding, actor: string) {
  const [existing] = await db.select({ id: publishAccountBindings.id }).from(publishAccountBindings).where(and(
    eq(publishAccountBindings.tenantId, config.tenantId),
    eq(publishAccountBindings.deviceCode, input.deviceCode),
    eq(publishAccountBindings.platform, input.platform),
    isNull(publishAccountBindings.deletedAt)
  )).limit(1);
  if (existing) {
    const [updated] = await db.update(publishAccountBindings).set({
      accountName: input.accountName,
      accountNo: input.accountNo ?? null,
      externalAccountKey: input.externalAccountKey,
      enabled: input.enabled,
      updatedAt: now(),
      updatedBy: actor
    }).where(and(
      eq(publishAccountBindings.tenantId, config.tenantId),
      eq(publishAccountBindings.id, existing.id),
      isNull(publishAccountBindings.deletedAt)
    )).returning();
    if (!updated) throw new Error("PUBLISH_ACCOUNT_BINDING_SAVE_FAILED");
    return updated;
  }
  const [created] = await db.insert(publishAccountBindings).values({
    tenantId: config.tenantId,
    deviceCode: input.deviceCode,
    platform: input.platform,
    accountName: input.accountName,
    accountNo: input.accountNo ?? null,
    externalAccountKey: input.externalAccountKey,
    enabled: input.enabled,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!created) throw new Error("PUBLISH_ACCOUNT_BINDING_SAVE_FAILED");
  return created;
}

export function listEnabledPublishAccountBindings(deviceCode: string, platform: PublishRoutingPlatform) {
  return db.select().from(publishAccountBindings).where(and(
    eq(publishAccountBindings.tenantId, config.tenantId),
    eq(publishAccountBindings.deviceCode, deviceCode),
    eq(publishAccountBindings.platform, platform),
    eq(publishAccountBindings.enabled, true),
    isNull(publishAccountBindings.deletedAt)
  ));
}

export function listPublishDeviceSchedules(configId?: string) {
  const conditions = [
    eq(publishDeviceSchedules.tenantId, config.tenantId),
    isNull(publishDeviceSchedules.deletedAt)
  ];
  if (configId) conditions.push(eq(publishDeviceSchedules.configId, configId));
  return db.select().from(publishDeviceSchedules).where(and(...conditions));
}

export function listEnabledPublishDeviceSchedules() {
  return db.select().from(publishDeviceSchedules).where(and(
    eq(publishDeviceSchedules.tenantId, config.tenantId),
    eq(publishDeviceSchedules.enabled, true),
    isNull(publishDeviceSchedules.deletedAt)
  ));
}

export async function savePublishDeviceSchedule(input: PublishDeviceSchedule, actor: string) {
  const [schedule] = await db.insert(publishDeviceSchedules).values({
    tenantId: config.tenantId,
    configId: input.configId,
    deviceCode: input.deviceCode,
    platforms: input.platforms,
    timeWindows: input.timeWindows,
    enabled: input.enabled,
    createdBy: actor,
    updatedBy: actor
  }).onConflictDoUpdate({
    target: [publishDeviceSchedules.tenantId, publishDeviceSchedules.configId, publishDeviceSchedules.deviceCode],
    targetWhere: isNull(publishDeviceSchedules.deletedAt),
    set: {
      platforms: input.platforms,
      timeWindows: input.timeWindows,
      enabled: input.enabled,
      updatedAt: now(),
      updatedBy: actor
    }
  }).returning();
  if (!schedule) throw new Error("PUBLISH_DEVICE_SCHEDULE_SAVE_FAILED");
  return schedule;
}

export async function findActivePublishClaimQuarantine(input: {
  deviceCode: string;
  platform: PublishRoutingPlatform;
  accountName: string;
  now?: Date;
}) {
  const [quarantine] = await db.select().from(publishClaimQuarantines).where(and(
    eq(publishClaimQuarantines.tenantId, config.tenantId),
    eq(publishClaimQuarantines.deviceCode, input.deviceCode),
    eq(publishClaimQuarantines.platform, input.platform),
    eq(publishClaimQuarantines.accountName, input.accountName),
    gt(publishClaimQuarantines.blockedUntil, input.now ?? now()),
    isNull(publishClaimQuarantines.deletedAt)
  )).limit(1);
  return quarantine ?? null;
}

export async function savePublishClaimQuarantine(input: {
  deviceCode: string;
  platform: PublishRoutingPlatform;
  accountName: string;
  reason: string;
  blockedUntil: Date;
  lastExternalTaskId: string;
}, actor: string) {
  const [existing] = await db.select({ id: publishClaimQuarantines.id }).from(publishClaimQuarantines).where(and(
    eq(publishClaimQuarantines.tenantId, config.tenantId),
    eq(publishClaimQuarantines.deviceCode, input.deviceCode),
    eq(publishClaimQuarantines.platform, input.platform),
    eq(publishClaimQuarantines.accountName, input.accountName),
    isNull(publishClaimQuarantines.deletedAt)
  )).limit(1);
  if (existing) {
    const [updated] = await db.update(publishClaimQuarantines).set({
      reason: input.reason,
      blockedUntil: input.blockedUntil,
      lastExternalTaskId: input.lastExternalTaskId,
      updatedAt: now(),
      updatedBy: actor
    }).where(and(
      eq(publishClaimQuarantines.tenantId, config.tenantId),
      eq(publishClaimQuarantines.id, existing.id),
      isNull(publishClaimQuarantines.deletedAt)
    )).returning();
    if (!updated) throw new Error("PUBLISH_CLAIM_QUARANTINE_SAVE_FAILED");
    return updated;
  }
  const [created] = await db.insert(publishClaimQuarantines).values({
    tenantId: config.tenantId,
    deviceCode: input.deviceCode,
    platform: input.platform,
    accountName: input.accountName,
    reason: input.reason,
    blockedUntil: input.blockedUntil,
    lastExternalTaskId: input.lastExternalTaskId,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!created) throw new Error("PUBLISH_CLAIM_QUARANTINE_SAVE_FAILED");
  return created;
}

export async function findOnlineDeviceForPublish(deviceCode: string, since: Date) {
  const [device] = await db.select().from(collectorDevices).where(and(
    eq(collectorDevices.tenantId, config.tenantId),
    eq(collectorDevices.deviceCode, deviceCode),
    eq(collectorDevices.enabled, true),
    isNull(collectorDevices.deletedAt)
  )).limit(1);
  if (!device || !device.lastHeartbeatAt || device.lastHeartbeatAt < since) return null;
  return device;
}
