import assert from "node:assert/strict";
import { test } from "bun:test";
import { normalizeOverride } from "../src/lib/device-profile-form";
import { acceptSavedTiming } from "../src/lib/device-profile-revision";
import { adjacentWait, hasCompleteTiming, timingDifferences, timingDraft, validateTiming } from "../src/lib/comment-action-timing-form";

test("invalid or unknown-version timing is rejected instead of silently altered", () => {
  assert.equal(normalizeOverride({ commentActionTiming: { schemaVersion: 1, enabled: true, actions: {
    swipeComments: { beforeMs: [-3.8, 400.2], afterMs: [800, 120001] }
  } } }), null);
  assert.equal(normalizeOverride({ commentActionTiming: { schemaVersion: 2, enabled: true, actions: {} } }), null);
});

test("unrelated profile values survive timing normalization", () => {
  const value = normalizeOverride({ outputRoots: ["/tmp"], capture: { timeoutMs: 3000 }, commentActionTiming: { schemaVersion: 1, enabled: false, actions: { openDouyin: { afterMs: [5000, 7000] } } } });
  assert.deepEqual(value?.outputRoots, ["/tmp"]);
  assert.equal(value?.capture?.timeoutMs, 3000);
  assert.equal(value?.commentActionTiming?.enabled, false);
});

test("empty disabled timing and partial pairs survive normalization", () => {
  assert.deepEqual(normalizeOverride({ commentActionTiming: { schemaVersion: 1, enabled: false, actions: {} } })?.commentActionTiming,
    { schemaVersion: 1, enabled: false, actions: {} });
  const partial = { schemaVersion: 1, enabled: true, actions: { swipeComments: { afterMs: [1, 2] } } };
  assert.deepEqual(normalizeOverride({ commentActionTiming: partial })?.commentActionTiming, partial);
});

test("draft merges inherited app wait and fills only missing action sides", () => {
  const draft = timingDraft({ openDouyinWaitMs: [10001, 14000], timing: { schemaVersion: 1, enabled: true, actions: {
    openDouyin: { beforeMs: [2, 3] }, swipeComments: { afterMs: [2501, 4501] }
  } } });
  assert.deepEqual(draft.actions.openDouyin, { beforeMs: [2, 3], afterMs: [10001, 14000] });
  assert.deepEqual(draft.actions.swipeComments, { beforeMs: [0, 0], afterMs: [2501, 4501] });
  assert.deepEqual(draft.actions.finishRoomCapture.afterMs, [800, 1200]);
});

test("drafts are independent and adjacent waits combine the two boundaries", () => {
  const first = timingDraft(); const second = timingDraft();
  first.actions.openDouyin.afterMs = [101, 205];
  first.actions.openSearchEntry.beforeMs = [11, 20];
  assert.deepEqual(adjacentWait(first, "openDouyin", "openSearchEntry"), [112, 225]);
  assert.deepEqual(second.actions.openDouyin.afterMs, [5000, 7000]);
  assert.equal(timingDifferences(first, second).length, 2);
});

test("saved configuration completeness ignores server JSON key order", () => {
  const draft = timingDraft();
  const reordered = { ...draft, actions: Object.fromEntries(Object.entries(draft.actions).reverse()) };
  assert.equal(hasCompleteTiming(reordered), true);
  assert.equal(hasCompleteTiming({ schemaVersion: 1, enabled: true, actions: { openDouyin: { afterMs: [1, 2] } } }), false);
  assert.equal(hasCompleteTiming(null), false);
});

test("validation rejects inverted and incomplete input while preserving milliseconds", () => {
  const draft = timingDraft();
  draft.actions.openDouyin.afterMs = [10101, 14000];
  assert.equal(validateTiming(draft), null);
  draft.actions.openDouyin.afterMs = [10101, 10000];
  assert.match(validateTiming(draft) || "", /最短等待不能大于最长等待/);
  draft.actions.openDouyin.afterMs = [Number.NaN, 14000];
  assert.match(validateTiming(draft) || "", /整数毫秒/);
});

test("invalid timing preserves valid other settings", () => {
  const value = normalizeOverride({ nodeQueryGraceMs: 120, commentActionTiming: { actions: { bad: { beforeMs: ["x", 3], afterMs: [0, 0] } } } });
  assert.equal(value?.nodeQueryGraceMs, 120);
  assert.equal(value?.commentActionTiming, undefined);
});

test("a child save only advances the parent revision when both edited the same snapshot", () => {
  const timing = timingDraft();
  const draft = { capture: { foregroundWaitMs: 900 } };
  const result = acceptSavedTiming(draft, "v1", timing, "v2", "v1");
  assert.equal(result.conflict, false);
  assert.equal(result.revision, "v2");
  assert.equal(result.draft.capture?.foregroundWaitMs, 900);
  assert.deepEqual(result.draft.commentActionTiming, timing);
});

test("a newer child snapshot cannot authorize an old parent draft to overwrite another editor", () => {
  const result = acceptSavedTiming({ capture: { foregroundWaitMs: 800 } }, "v1", timingDraft(), "v3", "v2");
  assert.equal(result.conflict, true);
  assert.equal(result.revision, "v1");
  assert.equal(result.draft.capture?.foregroundWaitMs, 800);
});
