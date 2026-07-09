import { collectorDevices, liveTargetAliases, liveTargetDeviceBindings, liveTargetFeatureConfigs, liveTargets } from "@pkg/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { buildMobileLiveTargetConfig, thresholdFromPercent, thresholdToPercent, type LiveTargetFeatureConfigPayload, type LiveTargetPayload } from "../services/live-target-config.service";
import { db } from "./db";

type LiveTargetRow = typeof liveTargets.$inferSelect;
type LiveTargetAliasRow = typeof liveTargetAliases.$inferSelect;
type LiveTargetFeatureConfigRow = typeof liveTargetFeatureConfigs.$inferSelect;
type LiveTargetDeviceBindingRow = typeof liveTargetDeviceBindings.$inferSelect;

export type LiveTargetDetail = LiveTargetRow & {
  similarityThreshold: number;
  aliases: LiveTargetAliasRow[];
  featureConfigs: Array<LiveTargetFeatureConfigRow & { runtimeConfig: Record<string, unknown> }>;
  bindings: LiveTargetDeviceBindingRow[];
};

function normalizeTarget(row: LiveTargetRow) {
  return {
    ...row,
    similarityThreshold: thresholdFromPercent(row.similarityThreshold)
  };
}

function normalizeFeatureConfig(row: LiveTargetFeatureConfigRow) {
  return {
    ...row,
    runtimeConfig: row.runtimeConfigJson || {}
  };
}

function detailFromRows(
  target: LiveTargetRow,
  aliases: LiveTargetAliasRow[],
  featureConfigs: LiveTargetFeatureConfigRow[],
  bindings: LiveTargetDeviceBindingRow[]
): LiveTargetDetail {
  return {
    ...normalizeTarget(target),
    aliases: aliases.filter((item) => item.targetId === target.id),
    featureConfigs: featureConfigs.filter((item) => item.targetId === target.id).map(normalizeFeatureConfig),
    bindings: bindings.filter((item) => item.targetId === target.id)
  };
}

async function loadDetails(targets: LiveTargetRow[]) {
  if (targets.length === 0) {
    return [];
  }
  const ids = targets.map((target) => target.id);
  const [aliases, featureConfigs, bindings] = await Promise.all([
    db
      .select()
      .from(liveTargetAliases)
      .where(and(eq(liveTargetAliases.tenantId, config.tenantId), inArray(liveTargetAliases.targetId, ids), isNull(liveTargetAliases.deletedAt)))
      .orderBy(asc(liveTargetAliases.weight), asc(liveTargetAliases.createdAt)),
    db
      .select()
      .from(liveTargetFeatureConfigs)
      .where(and(eq(liveTargetFeatureConfigs.tenantId, config.tenantId), inArray(liveTargetFeatureConfigs.targetId, ids), isNull(liveTargetFeatureConfigs.deletedAt)))
      .orderBy(asc(liveTargetFeatureConfigs.featureType), asc(liveTargetFeatureConfigs.createdAt)),
    db
      .select()
      .from(liveTargetDeviceBindings)
      .where(and(eq(liveTargetDeviceBindings.tenantId, config.tenantId), inArray(liveTargetDeviceBindings.targetId, ids), isNull(liveTargetDeviceBindings.deletedAt)))
      .orderBy(asc(liveTargetDeviceBindings.priority), asc(liveTargetDeviceBindings.createdAt))
  ]);

  return targets.map((target) => detailFromRows(target, aliases, featureConfigs, bindings));
}

export async function listLiveTargetDetails(platform = "douyin") {
  const targets = await db
    .select()
    .from(liveTargets)
    .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.platform, platform), isNull(liveTargets.deletedAt)))
    .orderBy(asc(liveTargets.enabled), asc(liveTargets.targetName), asc(liveTargets.createdAt));
  return loadDetails(targets);
}

export async function findLiveTargetDetail(targetId: string) {
  const [target] = await db
    .select()
    .from(liveTargets)
    .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, targetId), isNull(liveTargets.deletedAt)))
    .limit(1);
  if (!target) {
    return null;
  }
  const details = await loadDetails([target]);
  return details[0] ?? null;
}

export async function upsertLiveTarget(payload: LiveTargetPayload) {
  const values = {
    targetCode: payload.targetCode,
    targetName: payload.targetName,
    platform: payload.platform,
    similarityThreshold: thresholdToPercent(payload.similarityThreshold),
    enabled: payload.enabled,
    remark: payload.remark ?? null,
    updatedAt: new Date(),
    updatedBy: "admin"
  };

  const [target] = payload.id
    ? await db
        .update(liveTargets)
        .set(values)
        .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, payload.id), isNull(liveTargets.deletedAt)))
        .returning()
    : await db
        .insert(liveTargets)
        .values({
          tenantId: config.tenantId,
          ...values,
          createdBy: "admin"
        })
        .returning();

  if (!target) {
    return null;
  }

  if (payload.aliases) {
    await replaceLiveTargetAliases(target.id, payload.aliases);
  }
  return findLiveTargetDetail(target.id);
}

export async function deleteLiveTarget(targetId: string) {
  const deletedAt = new Date();
  await Promise.all([
    db.update(liveTargetAliases).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetAliases.tenantId, config.tenantId), eq(liveTargetAliases.targetId, targetId), isNull(liveTargetAliases.deletedAt))),
    db.update(liveTargetFeatureConfigs).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetFeatureConfigs.tenantId, config.tenantId), eq(liveTargetFeatureConfigs.targetId, targetId), isNull(liveTargetFeatureConfigs.deletedAt))),
    db.update(liveTargetDeviceBindings).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetDeviceBindings.tenantId, config.tenantId), eq(liveTargetDeviceBindings.targetId, targetId), isNull(liveTargetDeviceBindings.deletedAt)))
  ]);
  const [target] = await db
    .update(liveTargets)
    .set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" })
    .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, targetId), isNull(liveTargets.deletedAt)))
    .returning();
  return target ?? null;
}

export async function replaceLiveTargetAliases(targetId: string, aliases: LiveTargetPayload["aliases"] = []) {
  const now = new Date();
  await db
    .update(liveTargetAliases)
    .set({ deletedAt: now, updatedAt: now, updatedBy: "admin" })
    .where(and(eq(liveTargetAliases.tenantId, config.tenantId), eq(liveTargetAliases.targetId, targetId), isNull(liveTargetAliases.deletedAt)));

  const values = aliases
    .filter((item) => item.aliasText)
    .map((item) => ({
      tenantId: config.tenantId,
      targetId,
      aliasText: item.aliasText,
      aliasType: item.aliasType,
      weight: item.weight,
      enabled: item.enabled,
      createdBy: "admin",
      updatedBy: "admin"
    }));

  if (values.length > 0) {
    await db.insert(liveTargetAliases).values(values);
  }
}

export async function upsertLiveTargetFeatureConfig(targetId: string, payload: LiveTargetFeatureConfigPayload) {
  const [existing] = await db
    .select()
    .from(liveTargetFeatureConfigs)
    .where(
      and(
        eq(liveTargetFeatureConfigs.tenantId, config.tenantId),
        eq(liveTargetFeatureConfigs.targetId, targetId),
        eq(liveTargetFeatureConfigs.featureType, payload.featureType),
        isNull(liveTargetFeatureConfigs.deletedAt)
      )
    )
    .limit(1);

  const values = {
    searchKeywords: payload.searchKeywords,
    requiredKeywords: payload.requiredKeywords,
    forbiddenKeywords: payload.forbiddenKeywords,
    productKeywords: payload.productKeywords,
    liveSignals: payload.liveSignals,
    runtimeConfigJson: payload.runtimeConfig,
    enabled: payload.enabled,
    updatedAt: new Date(),
    updatedBy: "admin"
  };

  if (existing) {
    await db.update(liveTargetFeatureConfigs).set(values).where(eq(liveTargetFeatureConfigs.id, existing.id));
  } else {
    await db.insert(liveTargetFeatureConfigs).values({
      tenantId: config.tenantId,
      targetId,
      featureType: payload.featureType,
      ...values,
      createdBy: "admin"
    });
  }
  return findLiveTargetDetail(targetId);
}

export async function replaceLiveTargetDeviceBindings(payload: {
  targetId: string;
  featureType: "live_comment" | "commerce_card_live_comment";
  deviceCodes: string[];
  defaultEnabled?: boolean;
}) {
  const now = new Date();
  await db
    .update(liveTargetDeviceBindings)
    .set({ deletedAt: now, updatedAt: now, updatedBy: "admin" })
    .where(and(eq(liveTargetDeviceBindings.tenantId, config.tenantId), eq(liveTargetDeviceBindings.targetId, payload.targetId), eq(liveTargetDeviceBindings.featureType, payload.featureType), isNull(liveTargetDeviceBindings.deletedAt)));

  const devices = payload.deviceCodes.length
    ? await db
        .select()
        .from(collectorDevices)
        .where(and(eq(collectorDevices.tenantId, config.tenantId), inArray(collectorDevices.deviceCode, payload.deviceCodes), isNull(collectorDevices.deletedAt)))
    : [];

  const values: Array<typeof liveTargetDeviceBindings.$inferInsert> = devices.map((device, index) => ({
    tenantId: config.tenantId,
    deviceId: device.id,
    targetId: payload.targetId,
    featureType: payload.featureType,
    priority: 100 + index,
    enabled: true,
    createdBy: "admin",
    updatedBy: "admin"
  }));

  if (payload.defaultEnabled) {
    values.unshift({
      tenantId: config.tenantId,
      deviceId: null,
      targetId: payload.targetId,
      featureType: payload.featureType,
      priority: 1,
      enabled: true,
      createdBy: "admin",
      updatedBy: "admin"
    });
  }

  if (values.length > 0) {
    await db.insert(liveTargetDeviceBindings).values(values);
  }
  return findLiveTargetDetail(payload.targetId);
}

export async function listMobileLiveTargetsForDevice(deviceId: string | null, platform = "douyin") {
  const details = await listLiveTargetDetails(platform);
  const payloads: ReturnType<typeof buildMobileLiveTargetConfig>[] = [];

  for (const detail of details) {
    if (!detail.enabled) {
      continue;
    }
    for (const featureConfig of detail.featureConfigs) {
      if (!featureConfig.enabled) {
        continue;
      }
      if (featureConfig.featureType !== "live_comment" && featureConfig.featureType !== "commerce_card_live_comment") {
        continue;
      }
      const bindings = detail.bindings.filter((binding) => binding.featureType === featureConfig.featureType && binding.enabled);
      const matchedBindings = bindings.filter((binding) => !binding.deviceId || (deviceId && binding.deviceId === deviceId));
      if (bindings.length > 0 && matchedBindings.length === 0) {
        continue;
      }
      payloads.push(
        buildMobileLiveTargetConfig({
          target: detail,
          aliases: detail.aliases,
          featureConfig: {
            ...featureConfig,
            featureType: featureConfig.featureType
          }
        })
      );
    }
  }

  return payloads;
}
