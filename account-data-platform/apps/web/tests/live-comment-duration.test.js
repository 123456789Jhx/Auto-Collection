import assert from "node:assert/strict";
import { test } from "node:test";
import { accountWarmupRunPayloadSchema } from "../../../packages/types/src/domain/account-warmup.ts";
import { buildLiveCommentEntryCommands, readLastLiveCommentEntryInput, writeLastLiveCommentEntryInput } from "../src/lib/live-comment-entry-form.ts";
import { createLiveCommentEntryBatchPlan, dispatchLiveCommentEntryDevices, readLiveCommentEntryBatchPlan, writeLiveCommentEntryBatchPlan } from "../src/lib/live-comment-entry-batch.ts";

const batchId = "6f646271-82da-47d1-8ca5-6de3c7394348";
test("isolated commands default to five minutes and reject out-of-range durations", () => {
  const payload = { featureKey: "isolated_live_comment_entry", batchId, config: { targetKeyword: "crop" } };
  assert.equal(accountWarmupRunPayloadSchema.parse(payload).config.captureDurationMinutes, 5);
  for (const minutes of [0, -1, 1.5, 61]) {
    assert.equal(accountWarmupRunPayloadSchema.safeParse({ ...payload, config: { ...payload.config, captureDurationMinutes: minutes } }).success, false);
    assert.throws(() => buildLiveCommentEntryCommands({ batchId, targetKeyword: "crop", deviceCodes: ["device"], captureDurationMinutes: minutes }));
  }
  assert.equal(accountWarmupRunPayloadSchema.safeParse({ ...payload, featureKey: "live_comment_entry" }).success, false);
});

test("custom duration survives form and batch restoration and reaches every device", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const input = { targetKeyword: "crop", minViewerCount: 10, captureDurationMinutes: 2 };
  writeLastLiveCommentEntryInput(input, storage);
  assert.deepEqual(readLastLiveCommentEntryInput(storage), input);
  const batch = createLiveCommentEntryBatchPlan({ ...input, batchId, devices: ["a", "b"].map((id) => ({ deviceCode: id, deviceId: id, deviceName: id })) });
  writeLiveCommentEntryBatchPlan(batch, storage);
  const restored = readLiveCommentEntryBatchPlan(batchId, storage);
  const sent = [];
  await dispatchLiveCommentEntryDevices({ batch: restored, deviceCodes: ["a", "b"], send: async (command) => sent.push(command) });
  assert.deepEqual(sent.map((command) => accountWarmupRunPayloadSchema.parse(command.payload).config.captureDurationMinutes), [2, 2]);
  assert.equal(buildLiveCommentEntryCommands({ ...input, batchId, deviceCodes: ["a"] })[0].payload.config.captureDurationMinutes, 2);
  writeLastLiveCommentEntryInput({ targetKeyword: "crop" }, storage);
  assert.equal(readLastLiveCommentEntryInput(storage).captureDurationMinutes, 5);
});
