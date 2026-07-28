import { describe, expect, test } from "bun:test";
import { createRemoteScriptConfigSchema } from "./remote-script";

describe("createRemoteScriptConfigSchema", () => {
  test("accepts a valid remote script config", () => {
    const result = createRemoteScriptConfigSchema.parse({
      scriptKey: "generic_form",
      configName: "玉米发布计划",
      configPayload: {
        keywords: ["玉米", "病虫害"],
        dailyLimit: 10
      }
    });

    expect(result.status).toBe("ENABLED");
    expect(result.configPayload).toEqual({
      keywords: ["玉米", "病虫害"],
      dailyLimit: 10
    });
  });

  test("rejects a config missing required fields", () => {
    const result = createRemoteScriptConfigSchema.safeParse({
      scriptKey: "generic_form",
      configName: "缺少配置内容"
    });

    expect(result.success).toBe(false);
  });

  test("rejects a config payload larger than 16KB after serialization", () => {
    const result = createRemoteScriptConfigSchema.safeParse({
      scriptKey: "generic_form",
      configName: "超长配置",
      configPayload: {
        content: "农".repeat(6_000)
      }
    });

    expect(result.success).toBe(false);
  });
});
