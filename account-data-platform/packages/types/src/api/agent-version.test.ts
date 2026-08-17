import { describe, expect, test } from "bun:test";
import { createAgentVersionSchema } from "./admin";

describe("agent version channels", () => {
  test("accepts the isolated biz-scripts channel", () => {
    const result = createAgentVersionSchema.parse({
      version: "1.0.0",
      channel: "biz-scripts",
      packageUrl: "http://localhost:3012/downloads/agent/biz-scripts.zip",
      sha256: "a".repeat(64),
      entryFile: "biz-script-manifest.json"
    });
    expect(result.channel).toBe("biz-scripts");
  });

  test("requires verifiable package metadata for published biz scripts", () => {
    const base = {
      version: "1.2.3",
      channel: "biz-scripts" as const,
      status: "PUBLISHED" as const
    };

    expect(createAgentVersionSchema.safeParse(base).success).toBe(false);
    expect(createAgentVersionSchema.safeParse({
      ...base,
      packageUrl: "not-a-url",
      sha256: "invalid",
      entryFile: "main.js"
    }).success).toBe(false);
    expect(createAgentVersionSchema.safeParse({
      ...base,
      packageUrl: "https://example.test/biz-scripts.zip",
      sha256: "A".repeat(64),
      entryFile: "biz-script-manifest.json"
    }).success).toBe(true);
  });

  test("keeps draft and APK version payloads backward compatible", () => {
    expect(createAgentVersionSchema.safeParse({
      version: "1.2.3",
      channel: "biz-scripts",
      status: "DRAFT"
    }).success).toBe(true);
    expect(createAgentVersionSchema.safeParse({
      version: "1.2.3",
      channel: "stable",
      packageUrl: "https://example.test/agent.apk"
    }).success).toBe(true);
  });

  test("rejects biz-script versions that the mobile updater cannot compare", () => {
    expect(createAgentVersionSchema.safeParse({
      version: "release-20260808",
      channel: "biz-scripts",
      status: "DRAFT"
    }).success).toBe(false);
    expect(createAgentVersionSchema.safeParse({
      version: "1.4.20260808.1",
      channel: "biz-scripts",
      status: "DRAFT"
    }).success).toBe(true);
  });
});
