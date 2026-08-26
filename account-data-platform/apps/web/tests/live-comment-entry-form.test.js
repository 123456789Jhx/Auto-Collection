import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLiveCommentEntryCommands,
  buildLiveCommentEntryStopCommands,
  getRestoredLiveCommentEntryWarningIds,
  isLiveCommentEntryBatchFinished,
  isLiveCommentEntryCaptureCompleted,
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

  const capturing = resolveLiveCommentEntryState({
    status: "RUNNING",
    resultJson: {
      stage: "SWIPING_COMMENTS",
      stageHistory: ["CAPTURING_COMMENTS", "SWIPING_COMMENTS"]
    }
  });
  assert.equal(capturing.key, "running");
  assert.equal(capturing.stageLabel, "上滑评论区");
  assert.deepEqual(capturing.stageHistory, ["识别评论", "上滑评论区"]);

  const captured = resolveLiveCommentEntryState({
    status: "DONE",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_CAPTURED",
      stage: "COMMENTS_CAPTURED",
      commentCount: 12
    }
  });
  assert.equal(captured.key, "captured");
  assert.equal(captured.label, "抓取完成");
  assert.equal(captured.stageLabel, "评论抓取完成");

  const compatibleCapturedCommand = {
    status: "DONE",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      comments: []
    }
  };
  assert.equal(isLiveCommentEntryCaptureCompleted(compatibleCapturedCommand), true);
  assert.equal(resolveLiveCommentEntryState(compatibleCapturedCommand).key, "captured");

  const cleaningUp = resolveLiveCommentEntryState({
    status: "RUNNING",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      captureCompleted: true,
      comments: [{ commentText: "已经抓到" }],
      stage: "CLEANING_UP"
    }
  });
  assert.equal(cleaningUp.key, "running");
  assert.equal(cleaningUp.active, true);
  assert.equal(cleaningUp.stageLabel, "退出抖音");

  const cleanupFailed = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_CLEANUP_FAILED",
      captureCompleted: true,
      comments: [{ commentText: "保留下来的评论" }],
      failedStage: "RETURNING_TO_AGENT"
    }
  });
  assert.equal(cleanupFailed.key, "cleanup_failed");
  assert.equal(cleanupFailed.label, "收尾失败");
  assert.equal(cleanupFailed.stageLabel, "返回燎原星火");

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

  const verification = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
      reasonCode: "PLATFORM_VERIFICATION",
      message: "出现平台验证",
      failedStage: "OPENING_FIRST_RESULT"
    }
  });
  assert.equal(verification.key, "platform_verification");
  assert.equal(verification.label, "平台验证");
  assert.equal(verification.message, "出现平台验证");

  const viewerFailure = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED",
      reasonCode: "VIEWER_COUNT_READ_FAILED",
      message: "无法识别直播间人数，脚本已停止",
      failedStage: "CHECKING_VIEWER_COUNT"
    }
  });
  assert.equal(viewerFailure.key, "viewer_count_failed");
  assert.equal(viewerFailure.label, "人数检测失败");
  assert.equal(viewerFailure.message, "无法识别直播间人数，脚本已停止");

  const endedExhausted = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED",
      reasonCode: "LIVE_ROOM_ENDED",
      message: "连续直播间均已结束，脚本已停止",
      failedStage: "SKIPPING_ENDED_LIVE_ROOM",
      stageHistory: ["SKIPPING_ENDED_LIVE_ROOM", "FAILED"]
    }
  });
  assert.equal(endedExhausted.key, "live_ended_exhausted");
  assert.equal(endedExhausted.label, "直播已结束");
  assert.equal(endedExhausted.stageLabel, "直播已结束，切换直播间");

  const endedSkipFailed = resolveLiveCommentEntryState({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_LIVE_ENDED_SKIP_FAILED",
      reasonCode: "NEXT_LIVE_ROOM_FAILED",
      message: "直播已结束后切换下一个直播间失败，脚本已停止",
      failedStage: "SKIPPING_ENDED_LIVE_ROOM"
    }
  });
  assert.equal(endedSkipFailed.key, "live_ended_skip_failed");
  assert.equal(endedSkipFailed.label, "切换直播间失败");

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
    resolveLiveCommentEntryState({ status: "DONE", resultJson: { status: "LIVE_COMMENT_ENTRY_CAPTURED" } }),
    resolveLiveCommentEntryState({ status: "FAILED", resultJson: { message: "failed" } })
  ]), { total: 3, running: 1, captured: 1, failed: 1 });

  assert.equal(isLiveCommentEntryBatchFinished([
    resolveLiveCommentEntryState({ status: "DONE", resultJson: { status: "LIVE_COMMENT_ENTRY_CAPTURED" } }),
    resolveLiveCommentEntryState({ status: "FAILED", resultJson: { message: "failed" } })
  ]), true);
  assert.equal(isLiveCommentEntryBatchFinished([
    resolveLiveCommentEntryState({ status: "RUNNING", resultJson: { stage: "CAPTURING_COMMENTS" } })
  ]), false);
  assert.equal(isLiveCommentEntryBatchFinished([]), false);

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

test("does not count a failed capture merely because it returned an empty comments array", () => {
  assert.equal(isLiveCommentEntryCaptureCompleted({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED",
      reasonCode: "COMMENT_OCR_EMPTY",
      comments: []
    }
  }), false);
  assert.equal(isLiveCommentEntryCaptureCompleted({
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_CLEANUP_FAILED",
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      comments: [{ commentText: "已抓到" }]
    }
  }), true);
});

test("maps capture-time platform verification while keeping partial comments incomplete", () => {
  const command = {
    status: "FAILED",
    resultJson: {
      status: "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION",
      reasonCode: "CAPTURE_PLATFORM_VERIFICATION",
      platformVerification: true,
      comments: [{ commentText: "已抓到但未完成" }]
    }
  };
  assert.equal(resolveLiveCommentEntryState(command).key, "platform_verification");
  assert.equal(isLiveCommentEntryCaptureCompleted(command), false);
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

test("only acknowledges warnings from the batch restored when the page opened", () => {
  const rows = [
    { id: "warning-a" },
    { id: "warning-b" }
  ];

  assert.deepEqual(
    getRestoredLiveCommentEntryWarningIds(rows, "batch-a", "batch-a"),
    ["warning-a", "warning-b"]
  );
  assert.deepEqual(
    getRestoredLiveCommentEntryWarningIds(rows, "batch-a", "batch-b"),
    []
  );
});
