import { describe, expect, test } from "bun:test";
import {
  publishClientOnlyConfigSchema,
  publishVideoConfigSchema
} from "./publish-config";

const executionConfig = {
  responseDelayMsMin: 700,
  responseDelayMsMax: 1300,
  actionWaitMsMin: 900,
  actionWaitMsMax: 1700,
  expectedTopicCount: 5,
  downloadDir: "/sdcard/"
};

const externalConfig = {
  ...executionConfig,
  externalBaseUrl: "https://wecom.example.test",
  externalTokenEnv: "PUBLISH_TOKEN",
  publishTimeSlots: ["11:00", "17:00"]
};

describe("publish video config", () => {
  test("accepts direct material execution config without external integration fields", () => {
    const parsed = publishVideoConfigSchema.parse({
      ...executionConfig,
      sourceMode: "direct_material"
    });

    expect(parsed).toMatchObject({
      sourceMode: "direct_material",
      requireCover: true,
      isDefault: false,
      topicResolveTimeoutMinutes: 30
    });
    expect(parsed).not.toHaveProperty("externalBaseUrl");
    expect(parsed).not.toHaveProperty("externalTokenEnv");
    expect(parsed).not.toHaveProperty("publishTimeSlots");
  });

  test("requires the URL and token environment name for external pull", () => {
    const { externalBaseUrl: _externalBaseUrl, ...withoutUrl } = externalConfig;
    expect(publishVideoConfigSchema.safeParse(withoutUrl).success).toBe(false);

    const { externalTokenEnv: _externalTokenEnv, ...withoutTokenEnvironment } = externalConfig;
    expect(publishVideoConfigSchema.safeParse(withoutTokenEnvironment).success).toBe(false);
  });

  test("requires both fixed connection fields in client-only config", () => {
    expect(publishClientOnlyConfigSchema.safeParse({
      externalBaseUrl: "https://wecom.example.test"
    }).success).toBe(false);
    expect(publishClientOnlyConfigSchema.safeParse({
      externalTokenEnv: "PUBLISH_TOKEN"
    }).success).toBe(false);
    expect(publishClientOnlyConfigSchema.safeParse({
      externalBaseUrl: "https://wecom.example.test",
      externalTokenEnv: "PUBLISH_TOKEN"
    }).success).toBe(true);
  });

  test("rejects an empty token environment name in both config schemas", () => {
    expect(publishVideoConfigSchema.safeParse({
      ...externalConfig,
      externalTokenEnv: ""
    }).success).toBe(false);
    expect(publishClientOnlyConfigSchema.safeParse({
      externalBaseUrl: externalConfig.externalBaseUrl,
      externalTokenEnv: ""
    }).success).toBe(false);
  });

  test("defaults legacy time slots for external pull", () => {

    const withoutLegacySlots: Record<string, unknown> = {
      ...externalConfig,
      sourceMode: "external_pull"
    };
    delete withoutLegacySlots.publishTimeSlots;
    const parsed = publishVideoConfigSchema.parse(withoutLegacySlots);
    if (parsed.sourceMode !== "external_pull") throw new Error("expected external pull config");
    expect(parsed.publishTimeSlots).toEqual([]);
  });

  test("interprets legacy configs without source mode as external pull", () => {
    const parsed = publishVideoConfigSchema.parse({
      ...externalConfig,
      dailyLimitPerAccount: 1
    });

    expect(parsed.sourceMode).toBe("external_pull");
    if (parsed.sourceMode !== "external_pull") throw new Error("expected external pull config");
    expect(parsed.platforms).toEqual(["\u6296\u97f3", "\u89c6\u9891\u53f7"]);
    expect(parsed).not.toHaveProperty("dailyLimitPerAccount");
    expect(parsed.topicResolveTimeoutMinutes).toBe(30);
  });
});
