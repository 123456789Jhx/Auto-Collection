import {
  commerceCardWorkflowRuntimeConfigSchema,
  defaultCommerceCardWorkflowRuntimeConfig,
  liveTargetFeatureTypeSchema,
  mobileLiveTargetAliasSchema,
  mobileLiveTargetConfigSchema,
  type CommerceCardWorkflowRuntimeConfig,
  type LiveTargetFeatureType,
  type MobileLiveTargetConfig
} from "@pkg/types";
import { createHash } from "node:crypto";
import { z } from "zod";

const textListSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .default([])
  .transform((values) => Array.from(new Set(values)));

export { liveTargetFeatureTypeSchema };

export const liveTargetAliasSchema = z
  .object({
    id: z.string().uuid().optional(),
    aliasText: z.string().trim().min(1).max(200),
    aliasType: z.string().trim().min(1).max(32).default("room_name"),
    weight: z.number().int().min(0).max(1000).default(100),
    enabled: z.boolean().default(true)
  })
  .strict();

export const liveTargetPayloadSchema = z
  .object({
    id: z.string().uuid().optional(),
    targetCode: z.string().trim().min(1).max(64),
    targetName: z.string().trim().min(1).max(200),
    platform: z.string().trim().min(1).max(32).default("douyin"),
    similarityThreshold: z.number().min(0.5).max(1).default(0.9),
    enabled: z.boolean().default(true),
    remark: z.string().trim().max(500).optional().nullable(),
    aliases: z.array(liveTargetAliasSchema).max(50).optional(),
    expectedRevisions: z.record(liveTargetFeatureTypeSchema, z.number().int().positive()).optional()
  })
  .strict();

const liveCommentFeatureConfigSchema = z
  .object({
    id: z.string().uuid().optional(),
    featureType: z.literal("live_comment"),
    searchKeywords: textListSchema,
    requiredKeywords: textListSchema,
    forbiddenKeywords: textListSchema,
    productKeywords: textListSchema,
    liveSignals: textListSchema,
    runtimeConfig: z.record(z.unknown()).default({}),
    enabled: z.boolean().default(true),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

const commerceCardFeatureConfigSchema = z
  .object({
    id: z.string().uuid().optional(),
    featureType: z.literal("commerce_card_live_comment"),
    searchKeywords: textListSchema,
    requiredKeywords: textListSchema,
    forbiddenKeywords: textListSchema,
    productKeywords: textListSchema,
    liveSignals: textListSchema,
    runtimeConfig: z.preprocess(
      (value) => legacyCommerceCardRuntimeToV2(value),
      commerceCardWorkflowRuntimeConfigSchema
    ),
    enabled: z.boolean().default(true),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

export const liveTargetFeatureConfigSchema = z
  .discriminatedUnion("featureType", [
    liveCommentFeatureConfigSchema,
    commerceCardFeatureConfigSchema
  ])
  .superRefine((value, context) => {
    if (value.featureType !== "commerce_card_live_comment") {
      return;
    }
    const enabledStages = new Set(value.runtimeConfig.enabledStages);
    if (enabledStages.has("product_nurture") && value.searchKeywords.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "启用商品卡养号时必须填写商城搜索词",
        path: ["searchKeywords"]
      });
    }
    if (enabledStages.has("product_nurture") && value.productKeywords.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "启用商品卡养号时必须填写商品卡匹配词",
        path: ["productKeywords"]
      });
    }
  });

export const liveTargetDeviceBindingSchema = z
  .object({
    deviceId: z.string().uuid().nullable().optional(),
    deviceCode: z.string().trim().min(1).max(64).optional(),
    targetId: z.string().uuid(),
    featureType: liveTargetFeatureTypeSchema,
    priority: z.number().int().min(1).max(1000).default(100),
    enabled: z.boolean().default(true)
  })
  .strict();

export type LiveTargetPayload = z.infer<typeof liveTargetPayloadSchema>;
export type LiveTargetFeatureConfigPayload = z.infer<typeof liveTargetFeatureConfigSchema>;
export type LiveTargetAliasPayload = z.infer<typeof liveTargetAliasSchema>;
export type LiveTargetDeviceBindingPayload = z.infer<typeof liveTargetDeviceBindingSchema>;

export class ConfigRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("CONFIG_REVISION_CONFLICT");
    this.currentRevision = currentRevision;
  }
}

export class ConfigRevisionRequiredError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("CONFIG_REVISION_REQUIRED");
    this.currentRevision = currentRevision;
  }
}

function normalizeList(value: unknown, maxItems = 50) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,，]/) : [];
  const result: string[] = [];
  for (const item of source) {
    const text = String(item || "").replace(/\s+/g, " ").trim();
    if (text && !result.includes(text)) {
      result.push(text);
    }
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function targetNameFromRoom(targetRoom: Record<string, unknown>, fallback: string) {
  return stringValue(targetRoom.targetName) ||
    stringValue(targetRoom.anchorName) ||
    stringValue(targetRoom.roomName) ||
    fallback;
}

function aliasesFromKeywords(values: string[]) {
  return values.map((aliasText, index) => ({
    aliasText,
    aliasType: "room_name",
    weight: 100 + index,
    enabled: true
  }));
}

function targetCode(deviceCode: string | undefined, featureType: LiveTargetFeatureType) {
  return `${stringValue(deviceCode) || "device"}_${featureType}`;
}

function legacyCommerceCardRuntimeToV2(value: unknown): unknown {
  const source = objectValue(value) ?? {};
  if (source.configVersion === 2) {
    return source;
  }

  return {
    ...defaultCommerceCardWorkflowRuntimeConfig,
    configVersion: 2,
    enabledStages: Array.isArray(source.enabledStages) ? source.enabledStages : ["product_nurture"],
    executeEnabled: source.executeEnabled === true,
    recommendationSignals: normalizeList(source.recommendationSignals, 20).length > 0
      ? normalizeList(source.recommendationSignals, 20)
      : defaultCommerceCardWorkflowRuntimeConfig.recommendationSignals,
    productCardDwellSeconds: numberValue(source.productCardDwellSeconds, 120),
    productNurtureRoundMinutes: numberValue(source.productNurtureRoundMinutes ?? source.scanMinutesPerRound, 15),
    productNurtureMaxRounds: numberValue(source.productNurtureMaxRounds ?? source.maxRounds, 3),
    targetLiveMaxRoomsPerRefresh: numberValue(source.targetLiveMaxRoomsPerRefresh, 25),
    targetCommentSearchMaxActiveMinutes: numberValue(source.targetCommentSearchMaxActiveMinutes, 60),
    maxCommentsPerRoom: numberValue(source.maxCommentsPerRoom, 1),
    commentPool: normalizeList(source.commentPool),
    liveNurtureKeywords: normalizeList(source.liveNurtureKeywords),
    liveNurtureRefreshAfterRooms: numberValue(source.liveNurtureRefreshAfterRooms, 10),
    liveNurtureWatchMinMinutes: numberValue(source.liveNurtureWatchMinMinutes, 10),
    liveNurtureWatchMaxMinutes: numberValue(source.liveNurtureWatchMaxMinutes, 20),
    liveNurtureTotalMinMinutes: numberValue(source.liveNurtureTotalMinMinutes, 70),
    liveNurtureTotalMaxMinutes: numberValue(source.liveNurtureTotalMaxMinutes, 100),
    taskMaxActiveMinutes: numberValue(source.taskMaxActiveMinutes, 240)
  };
}

export function normalizeCommerceCardWorkflowRuntimeConfig(value: unknown): CommerceCardWorkflowRuntimeConfig {
  return commerceCardWorkflowRuntimeConfigSchema.parse(legacyCommerceCardRuntimeToV2(value));
}

export function parseCommerceCardFeatureConfig(value: unknown) {
  const parsed = liveTargetFeatureConfigSchema.parse(value);
  if (parsed.featureType !== "commerce_card_live_comment") {
    throw new Error("COMMERCE_CARD_FEATURE_CONFIG_REQUIRED");
  }
  return parsed;
}

export function thresholdToPercent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 90;
  }
  if (parsed <= 1) {
    return Math.round(Math.max(0.5, Math.min(1, parsed)) * 100);
  }
  return Math.round(Math.max(50, Math.min(100, parsed)));
}

export function thresholdFromPercent(value: unknown) {
  const percent = thresholdToPercent(value);
  return Number((percent / 100).toFixed(2));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) {
      result[key] = stableJsonValue(source[key]);
    }
  }
  return result;
}

export function buildCanonicalSha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");
}

export function buildCommerceCardCommentPoolHash(commentPool: string[]) {
  return buildCanonicalSha256(normalizeList(commentPool));
}

function businessRuntimeConfig(runtimeConfig: Record<string, unknown>) {
  const result = { ...runtimeConfig };
  delete result.executeEnabled;
  delete result.manualExecutionApproved;
  delete result.manualApprovalConfigHash;
  delete result.manualApprovalExpiresAt;
  return result;
}

export function buildLiveTargetConfigHash(input: {
  target: {
    id: string;
    targetCode: string;
    targetName: string;
    platform: string;
    similarityThreshold: number;
    enabled: boolean;
  };
  aliases: Array<{
    aliasText: string;
    aliasType: string;
    weight: number;
    enabled: boolean;
  }>;
  featureConfig: {
    featureType: string;
    searchKeywords: string[];
    requiredKeywords: string[];
    forbiddenKeywords: string[];
    productKeywords: string[];
    liveSignals: string[];
    runtimeConfig: Record<string, unknown>;
    enabled: boolean;
  };
  bindings: Array<{
    deviceId: string | null;
    priority: number;
    enabled: boolean;
  }>;
}) {
  const canonical = stableJsonValue({
    hashVersion: 1,
    target: input.target,
    aliases: input.aliases
      .filter((item) => item.enabled)
      .map((item) => ({
        aliasText: item.aliasText,
        aliasType: item.aliasType,
        weight: item.weight
      }))
      .sort((left, right) => `${left.aliasType}:${left.aliasText}:${left.weight}`.localeCompare(`${right.aliasType}:${right.aliasText}:${right.weight}`)),
    featureConfig: {
      ...input.featureConfig,
      liveSignals: input.featureConfig.runtimeConfig.configVersion === 2 ? [] : input.featureConfig.liveSignals,
      runtimeConfig: businessRuntimeConfig(input.featureConfig.runtimeConfig)
    },
    bindings: input.bindings
      .filter((item) => item.enabled)
      .map((item) => ({ deviceId: item.deviceId, priority: item.priority }))
      .sort((left, right) => `${left.deviceId ?? "*"}:${left.priority}`.localeCompare(`${right.deviceId ?? "*"}:${right.priority}`))
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildMobileLiveTargetConfig(input: {
  target: {
    id?: string;
    targetCode: string;
    targetName: string;
    platform?: string;
    similarityThreshold?: number;
    enabled?: boolean;
  };
  aliases?: Array<{
    aliasText: string;
    aliasType?: string;
    weight?: number;
    enabled?: boolean;
  }>;
  featureConfig: {
    id?: string;
    featureType: LiveTargetFeatureType;
    searchKeywords?: unknown;
    requiredKeywords?: unknown;
    forbiddenKeywords?: unknown;
    productKeywords?: unknown;
    liveSignals?: unknown;
    runtimeConfig?: Record<string, unknown>;
    enabled?: boolean;
    revision?: number;
    configHash?: string | null;
  };
  configSource?: MobileLiveTargetConfig["configSource"];
  executionEligible?: boolean;
  executionBlockedReasons?: string[];
}) {
  const aliases = (input.aliases || [])
    .filter((item) => item && item.enabled !== false)
    .map((item) => mobileLiveTargetAliasSchema.parse(item));
  const rawRuntime = input.featureConfig.runtimeConfig ?? {};
  const workflowVersion = input.featureConfig.featureType === "commerce_card_live_comment" && rawRuntime.configVersion === 2 ? 2 : 1;
  const runtimeConfig = workflowVersion === 2
    ? normalizeCommerceCardWorkflowRuntimeConfig(rawRuntime)
    : rawRuntime;
  const configSource = input.configSource ?? (workflowVersion === 2 ? "target_center_v2" : "target_center_v1");

  return mobileLiveTargetConfigSchema.parse({
    targetId: input.target.id,
    targetCode: input.target.targetCode,
    targetName: input.target.targetName,
    platform: input.target.platform || "douyin",
    featureType: input.featureConfig.featureType,
    searchKeywords: normalizeList(input.featureConfig.searchKeywords),
    requiredKeywords: normalizeList(input.featureConfig.requiredKeywords),
    forbiddenKeywords: normalizeList(input.featureConfig.forbiddenKeywords),
    productKeywords: normalizeList(input.featureConfig.productKeywords),
    liveSignals: normalizeList(input.featureConfig.liveSignals),
    runtimeConfig,
    similarityThreshold: thresholdFromPercent(input.target.similarityThreshold ?? 0.9),
    aliases,
    enabled: input.target.enabled !== false && input.featureConfig.enabled !== false,
    configSource,
    workflowVersion,
    executionEligible: input.executionEligible ?? workflowVersion === 1,
    executionBlockedReasons: input.executionBlockedReasons ?? (workflowVersion === 2 ? ["WORKFLOW_V2_CONFIGURATION_ONLY"] : []),
    revision: input.featureConfig.revision,
    configHash: input.featureConfig.configHash
  });
}

export function buildDeviceLiveTargetsFromTaskConfig(input: {
  deviceCode?: string;
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
}) {
  const targets: MobileLiveTargetConfig[] = [];
  const botConfig = objectValue(input.liveCommentBotConfig);
  const targetRoom = objectValue(botConfig?.targetRoom);
  if (targetRoom && targetRoom.enabled === true) {
    const searchKeywords = normalizeList(targetRoom.searchKeywords);
    const matchKeywords = normalizeList(targetRoom.matchKeywords).concat(normalizeList(targetRoom.roomKeywords), normalizeList(targetRoom.titleKeywords));
    if (searchKeywords.length > 0) {
      targets.push(buildMobileLiveTargetConfig({
        target: {
          targetCode: targetCode(input.deviceCode, "live_comment"),
          targetName: targetNameFromRoom(targetRoom, searchKeywords[0]),
          platform: "douyin",
          similarityThreshold: numberValue(targetRoom.similarityThreshold, 0.9),
          enabled: true
        },
        aliases: aliasesFromKeywords(matchKeywords),
        featureConfig: {
          featureType: "live_comment",
          searchKeywords,
          requiredKeywords: normalizeList(targetRoom.requiredKeywords),
          forbiddenKeywords: normalizeList(targetRoom.forbiddenKeywords),
          enabled: true
        },
        configSource: "device_v1",
        executionEligible: true
      }));
    }
  }

  const p3Config = objectValue(input.p3ExtensionsConfig);
  const commerceConfig = objectValue(p3Config?.commerceCardLiveComment);
  if (commerceConfig && commerceConfig.enabled === true) {
    const commerceTargetRoom = objectValue(commerceConfig.targetRoom) ?? {};
    const searchKeywords = normalizeList(commerceConfig.searchKeywords);
    const productKeywords = normalizeList(commerceConfig.matchKeywords).concat(normalizeList(commerceConfig.productKeywords));
    const matchKeywords = normalizeList(commerceTargetRoom.matchKeywords).concat(normalizeList(commerceTargetRoom.roomKeywords), normalizeList(commerceTargetRoom.titleKeywords));
    if (searchKeywords.length > 0) {
      targets.push(buildMobileLiveTargetConfig({
        target: {
          targetCode: targetCode(input.deviceCode, "commerce_card_live_comment"),
          targetName: targetNameFromRoom(commerceTargetRoom, productKeywords[0] || searchKeywords[0]),
          platform: "douyin",
          similarityThreshold: numberValue(commerceTargetRoom.similarityThreshold, 0.9),
          enabled: true
        },
        aliases: aliasesFromKeywords(matchKeywords.length > 0 ? matchKeywords : productKeywords),
        featureConfig: {
          featureType: "commerce_card_live_comment",
          searchKeywords,
          requiredKeywords: normalizeList(commerceTargetRoom.requiredKeywords),
          forbiddenKeywords: normalizeList(commerceTargetRoom.forbiddenKeywords),
          productKeywords,
          liveSignals: normalizeList(commerceConfig.liveSignals),
          runtimeConfig: {
            configVersion: 1,
            executeEnabled: commerceConfig.executeEnabled === true,
            manualExecutionApproved: commerceConfig.manualExecutionApproved === true,
            scanMinutesPerRound: numberValue(commerceConfig.scanMinutesPerRound, 15),
            watchMinutesPerLive: numberValue(commerceConfig.watchMinutesPerLive, 15),
            maxRounds: numberValue(commerceConfig.maxRounds, 3),
            maxCommentsPerRoom: numberValue(commerceConfig.maxCommentsPerRoom, 1),
            commentPool: normalizeList(commerceConfig.commentPool)
          },
          enabled: true
        },
        configSource: "device_v1",
        executionEligible: true
      }));
    }
  }

  return targets;
}

export function mergeMobileLiveTargetConfigs(
  deviceConfigs: MobileLiveTargetConfig[],
  publicConfigs: MobileLiveTargetConfig[]
) {
  const overriddenFeatureTypes = new Set(deviceConfigs.map((item) => item.featureType));
  return [
    ...deviceConfigs,
    ...publicConfigs.filter((item) => !overriddenFeatureTypes.has(item.featureType))
  ];
}
