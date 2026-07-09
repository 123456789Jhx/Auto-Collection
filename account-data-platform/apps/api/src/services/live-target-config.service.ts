import { z } from "zod";

const textListSchema = z.array(z.string().trim().min(1).max(100)).max(50).default([]);

export const liveTargetFeatureTypeSchema = z.enum(["live_comment", "commerce_card_live_comment"]);

export const liveTargetAliasSchema = z.object({
  id: z.string().uuid().optional(),
  aliasText: z.string().trim().min(1).max(200),
  aliasType: z.string().trim().min(1).max(32).default("room_name"),
  weight: z.number().int().min(0).max(1000).default(100),
  enabled: z.boolean().default(true)
});

export const liveTargetPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  targetCode: z.string().trim().min(1).max(64),
  targetName: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(32).default("douyin"),
  similarityThreshold: z.number().min(0.5).max(1).default(0.9),
  enabled: z.boolean().default(true),
  remark: z.string().trim().max(500).optional().nullable(),
  aliases: z.array(liveTargetAliasSchema).max(50).optional()
});

export const liveTargetFeatureConfigSchema = z.object({
  id: z.string().uuid().optional(),
  featureType: liveTargetFeatureTypeSchema,
  searchKeywords: textListSchema,
  requiredKeywords: textListSchema,
  forbiddenKeywords: textListSchema,
  productKeywords: textListSchema,
  liveSignals: textListSchema,
  runtimeConfig: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true)
});

export const liveTargetDeviceBindingSchema = z.object({
  deviceId: z.string().uuid().nullable().optional(),
  deviceCode: z.string().trim().min(1).max(64).optional(),
  targetId: z.string().uuid(),
  featureType: liveTargetFeatureTypeSchema,
  priority: z.number().int().min(1).max(1000).default(100),
  enabled: z.boolean().default(true)
});

export type LiveTargetPayload = z.infer<typeof liveTargetPayloadSchema>;
export type LiveTargetFeatureConfigPayload = z.infer<typeof liveTargetFeatureConfigSchema>;
export type LiveTargetAliasPayload = z.infer<typeof liveTargetAliasSchema>;
export type LiveTargetDeviceBindingPayload = z.infer<typeof liveTargetDeviceBindingSchema>;

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

function targetCode(deviceCode: string | undefined, featureType: "live_comment" | "commerce_card_live_comment") {
  return `${stringValue(deviceCode) || "device"}_${featureType}`;
}

export function thresholdToPercent(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 90;
  }
  if (numberValue <= 1) {
    return Math.round(Math.max(0.5, Math.min(1, numberValue)) * 100);
  }
  return Math.round(Math.max(50, Math.min(100, numberValue)));
}

export function thresholdFromPercent(value: unknown) {
  const percent = thresholdToPercent(value);
  return Number((percent / 100).toFixed(2));
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
    featureType: "live_comment" | "commerce_card_live_comment";
    searchKeywords?: unknown;
    requiredKeywords?: unknown;
    forbiddenKeywords?: unknown;
    productKeywords?: unknown;
    liveSignals?: unknown;
    runtimeConfig?: Record<string, unknown>;
    enabled?: boolean;
  };
}) {
  const aliases = (input.aliases || [])
    .filter((item) => item && item.enabled !== false)
    .map((item) => liveTargetAliasSchema.parse(item));

  return {
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
    runtimeConfig: input.featureConfig.runtimeConfig || {},
    similarityThreshold: thresholdFromPercent(input.target.similarityThreshold ?? 0.9),
    aliases,
    enabled: input.target.enabled !== false && input.featureConfig.enabled !== false
  };
}

export function buildDeviceLiveTargetsFromTaskConfig(input: {
  deviceCode?: string;
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
}) {
  const targets: ReturnType<typeof buildMobileLiveTargetConfig>[] = [];
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
        }
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
            executeEnabled: commerceConfig.executeEnabled === true,
            manualExecutionApproved: commerceConfig.manualExecutionApproved === true,
            scanMinutesPerRound: numberValue(commerceConfig.scanMinutesPerRound, 15),
            watchMinutesPerLive: numberValue(commerceConfig.watchMinutesPerLive, 15),
            maxRounds: numberValue(commerceConfig.maxRounds, 3),
            maxCommentsPerRoom: numberValue(commerceConfig.maxCommentsPerRoom, 1),
            commentPool: normalizeList(commerceConfig.commentPool)
          },
          enabled: true
        }
      }));
    }
  }

  return targets;
}
