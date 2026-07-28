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
});
