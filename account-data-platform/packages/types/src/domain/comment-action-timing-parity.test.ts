import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { commentActionTimingSchema, defaultCommentActionTiming } from "./comment-action-timing";

const require = createRequire(import.meta.url);
const mobile = require("../../../../../mobile-agent/autojs/features/new-comment/action-timing.js");

describe("comment timing mobile/API contract parity", () => {
  test("all API action defaults are the waits actually resolved by the phone", () => {
    expect(mobile.createActionTiming({}).snapshot().actions).toEqual(defaultCommentActionTiming.actions);
  });

  test("a valid one-sided override changes only its boundary on the phone", () => {
    const config = commentActionTimingSchema.parse({
      schemaVersion: 1, enabled: true, actions: { openAnchorProfile: { beforeMs: [10001, 14999] } }
    });
    const resolver = mobile.createActionTiming({ profile: config });
    expect(resolver.range("openAnchorProfile", "before")).toEqual([10001, 14999]);
    expect(resolver.range("openAnchorProfile", "after")).toEqual([0, 0]);
    expect(resolver.range("openFirstLive", "after")).toEqual([7500, 8500]);
  });

  test("phone rejects invalid ranges instead of accepting values rejected by API", () => {
    for (const range of [["100", 200], [0.5, 2], [false, 200], [null, 200], [100, Infinity], [-1, 0]]) {
      const config = { schemaVersion: 1, enabled: true, actions: { readComments: { beforeMs: range } } };
      expect(commentActionTimingSchema.safeParse(config).success).toBe(false);
      expect(mobile.createActionTiming({ profile: config }).range("readComments", "before")).toEqual([0, 0]);
    }
  });
});
