import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLiveCommentEntryCommands,
  buildLiveCommentEntryStopCommands,
  readActiveLiveCommentEntryBatchId,
  readLastLiveCommentEntryInput,
  resolveLiveCommentEntryState,
  resolveLiveCommentEntryStopState,
  summarizeLiveCommentEntryStates,
  writeActiveLiveCommentEntryBatchId,
  writeLastLiveCommentEntryInput
} from "../src/lib/live-comment-entry-form.ts";

test("builds one normalized live-entry command per unique device", () => {
  const commands = buildLiveCommentEntryCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "  药材种植  ",
    minViewerCount: 0,
    deviceCodes: [" device-a ", "device-b", "device-a", ""]
  });

  assert.deepEqual(commands.map((command) => command.deviceId), ["device-a", "device-b"]);
  assert(commands.every((command) => command.commandType === "ACCOUNT_WARMUP_RUN"));
  assert(commands.every((command) => command.payload.featureKey === "live_comment_entry"));
  assert(commands.every((command) => command.payload.config.targetKeyword === "药材种植"));
  assert(commands.every((command) => command.payload.config.minViewerCount === 0));
});

test("defaults the viewer floor and rejects invalid input", () => {
  const command = buildLiveCommentEntryCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "测试",
    deviceCodes: ["device-a"]
  })[0];
  assert.equal(command.payload.config.minViewerCount, 300);
  assert.throws(() => buildLiveCommentEntryCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "   ",
    deviceCodes: ["device-a"]
  }), /请输入目标直播间关键词/);
  assert.throws(() => buildLiveCommentEntryCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "测试",
    minViewerCount: -1,
    deviceCodes: ["device-a"]
  }), /人数下限/);
  assert.throws(() => buildLiveCommentEntryCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "测试",
    minViewerCount: 1.5,
    deviceCodes: ["device-a"]
  }), /人数下限/);
});

test("maps durable stages and terminal results for operator feedback", () => {
  const running = resolveLiveCommentEntryState({
    status: "RUNNING",
    resultJson: {
      stage: "OPENING_LIVE_TAB",
      stageHistory: ["OPENING_DOUYIN", "OPENING_SEARCH", "OPENING_LIVE_TAB"]
    }
  });
  assert.equal(running.key, "running");
  assert.equal(running.stageLabel, "切换到直播结果");
  assert.deepEqual(running.stageHistory, ["打开抖音", "打开搜索", "切换到直播结果"]);

  const entered = resolveLiveCommentEntryState({
    status: "DONE",
    resultJson: { status: "LIVE_COMMENT_ENTRY_ENTERED", stage: "ENTERED", stageHistory: ["ENTERED"] }
  });
  assert.equal(entered.key, "entered");
  assert.equal(entered.active, false);
  assert.equal(entered.stageLabel, "已进入直播间");

  const failed = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_FAILED",
      stage: "FAILED",
      failedStage: "OPENING_SEARCH",
      message: "search not found"
    }
  });
  assert.equal(failed.key, "failed");
  assert.equal(failed.stageLabel, "打开搜索");
  assert.equal(failed.message, "search not found");

  const ignoredStop = resolveLiveCommentEntryState({
    status: "RUNNING",
    resultJson: { stage: "OPENING_FIRST_RESULT" }
  }, "failed");
  assert.equal(ignoredStop.key, "running");
  assert.equal(ignoredStop.label, "停止失败");
});

test("builds scoped stops only for active unique run commands", () => {
  const commands = buildLiveCommentEntryStopCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    rows: [
      { id: "run-a", deviceCode: "device-a", status: "RUNNING" },
      { id: "run-a-copy", deviceCode: "device-a", status: "PENDING" },
      { id: "run-b", deviceCode: "device-b", status: "DONE" }
    ]
  });

  assert.deepEqual(commands, [{
    id: "run-a",
    deviceId: "device-a",
    payload: {
      batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
      targetCommandId: "run-a"
    }
  }]);
});

test("expires an unclaimed entry command instead of locking the batch forever", () => {
  const expired = resolveLiveCommentEntryState({
    status: "PENDING",
    expiresAt: "2026-08-18T00:00:00.000Z"
  }, "none", Date.parse("2026-08-18T00:00:01.000Z"));

  assert.equal(expired.key, "failed");
  assert.equal(expired.label, "执行超时");
  assert.equal(expired.active, false);
});

test("makes an expired stop command retryable", () => {
  assert.equal(resolveLiveCommentEntryStopState({
    status: "PENDING",
    expiresAt: "2026-08-18T00:00:00.000Z"
  }, Date.parse("2026-08-18T00:00:01.000Z")), "failed");
});

test("summarizes mixed device outcomes and persists refresh context", () => {
  assert.deepEqual(summarizeLiveCommentEntryStates([
    resolveLiveCommentEntryState({ status: "RUNNING", resultJson: { stage: "OPENING_SEARCH" } }),
    resolveLiveCommentEntryState({ status: "DONE", resultJson: { status: "LIVE_COMMENT_ENTRY_ENTERED" } }),
    resolveLiveCommentEntryState({ status: "FAILED", resultJson: { message: "failed" } })
  ]), { total: 3, running: 1, entered: 1, failed: 1 });

  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  writeActiveLiveCommentEntryBatchId(" 6f646271-82da-47d1-8ca5-6de3c7394348 ", storage);
  writeLastLiveCommentEntryInput({ targetKeyword: " 药材种植 ", minViewerCount: 500 }, storage);
  assert.equal(readActiveLiveCommentEntryBatchId(storage), "6f646271-82da-47d1-8ca5-6de3c7394348");
  assert.deepEqual(readLastLiveCommentEntryInput(storage), { targetKeyword: "药材种植", minViewerCount: 500 });
});

test("ignores a malformed persisted batch id", () => {
  const values = new Map([["live-comment-entry-active-batch-id", "batch-1"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  assert.equal(readActiveLiveCommentEntryBatchId(storage), "");
});
