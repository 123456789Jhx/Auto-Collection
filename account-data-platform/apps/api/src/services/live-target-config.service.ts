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
