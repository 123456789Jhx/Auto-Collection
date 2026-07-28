import { describe, expect, test } from "bun:test";
import { publishVideoConfigSchema } from "./publish-config";

const baseConfig = {
  externalBaseUrl: "https://wecom.example.test",
  externalTokenEnv: "PUBLISH_TOKEN",
  publishTimeSlots: ["11:00", "17:00"],
  responseDelayMsMin: 700,
  responseDelayMsMax: 1300,
  actionWaitMsMin: 900,
  actionWaitMsMax: 1700,
  expectedTopicCount: 5,
  downloadDir: "/sdcard/"
};

describe("publish video config", () => {
  test("strips the retired daily limit and defaults topic resolution timeout", () => {
    const parsed = publishVideoConfigSchema.parse({
      ...baseConfig,
      dailyLimitPerAccount: 1
    });

    expect(parsed).not.toHaveProperty("dailyLimitPerAccount");
    expect(parsed.topicResolveTimeoutMinutes).toBe(30);
  });
});
