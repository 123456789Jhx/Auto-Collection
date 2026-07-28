import { describe, expect, test } from "bun:test";
import { defaultCommerceCardWorkflowRuntimeConfig, updateDeviceTaskConfigSchema } from "@pkg/types";
import { buildDeviceLiveTargetsFromTaskConfig, buildLiveTargetConfigHash, buildMobileLiveTargetConfig, liveTargetFeatureConfigSchema, liveTargetPayloadSchema, mergeMobileLiveTargetConfigs, normalizeCommerceCardWorkflowRuntimeConfig } from "./live-target-config.service";

describe("live target config service", () => {
  test("validates a live target with aliases and a 90 percent threshold", () => {
    const parsed = liveTargetPayloadSchema.safeParse({
      targetCode: "zigui_xiacheng",
      targetName: "秭归夏橙直播间",
      platform: "douyin",
      similarityThreshold: 0.9,
      enabled: true,
      aliases: [
        { aliasText: "秭归夏橙", aliasType: "room_name", weight: 100, enabled: true },
        { aliasText: "夏橙助农", aliasType: "card_title", weight: 80, enabled: true }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  test("validates separate feature configs for search live comments and commerce-card live comments", () => {
    const searchConfig = liveTargetFeatureConfigSchema.parse({
      featureType: "live_comment",
      searchKeywords: ["夏橙", "秭归夏橙"],
      forbiddenKeywords: ["回放"],
      enabled: true
    });
    const commerceConfig = liveTargetFeatureConfigSchema.parse({
      featureType: "commerce_card_live_comment",
      searchKeywords: ["夏橙"],
      productKeywords: ["秭归", "夏橙"],
      liveSignals: ["直播中", "讲解中"],
      runtimeConfig: {
        scanMinutesPerRound: 15,
        watchMinutesPerLive: 15,
        maxRounds: 3,
        maxCommentsPerRoom: 1,
        commentPool: ["111", "666"]
      },
      enabled: true
    });

    expect(searchConfig.featureType).toBe("live_comment");
    expect(commerceConfig.featureType).toBe("commerce_card_live_comment");
  });

  test("builds the mobile liveTargets payload without forcing targetName as search keyword", () => {
    const payload = buildMobileLiveTargetConfig({
      target: {
        targetCode: "zigui_xiacheng",
        targetName: "秭归夏橙直播间",
        platform: "douyin",
        similarityThreshold: 0.9,
        enabled: true
      },
      aliases: [
        { aliasText: "秭归夏橙", aliasType: "room_name", weight: 100, enabled: true },
        { aliasText: "夏橙助农", aliasType: "card_title", weight: 80, enabled: true }
      ],
      featureConfig: {
        featureType: "live_comment",
        searchKeywords: ["夏橙"],
        requiredKeywords: [],
        forbiddenKeywords: ["回放"],
        enabled: true
      }
    });

    expect(payload.targetName).toBe("秭归夏橙直播间");
    expect(payload.searchKeywords).toEqual(["夏橙"]);
    expect(payload.searchKeywords).not.toContain("秭归夏橙直播间");
    expect(payload.similarityThreshold).toBe(0.9);
    expect(payload.aliases.map((item) => item.aliasText)).toEqual(["秭归夏橙", "夏橙助农"]);
  });

  test("builds device-level liveTargets from per-phone task config", () => {
    const targets = buildDeviceLiveTargetsFromTaskConfig({
      deviceCode: "device_001",
      liveCommentBotConfig: {
        targetRoom: {
          enabled: true,
          targetName: "秭归夏橙直播间",
          searchKeywords: ["夏橙"],
          matchKeywords: ["秭归夏橙"]
        }
      },
      p3ExtensionsConfig: {
        commerceCardLiveComment: {
          enabled: true,
          executeEnabled: false,
          manualExecutionApproved: false,
          searchKeywords: ["夏橙商品卡"],
          matchKeywords: ["秭归", "夏橙"],
          liveSignals: ["直播中"],
          scanMinutesPerRound: 15,
          watchMinutesPerLive: 15,
          maxRounds: 3,
          maxCommentsPerRoom: 1,
          commentPool: ["111"],
          targetRoom: {
            enabled: true,
            targetName: "秭归夏橙直播间",
            matchKeywords: ["秭归夏橙"]
          }
        }
      }
    });

    expect(targets.map((item) => item.featureType)).toEqual(["live_comment", "commerce_card_live_comment"]);
    expect(targets[0].targetCode).toBe("device_001_live_comment");
    expect(targets[0].searchKeywords).toEqual(["夏橙"]);
    expect(targets[1].searchKeywords).toEqual(["夏橙商品卡"]);
    expect(targets[1].productKeywords).toEqual(["秭归", "夏橙"]);
    expect(targets[1].runtimeConfig).toMatchObject({ scanMinutesPerRound: 15, watchMinutesPerLive: 15, maxRounds: 3 });
    expect(targets[1].runtimeConfig).toMatchObject({ configVersion: 1 });
    expect(targets[1].configSource).toBe("device_v1");
  });

  test("accepts commerce-card targetRoom in device task config payload", () => {
    const parsed = updateDeviceTaskConfigSchema.safeParse({
      p3ExtensionsConfig: {
        commerceCardLiveComment: {
          enabled: true,
          searchKeywords: ["夏橙商品卡"],
          matchKeywords: ["秭归", "夏橙"],
          productKeywords: ["秭归", "夏橙"],
          productCardDwellSeconds: 120,
          targetRoom: {
            enabled: true,
            targetName: "秭归夏橙直播间",
            matchKeywords: ["秭归夏橙"],
            similarityThreshold: 0.9
          }
        }
      }
    });

    expect(parsed.success).toBe(true);
  });

  test("normalizes legacy commerce-card fields into the safe V2 default stage", () => {
    const runtime = normalizeCommerceCardWorkflowRuntimeConfig({
      scanMinutesPerRound: 20,
      maxRounds: 2,
      watchMinutesPerLive: 30,
      commentPool: ["第一条", "第一条", "第二条"]
    });

    expect(runtime.configVersion).toBe(2);
    expect(runtime.enabledStages).toEqual(["product_nurture"]);
    expect(runtime.productNurtureRoundMinutes).toBe(20);
    expect(runtime.productNurtureMaxRounds).toBe(2);
    expect(runtime.commentPool).toEqual(["第一条", "第二条"]);
    expect("watchMinutesPerLive" in runtime).toBe(false);
  });

  test("rejects unsafe stage combinations and incomplete comment pools", () => {
    const missingProductStage = liveTargetFeatureConfigSchema.safeParse({
      featureType: "commerce_card_live_comment",
      searchKeywords: ["柑橘"],
      productKeywords: ["柑橘"],
      runtimeConfig: {
        ...defaultCommerceCardWorkflowRuntimeConfig,
        enabledStages: ["live_nurture"],
        liveNurtureKeywords: ["柑橘"]
      }
    });
    const insufficientComments = liveTargetFeatureConfigSchema.safeParse({
      featureType: "commerce_card_live_comment",
      searchKeywords: ["柑橘"],
      productKeywords: ["柑橘"],
      runtimeConfig: {
        ...defaultCommerceCardWorkflowRuntimeConfig,
        enabledStages: ["target_comment"],
        maxCommentsPerRoom: 2,
        commentPool: ["仅一条"]
      }
    });

    expect(missingProductStage.success).toBe(false);
    expect(insufficientComments.success).toBe(false);
  });

  test("keeps realtime executeEnabled outside the canonical business hash", () => {
    const hashInput = {
      target: {
        id: "11111111-1111-4111-8111-111111111111",
        targetCode: "citrus_target",
        targetName: "柑橘直播间",
        platform: "douyin",
        similarityThreshold: 0.9,
        enabled: true
      },
      aliases: [{ aliasText: "柑橘助农", aliasType: "room_name", weight: 100, enabled: true }],
      featureConfig: {
        featureType: "commerce_card_live_comment",
        searchKeywords: ["柑橘"],
        requiredKeywords: [],
        forbiddenKeywords: ["回放"],
        productKeywords: ["柑橘"],
        liveSignals: ["直播中"],
        runtimeConfig: { ...defaultCommerceCardWorkflowRuntimeConfig, executeEnabled: false },
        enabled: true
      },
      bindings: [{ deviceId: null, priority: 1, enabled: true }]
    };
    const disabledHash = buildLiveTargetConfigHash(hashInput);
    const enabledHash = buildLiveTargetConfigHash({
      ...hashInput,
      featureConfig: {
        ...hashInput.featureConfig,
        runtimeConfig: { ...hashInput.featureConfig.runtimeConfig, executeEnabled: true }
      }
    });
    const changedBusinessHash = buildLiveTargetConfigHash({
      ...hashInput,
      featureConfig: {
        ...hashInput.featureConfig,
        runtimeConfig: { ...hashInput.featureConfig.runtimeConfig, productCardDwellSeconds: 150 }
      }
    });

    expect(enabledHash).toBe(disabledHash);
    expect(changedBusinessHash).not.toBe(disabledHash);
  });

  test("keeps V2 previews non-executable and lets device V1 override public V1", () => {
    const v2 = buildMobileLiveTargetConfig({
      target: { targetCode: "public_v2", targetName: "公共 V2 目标" },
      featureConfig: {
        featureType: "commerce_card_live_comment",
        searchKeywords: ["柑橘"],
        productKeywords: ["柑橘"],
        runtimeConfig: defaultCommerceCardWorkflowRuntimeConfig
      }
    });
    const device = buildDeviceLiveTargetsFromTaskConfig({
      deviceCode: "device_001",
      p3ExtensionsConfig: {
        commerceCardLiveComment: {
          enabled: true,
          searchKeywords: ["设备柑橘"],
          matchKeywords: ["柑橘"]
        }
      }
    });
    const merged = mergeMobileLiveTargetConfigs(device, [{ ...v2, workflowVersion: 1, configSource: "target_center_v1", executionEligible: true }]);

    expect(v2.workflowVersion).toBe(2);
    expect(v2.executionEligible).toBe(false);
    expect(merged.filter((item) => item.featureType === "commerce_card_live_comment")).toHaveLength(1);
    expect(merged[0].configSource).toBe("device_v1");
  });
});
