import {
  collectorDevices,
  liveTargetAliases,
  liveTargetDeviceBindings,
  liveTargetFeatureConfigs,
  liveTargets
} from "@pkg/db/schema";
import type { LiveTargetFeatureType, MobileLiveTargetConfig } from "@pkg/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import {
  buildLiveTargetConfigHash,
  buildMobileLiveTargetConfig,
  ConfigRevisionConflictError,
  ConfigRevisionRequiredError,
  normalizeCommerceCardWorkflowRuntimeConfig,
  thresholdFromPercent,
  thresholdToPercent,
  type LiveTargetFeatureConfigPayload,
  type LiveTargetPayload
} from "../services/live-target-config.service";
import { db } from "./db";

type LiveTargetRow = typeof liveTargets.$inferSelect;
type LiveTargetAliasRow = typeof liveTargetAliases.$inferSelect;
type LiveTargetFeatureConfigRow = typeof liveTargetFeatureConfigs.$inferSelect;
type LiveTargetDeviceBindingRow = typeof liveTargetDeviceBindings.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type NormalizedFeatureConfig = LiveTargetFeatureConfigRow & {
  runtimeConfig: Record<string, unknown>;
  storedWorkflowVersion: 1 | 2;
  configValidationError: string | null;
};

export type LiveTargetDetail = Omit<LiveTargetRow, "similarityThreshold"> & {
  similarityThreshold: number;
  aliases: LiveTargetAliasRow[];
  featureConfigs: NormalizedFeatureConfig[];
  bindings: LiveTargetDeviceBindingRow[];
};

function normalizeTarget(row: LiveTargetRow) {
  return {
    ...row,
    similarityThreshold: thresholdFromPercent(row.similarityThreshold)
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFeatureConfig(row: LiveTargetFeatureConfigRow): NormalizedFeatureConfig {
  const source = row.runtimeConfigJson ?? {};
  const storedWorkflowVersion = row.featureType === "commerce_card_live_comment" && source.configVersion === 2 ? 2 : 1;
  if (storedWorkflowVersion === 2) {
    try {
      return {
        ...row,
        runtimeConfig: normalizeCommerceCardWorkflowRuntimeConfig(source),
        storedWorkflowVersion,
        configValidationError: null
      };
    } catch (error) {
      return {
        ...row,
        runtimeConfig: source,
        storedWorkflowVersion,
        configValidationError: errorMessage(error)
      };
    }
  }

  return {
    ...row,
    runtimeConfig: source,
    storedWorkflowVersion,
    configValidationError: null
  };
}

function configHashForRows(
  target: LiveTargetRow,
  aliases: LiveTargetAliasRow[],
  featureConfig: LiveTargetFeatureConfigRow,
  bindings: LiveTargetDeviceBindingRow[]
) {
  return buildLiveTargetConfigHash({
    target: {
      id: target.id,
      targetCode: target.targetCode,
      targetName: target.targetName,
      platform: target.platform,
      similarityThreshold: thresholdFromPercent(target.similarityThreshold),
      enabled: target.enabled
    },
    aliases: aliases.map((item) => ({
      aliasText: item.aliasText,
      aliasType: item.aliasType,
      weight: item.weight,
      enabled: item.enabled
    })),
    featureConfig: {
      featureType: featureConfig.featureType,
      searchKeywords: featureConfig.searchKeywords,
      requiredKeywords: featureConfig.requiredKeywords,
      forbiddenKeywords: featureConfig.forbiddenKeywords,
      productKeywords: featureConfig.productKeywords,
      liveSignals: featureConfig.liveSignals,
      runtimeConfig: featureConfig.runtimeConfigJson ?? {},
      enabled: featureConfig.enabled
    },
    bindings: bindings
      .filter((item) => item.featureType === featureConfig.featureType)
      .map((item) => ({
        deviceId: item.deviceId,
        priority: item.priority,
        enabled: item.enabled
      }))
  });
}

function detailFromRows(
  target: LiveTargetRow,
  aliases: LiveTargetAliasRow[],
  featureConfigs: LiveTargetFeatureConfigRow[],
  bindings: LiveTargetDeviceBindingRow[]
): LiveTargetDetail {
  const targetAliases = aliases.filter((item) => item.targetId === target.id);
  const targetBindings = bindings.filter((item) => item.targetId === target.id);
  const normalizedConfigs = featureConfigs
    .filter((item) => item.targetId === target.id)
    .map((item) => normalizeFeatureConfig({
      ...item,
      configHash: item.configHash ?? configHashForRows(target, targetAliases, item, targetBindings)
    }));

  return {
    ...normalizeTarget(target),
    aliases: targetAliases,
    featureConfigs: normalizedConfigs,
    bindings: targetBindings
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

async function loadAggregate(transaction: DatabaseTransaction, targetId: string) {
  const [target] = await transaction
    .select()
    .from(liveTargets)
    .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, targetId), isNull(liveTargets.deletedAt)))
    .limit(1);
  if (!target) {
    return null;
  }

  const [aliases, featureConfigs, bindings] = await Promise.all([
    transaction
      .select()
      .from(liveTargetAliases)
      .where(and(eq(liveTargetAliases.tenantId, config.tenantId), eq(liveTargetAliases.targetId, targetId), isNull(liveTargetAliases.deletedAt))),
    transaction
      .select()
      .from(liveTargetFeatureConfigs)
      .where(and(eq(liveTargetFeatureConfigs.tenantId, config.tenantId), eq(liveTargetFeatureConfigs.targetId, targetId), isNull(liveTargetFeatureConfigs.deletedAt))),
    transaction
      .select()
      .from(liveTargetDeviceBindings)
      .where(and(eq(liveTargetDeviceBindings.tenantId, config.tenantId), eq(liveTargetDeviceBindings.targetId, targetId), isNull(liveTargetDeviceBindings.deletedAt)))
  ]);
  return { target, aliases, featureConfigs, bindings };
}

async function recomputeFeatureHashes(transaction: DatabaseTransaction, targetId: string) {
  const aggregate = await loadAggregate(transaction, targetId);
  if (!aggregate) {
    return;
  }

  for (const featureConfig of aggregate.featureConfigs) {
    const configHash = configHashForRows(
      aggregate.target,
      aggregate.aliases,
      featureConfig,
      aggregate.bindings
    );
    if (featureConfig.configHash === configHash) {
      continue;
    }
    await transaction
      .update(liveTargetFeatureConfigs)
      .set({
        configHash,
        revision: featureConfig.configHash ? featureConfig.revision + 1 : featureConfig.revision,
        updatedAt: new Date()
      })
      .where(eq(liveTargetFeatureConfigs.id, featureConfig.id));
  }
}

function assertExpectedRevision(
  currentRevision: number,
  expectedRevision: number | undefined,
  required: boolean
) {
  if (expectedRevision === undefined) {
    if (required) {
      throw new ConfigRevisionRequiredError(currentRevision);
    }
    return;
  }
  if (expectedRevision !== currentRevision) {
    throw new ConfigRevisionConflictError(currentRevision);
  }
}

function assertExpectedRevisions(
  featureConfigs: LiveTargetFeatureConfigRow[],
  expectedRevisions: LiveTargetPayload["expectedRevisions"]
) {
  if (!expectedRevisions) {
    return;
  }
  for (const featureConfig of featureConfigs) {
    const featureType = featureConfig.featureType as LiveTargetFeatureType;
    const expectedRevision = expectedRevisions[featureType];
    if (expectedRevision !== undefined && expectedRevision !== featureConfig.revision) {
      throw new ConfigRevisionConflictError(featureConfig.revision);
    }
  }
}

async function replaceAliasesInTransaction(
  transaction: DatabaseTransaction,
  targetId: string,
  aliases: LiveTargetPayload["aliases"] = []
) {
  const now = new Date();
  await transaction
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
    await transaction.insert(liveTargetAliases).values(values);
  }
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

export async function findRunnableCommerceCardLiveTargetForDevice(deviceId: string, platform = "douyin") {
  const candidates: Array<{ detail: LiveTargetDetail; priority: number }> = [];
  const details = await listLiveTargetDetails(platform);
  for (const detail of details) {
    if (!detail.enabled) {
      continue;
    }
    const featureConfig = detail.featureConfigs.find((item) =>
      item.featureType === "commerce_card_live_comment" &&
      item.enabled &&
      item.storedWorkflowVersion === 2 &&
      !item.configValidationError
    );
    if (!featureConfig) {
      continue;
    }
    const bindings = detail.bindings.filter((binding) =>
      binding.featureType === "commerce_card_live_comment" && binding.enabled
    );
    const matchedBindings = bindings.filter((binding) => !binding.deviceId || binding.deviceId === deviceId);
    if (bindings.length > 0 && matchedBindings.length === 0) {
      continue;
    }
    candidates.push({
      detail,
      priority: matchedBindings.length > 0
        ? Math.min(...matchedBindings.map((binding) => binding.priority))
        : 1000
    });
  }
  const [first] = candidates
    .sort((left, right) => left.priority - right.priority || left.detail.targetName.localeCompare(right.detail.targetName, "zh-CN"));
  return first?.detail ?? null;
}

export async function upsertLiveTarget(payload: LiveTargetPayload) {
  const targetId = await db.transaction(async (transaction) => {
    if (payload.id) {
      await recomputeFeatureHashes(transaction, payload.id);
      const featureConfigs = await transaction
        .select()
        .from(liveTargetFeatureConfigs)
        .where(and(
          eq(liveTargetFeatureConfigs.tenantId, config.tenantId),
          eq(liveTargetFeatureConfigs.targetId, payload.id),
          isNull(liveTargetFeatureConfigs.deletedAt)
        ))
        .for("update");
      assertExpectedRevisions(featureConfigs, payload.expectedRevisions);
    }

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
      ? await transaction
          .update(liveTargets)
          .set(values)
          .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, payload.id), isNull(liveTargets.deletedAt)))
          .returning()
      : await transaction
          .insert(liveTargets)
          .values({ tenantId: config.tenantId, ...values, createdBy: "admin" })
          .returning();
    if (!target) {
      return null;
    }

    if (payload.aliases) {
      await replaceAliasesInTransaction(transaction, target.id, payload.aliases);
    }
    await recomputeFeatureHashes(transaction, target.id);
    return target.id;
  });

  return targetId ? findLiveTargetDetail(targetId) : null;
}

export async function deleteLiveTarget(targetId: string) {
  return db.transaction(async (transaction) => {
    const deletedAt = new Date();
    await transaction.update(liveTargetAliases).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetAliases.tenantId, config.tenantId), eq(liveTargetAliases.targetId, targetId), isNull(liveTargetAliases.deletedAt)));
    await transaction.update(liveTargetFeatureConfigs).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetFeatureConfigs.tenantId, config.tenantId), eq(liveTargetFeatureConfigs.targetId, targetId), isNull(liveTargetFeatureConfigs.deletedAt)));
    await transaction.update(liveTargetDeviceBindings).set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" }).where(and(eq(liveTargetDeviceBindings.tenantId, config.tenantId), eq(liveTargetDeviceBindings.targetId, targetId), isNull(liveTargetDeviceBindings.deletedAt)));
    const [target] = await transaction
      .update(liveTargets)
      .set({ deletedAt, updatedAt: deletedAt, updatedBy: "admin" })
      .where(and(eq(liveTargets.tenantId, config.tenantId), eq(liveTargets.id, targetId), isNull(liveTargets.deletedAt)))
      .returning();
    return target ?? null;
  });
}

export async function upsertLiveTargetFeatureConfig(targetId: string, payload: LiveTargetFeatureConfigPayload) {
  const saved = await db.transaction(async (transaction) => {
    await recomputeFeatureHashes(transaction, targetId);
    const [target] = await transaction
      .select({ id: liveTargets.id })
      .from(liveTargets)
      .where(and(
        eq(liveTargets.tenantId, config.tenantId),
        eq(liveTargets.id, targetId),
        isNull(liveTargets.deletedAt)
      ))
      .limit(1);
    if (!target) {
      return false;
    }
    const [existing] = await transaction
      .select()
      .from(liveTargetFeatureConfigs)
      .where(and(
        eq(liveTargetFeatureConfigs.tenantId, config.tenantId),
        eq(liveTargetFeatureConfigs.targetId, targetId),
        eq(liveTargetFeatureConfigs.featureType, payload.featureType),
        isNull(liveTargetFeatureConfigs.deletedAt)
      ))
      .limit(1)
      .for("update");

    if (existing) {
      assertExpectedRevision(
        existing.revision,
        payload.expectedRevision,
        payload.featureType === "commerce_card_live_comment"
      );
    } else if ((payload.expectedRevision ?? 0) !== 0) {
      throw new ConfigRevisionConflictError(0);
    }

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
      await transaction.update(liveTargetFeatureConfigs).set(values).where(eq(liveTargetFeatureConfigs.id, existing.id));
    } else {
      await transaction.insert(liveTargetFeatureConfigs).values({
        tenantId: config.tenantId,
        targetId,
        featureType: payload.featureType,
        ...values,
        createdBy: "admin"
      });
    }
    await recomputeFeatureHashes(transaction, targetId);
    return true;
  });

  return saved ? findLiveTargetDetail(targetId) : null;
}

export async function replaceLiveTargetDeviceBindings(payload: {
  targetId: string;
  featureType: LiveTargetFeatureType;
  deviceCodes: string[];
  defaultEnabled?: boolean;
  expectedRevision?: number;
}) {
  await db.transaction(async (transaction) => {
    await recomputeFeatureHashes(transaction, payload.targetId);
    const [featureConfig] = await transaction
      .select()
      .from(liveTargetFeatureConfigs)
      .where(and(
        eq(liveTargetFeatureConfigs.tenantId, config.tenantId),
        eq(liveTargetFeatureConfigs.targetId, payload.targetId),
        eq(liveTargetFeatureConfigs.featureType, payload.featureType),
        isNull(liveTargetFeatureConfigs.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (featureConfig) {
      assertExpectedRevision(
        featureConfig.revision,
        payload.expectedRevision,
        payload.featureType === "commerce_card_live_comment"
      );
    }

    const now = new Date();
    await transaction
      .update(liveTargetDeviceBindings)
      .set({ deletedAt: now, updatedAt: now, updatedBy: "admin" })
      .where(and(
        eq(liveTargetDeviceBindings.tenantId, config.tenantId),
        eq(liveTargetDeviceBindings.targetId, payload.targetId),
        eq(liveTargetDeviceBindings.featureType, payload.featureType),
        isNull(liveTargetDeviceBindings.deletedAt)
      ));

    const devices = payload.deviceCodes.length
      ? await transaction
          .select()
          .from(collectorDevices)
          .where(and(
            eq(collectorDevices.tenantId, config.tenantId),
            inArray(collectorDevices.deviceCode, payload.deviceCodes),
            isNull(collectorDevices.deletedAt)
          ))
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
      await transaction.insert(liveTargetDeviceBindings).values(values);
    }
    await recomputeFeatureHashes(transaction, payload.targetId);
  });

  return findLiveTargetDetail(payload.targetId);
}

export async function getCommerceCardFeaturePreviewData(targetId: string) {
  const detail = await findLiveTargetDetail(targetId);
  if (!detail) {
    return null;
  }
  const featureConfig = detail.featureConfigs.find((item) => item.featureType === "commerce_card_live_comment");
  if (!featureConfig) {
    return null;
  }
  const runtimeConfig = normalizeCommerceCardWorkflowRuntimeConfig(featureConfig.runtimeConfig);
  const configHash = configHashForRows(
    detail as unknown as LiveTargetRow,
    detail.aliases,
    { ...featureConfig, runtimeConfigJson: runtimeConfig },
    detail.bindings
  );
  const payload = buildMobileLiveTargetConfig({
    target: detail,
    aliases: detail.aliases,
    featureConfig: {
      ...featureConfig,
      featureType: "commerce_card_live_comment",
      runtimeConfig,
      revision: featureConfig.revision,
      configHash
    },
    configSource: "target_center_v2",
    executionEligible: false,
    executionBlockedReasons: ["WORKFLOW_V2_CONFIGURATION_ONLY"]
  });
  return {
    payload,
    runtimeConfig,
    revision: featureConfig.revision,
    configHash
  };
}

export async function listMobileLiveTargetsForDevice(deviceId: string | null, platform = "douyin") {
  const details = await listLiveTargetDetails(platform);
  const candidates: Array<{ payload: MobileLiveTargetConfig; priority: number }> = [];
  const seen = new Set<string>();

  for (const detail of details) {
    if (!detail.enabled) {
      continue;
    }
    for (const featureConfig of detail.featureConfigs) {
      if (!featureConfig.enabled || featureConfig.configValidationError) {
        continue;
      }
      if (featureConfig.featureType !== "live_comment" && featureConfig.featureType !== "commerce_card_live_comment") {
        continue;
      }
      if (featureConfig.featureType === "commerce_card_live_comment" && featureConfig.storedWorkflowVersion === 2) {
        continue;
      }
      const bindings = detail.bindings.filter((binding) => binding.featureType === featureConfig.featureType && binding.enabled);
      const matchedBindings = bindings.filter((binding) => !binding.deviceId || (deviceId && binding.deviceId === deviceId));
      if (bindings.length > 0 && matchedBindings.length === 0) {
        continue;
      }
      const key = `${featureConfig.featureType}:${detail.targetCode}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        candidates.push({
          payload: buildMobileLiveTargetConfig({
            target: detail,
            aliases: detail.aliases,
            featureConfig: {
              ...featureConfig,
              featureType: featureConfig.featureType
            },
            configSource: "target_center_v1",
            executionEligible: true
          }),
          priority: matchedBindings.length > 0
            ? Math.min(...matchedBindings.map((binding) => binding.priority))
            : 1000
        });
      } catch (error) {
        console.error("live_target_config_skipped", {
          targetId: detail.id,
          featureType: featureConfig.featureType,
          reason: errorMessage(error)
        });
      }
    }
  }

  return candidates.sort((left, right) => left.priority - right.priority).map((item) => item.payload);
}
