import { describe, expect, test } from "bun:test";
import {
  accountWarmupRunPayloadSchema,
  accountWarmupStopPayloadSchema,
  accountWarmupTargetLiveConfigSchema,
  videoWarmupStopPayloadSchema
} from "./account-warmup";

const batchId = "6f646271-82da-47d1-8ca5-6de3c7394348";
const commandId = "5d397ac2-13f6-4f2c-ad5c-d8ea4441a717";

describe("account warmup command contracts", () => {
  test("normalizes one target keyword and deduplicates related terms", () => {
    expect(accountWarmupTargetLiveConfigSchema.parse({
      targetKeyword: "  药材种植  ",
      relatedTerms: [" 当归 ", "三七", "当归"],
      commentLibrary: [" 111，666 ", "888", "111"],
      singleLiveDurationMinutes: 10,
      totalWarmupDurationMinutes: 60,
      maxRounds: 3,
      candidatesPerRound: 4
    })).toEqual({
      targetKeyword: "药材种植",
      relatedTerms: ["当归", "三七"],
      commentLibrary: ["111", "666", "888"],
      commentCount: 0,
      singleLiveDurationMinutes: 10,
      totalWarmupDurationMinutes: 60,
      maxRounds: 3,
      candidatesPerRound: 4
    });
  });

  test("requires related terms and keeps the first node retry limits fixed", () => {
    expect(accountWarmupTargetLiveConfigSchema.safeParse({
      targetKeyword: "药材种植",
      relatedTerms: []
    }).success).toBe(false);
    expect(accountWarmupTargetLiveConfigSchema.safeParse({
      targetKeyword: "药材种植",
      relatedTerms: ["当归"],
      maxRounds: 2,
      candidatesPerRound: 4
    }).success).toBe(false);
  });

  test("wraps feature config in one generic hot-update command", () => {
    expect(accountWarmupRunPayloadSchema.parse({
      featureKey: "target_live_interaction",
      batchId,
      config: {
        targetKeyword: "药材种植",
        relatedTerms: ["当归"],
        singleLiveDurationMinutes: 10,
        totalWarmupDurationMinutes: 60
      }
    })).toEqual({
      featureKey: "target_live_interaction",
      batchId,
      config: {
        targetKeyword: "药材种植",
        relatedTerms: ["当归"],
        commentLibrary: [],
        commentCount: 0,
        singleLiveDurationMinutes: 10,
        totalWarmupDurationMinutes: 60,
        maxRounds: 3,
        candidatesPerRound: 4
      }
    });
    expect(accountWarmupRunPayloadSchema.safeParse({
      featureKey: "arbitrary/module/path",
      batchId,
      config: {}
    }).success).toBe(false);
  });

  test("accepts one custom keyword for a video-warmup batch", () => {
    expect(accountWarmupRunPayloadSchema.parse({
      featureKey: "video_warmup",
      batchId,
      config: { targetKeyword: "  人参种植  " }
    })).toEqual({
      featureKey: "video_warmup",
      batchId,
      config: {
        targetKeyword: "人参种植",
        secondsPerVideo: 10
      }
    });
  });

  test("requires a non-empty video-warmup keyword", () => {
    expect(accountWarmupRunPayloadSchema.safeParse({
      featureKey: "video_warmup",
      batchId,
      config: { targetKeyword: "   " }
    }).success).toBe(false);
    expect(accountWarmupRunPayloadSchema.safeParse({
      featureKey: "video_warmup",
      batchId,
      config: {}
    }).success).toBe(false);
  });

  test("requires whole-minute single and total warmup durations", () => {
    expect(accountWarmupTargetLiveConfigSchema.safeParse({
      targetKeyword: "药材种植",
      relatedTerms: ["当归"],
      singleLiveDurationMinutes: 0,
      totalWarmupDurationMinutes: 60
    }).success).toBe(false);
    expect(accountWarmupTargetLiveConfigSchema.safeParse({
      targetKeyword: "药材种植",
      relatedTerms: ["当归"],
      singleLiveDurationMinutes: 10,
      totalWarmupDurationMinutes: 60
    }).success).toBe(true);
  });
  test("requires a comment library when comments are requested", () => {
    expect(accountWarmupTargetLiveConfigSchema.safeParse({
      targetKeyword: "药材种植",
      relatedTerms: ["当归"],
      commentCount: 1,
      commentLibrary: []
    }).success).toBe(false);
  });
  test("validates stop commands against one active device command", () => {
    expect(accountWarmupStopPayloadSchema.parse({ batchId, targetCommandId: commandId }))
      .toEqual({ batchId, targetCommandId: commandId });
    expect(accountWarmupStopPayloadSchema.safeParse({ batchId: "bad", targetCommandId: commandId }).success)
      .toBe(false);
  });

  test("scopes video warmup stops to one batch without a target command", () => {
    expect(videoWarmupStopPayloadSchema.parse({
      featureKey: "video_warmup",
      batchId,
      reason: "USER_REQUESTED"
    })).toEqual({
      featureKey: "video_warmup",
      batchId,
      reason: "USER_REQUESTED"
    });
    expect(videoWarmupStopPayloadSchema.safeParse({
      featureKey: "target_live_interaction",
      batchId,
      reason: "USER_REQUESTED"
    }).success).toBe(false);
  });
});
