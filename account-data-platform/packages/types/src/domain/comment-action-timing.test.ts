import { describe, expect, it } from "bun:test";
import {
  commentActionTimingSchema,
  defaultCommentActionTiming,
  commentActionTimingActionKeys,
  resolveCommentActionTiming
} from "./comment-action-timing";

describe("comment action timing contract", () => {
  it("exposes all actions with zero ranges by default", () => {
    expect(commentActionTimingActionKeys).toHaveLength(17);
    expect(defaultCommentActionTiming.schemaVersion).toBe(1);
    expect(defaultCommentActionTiming.enabled).toBe(true);
    expect(defaultCommentActionTiming.actions.openDouyin).toEqual({ beforeMs: [0, 0], afterMs: [5000, 7000] });
    expect(defaultCommentActionTiming.actions.openSearchEntry).toEqual({ beforeMs: [0, 0], afterMs: [600, 1000] });
    expect(defaultCommentActionTiming.actions.readComments).toEqual({ beforeMs: [0, 0], afterMs: [0, 0] });
    expect(defaultCommentActionTiming.actions.finishRoomCapture).toEqual({ beforeMs: [0, 0], afterMs: [800, 1200] });
  });

  it("accepts partial action overrides", () => {
    const parsed = commentActionTimingSchema.parse({
      schemaVersion: 1,
      enabled: false,
      actions: { swipeComments: { beforeMs: [10, 20], afterMs: [30, 40] } }
    });
    expect(parsed.actions.swipeComments?.afterMs).toEqual([30, 40]);
  });

  it("rejects reversed, over-limit, and unknown ranges", () => {
    expect(commentActionTimingSchema.safeParse({ schemaVersion: 1, actions: { openDouyin: { beforeMs: [2, 1] } } }).success).toBe(false);
    expect(commentActionTimingSchema.safeParse({ schemaVersion: 1, actions: { openDouyin: { beforeMs: [0, 120001] } } }).success).toBe(false);
    expect(commentActionTimingSchema.safeParse({ schemaVersion: 1, actions: { unknown: { beforeMs: [0, 0] } } }).success).toBe(false);
  });

  it("resolves a complete copy snapshot with the legacy open-Douyin fallback", () => {
    const resolved = resolveCommentActionTiming({
      openDouyinWaitMs: [20_000, 20_000],
      commentActionTiming: {
        schemaVersion: 1,
        enabled: true,
        actions: { swipeComments: { afterMs: [900, 1200] } }
      }
    });

    expect(Object.keys(resolved.actions)).toHaveLength(17);
    expect(resolved.actions.openDouyin?.afterMs).toEqual([20_000, 20_000]);
    expect(resolved.actions.swipeComments?.beforeMs).toEqual([0, 0]);
    expect(resolved.actions.swipeComments?.afterMs).toEqual([900, 1200]);
  });

  it("ignores action overrides when timing is disabled", () => {
    const resolved = resolveCommentActionTiming({
      openDouyinWaitMs: [20_000, 20_000],
      commentActionTiming: {
        schemaVersion: 1,
        enabled: false,
        actions: { swipeComments: { afterMs: [900, 1200] } }
      }
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.actions.openDouyin?.afterMs).toEqual([20_000, 20_000]);
    expect(resolved.actions.swipeComments?.afterMs).toEqual([2500, 4500]);
  });
});
