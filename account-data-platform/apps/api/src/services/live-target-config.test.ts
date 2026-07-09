import { describe, expect, test } from "bun:test";
import { updateDeviceTaskConfigSchema } from "@pkg/types";
import { buildDeviceLiveTargetsFromTaskConfig, buildMobileLiveTargetConfig, liveTargetFeatureConfigSchema, liveTargetPayloadSchema } from "./live-target-config.service";

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
  });

  test("accepts commerce-card targetRoom in device task config payload", () => {
    const parsed = updateDeviceTaskConfigSchema.safeParse({
      p3ExtensionsConfig: {
        commerceCardLiveComment: {
          enabled: true,
          searchKeywords: ["夏橙商品卡"],
          matchKeywords: ["秭归", "夏橙"],
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
});
