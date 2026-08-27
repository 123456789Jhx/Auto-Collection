"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var createBridge = require("../features/new-comment/command-bridge.js").createNewCommentCommandBridge;
var createOutbox = require("../features/new-comment/command-ack-outbox.js").createCommandAckOutbox;
var FEATURE_KEY = "isolated_live_comment_entry";

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {} };
}

function runCommand(id, batchId) {
  return command(id, "ACCOUNT_WARMUP_RUN", {
    featureKey: FEATURE_KEY, batchId: batchId,
    config: { targetKeyword: "药材种植", minViewerCount: 0 }
  });
}

function harness(options) {
  options = options || {};
  var polls = options.polls || [[]];
  var pollIndex = 0;
  var ackPlan = (options.ackPlan || []).slice();
  var acks = [];
  var events = [];
  var threads = [];
  var cleanupCount = 0;
  var runCount = 0;
  var task = {
    cleanup: { run: function () { cleanupCount += 1; events.push("cleanup"); return { completed: true }; } },
    run: function () { runCount += 1; return options.workerResult || { status: "LIVE_COMMENT_ENTRY_CAPTURED" }; }
  };
  var context = {
    config: { device: { deviceId: "device-outbox" } },
    uploader: {
      pollCommands: function () { return polls[Math.min(pollIndex++, polls.length - 1)] || []; },
      ackCommand: function (id, status, result) {
        acks.push({ id: id, status: status, result: result });
        events.push("ack:" + id + ":" + status);
        if (options.ackResponder) return options.ackResponder(id, status, result);
        var response = ackPlan.length ? ackPlan.shift() : undefined;
        if (response instanceof Error) throw response;
        return response;
      }
    },
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function () {
      return { createIsolatedLiveCommentEntryTask: function () { return task; } };
    },
    startThread: function (runner) {
      if (options.startError) throw options.startError;
      threads.push(runner);
      return { interrupt: function () { events.push("interrupt"); } };
    },
    accountWarmupCommandBridge: { getActive: function () { return options.oldActive ? {} : null; } }
  };
  var bridge = createBridge(context);
  bridge.install();
  return { bridge: bridge, context: context, acks: acks, events: events, threads: threads,
    cleanupCount: function () { return cleanupCount; }, runCount: function () { return runCount; } };
}

test("RUN 终态只下发一次，空轮询会独立重试原始终态 ACK", function () {
  var run = runCommand("run-once", "batch-run-once");
  var h = harness({ polls: [[run], []], ackPlan: [{ success: false }, undefined] });
  h.context.uploader.pollCommands();
  h.threads[0]();
  assert.notEqual(h.bridge.getActive(), null);
  h.context.uploader.pollCommands();
  assert.equal(h.bridge.getActive(), null);
  assert.equal(h.runCount(), 1);
  assert.deepEqual(h.acks.map(function (item) { return item.id; }), ["run-once", "run-once"]);
  assert.deepEqual(h.acks[1].result, h.acks[0].result);
});

test("STOP 终态只下发一次，空轮询重试且不重复中断清理或终结 RUN", function () {
  var run = runCommand("run-stop-once", "batch-stop-once");
  var stop = command("stop-once", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: run.id, batchId: "batch-stop-once"
  });
  var h = harness({ polls: [[run], [stop], []], ackPlan: [{ success: false }, undefined, undefined] });
  h.context.uploader.pollCommands();
  h.context.uploader.pollCommands();
  h.context.uploader.pollCommands();
  assert.equal(h.events.filter(function (item) { return item === "interrupt"; }).length, 1);
  assert.equal(h.cleanupCount(), 1);
  assert.equal(h.acks.filter(function (item) { return item.id === stop.id; }).length, 2);
  assert.equal(h.acks.filter(function (item) { return item.id === run.id; }).length, 1);
});

test("错路由与忙碌拒绝只出现一次也会在空轮询重试", function () {
  var cases = [
    command("bad-once", "ACCOUNT_WARMUP_RUN", { featureKey: "isolated_unknown", batchId: "batch-bad" }),
    runCommand("busy-once", "batch-busy")
  ];
  cases.forEach(function (item, index) {
    var h = harness({ polls: [[item], []], oldActive: index === 1, ackPlan: [{ success: false }, undefined] });
    h.context.uploader.pollCommands();
    h.context.uploader.pollCommands();
    assert.deepEqual(h.acks.map(function (ack) { return ack.id; }), [item.id, item.id]);
    assert.deepEqual(h.acks[1].result, h.acks[0].result);
    assert.equal(h.threads.length, 0);
  });
});

test("已有 CAPTURED 终态待回执时 STOP 返回一致的 ALREADY_COMPLETED", function () {
  var run = runCommand("run-terminal-race", "batch-terminal-race");
  var stop = command("stop-terminal-race", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: run.id, batchId: "batch-terminal-race"
  });
  var h = harness({ polls: [[run], [stop], []],
    ackPlan: [{ success: false }, { success: false }, undefined, undefined] });
  h.context.uploader.pollCommands();
  h.threads[0]();
  h.context.uploader.pollCommands();
  var stopAck = h.acks.find(function (item) { return item.id === stop.id; });
  assert.equal(stopAck.result.status, "ALREADY_COMPLETED");
  assert.equal(stopAck.result.targetStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.equal(h.cleanupCount(), 0);
  assert.equal(h.events.indexOf("interrupt"), -1);
  h.context.uploader.pollCommands();
  assert.equal(h.bridge.getActive(), null);
  h.acks.filter(function (item) { return item.id === run.id; }).forEach(function (item) {
    assert.equal(item.result.status, "LIVE_COMMENT_ENTRY_CAPTURED");
  });
});

test("线程启动器抛错会先 cleanup，并由空轮询可靠重试 FAILED 终态", function () {
  var run = runCommand("run-thread-throw", "batch-thread-throw");
  var h = harness({ polls: [[run], []], startError: new Error("threads.start failed"),
    ackPlan: [{ success: false }, undefined] });
  assert.doesNotThrow(function () { h.context.uploader.pollCommands(); });
  assert.deepEqual(h.events.slice(-2), ["cleanup", "ack:run-thread-throw:FAILED"]);
  assert.notEqual(h.bridge.getActive(), null);
  h.context.uploader.pollCommands();
  assert.equal(h.bridge.getActive(), null);
  assert.equal(h.cleanupCount(), 1);
  assert.equal(h.acks[1].result.status, "FAILED");
  assert.deepEqual(h.acks[1].result, h.acks[0].result);
});

test("拒绝回执积压时为 STOP 与原 RUN 终态保留容量且恢复后不丢终态", function () {
  var run = runCommand("run-capacity", "batch-capacity");
  var polls = [[run]];
  for (var index = 0; index < 20; index += 1) {
    polls.push([command("legacy-busy-" + index, "ACCOUNT_WARMUP_RUN", {
      featureKey: "video_warmup", batchId: "batch-busy-" + index
    })]);
  }
  for (var empty = 0; empty < 8; empty += 1) polls.push([]);
  var transportDown = true;
  var h = harness({ polls: polls, ackResponder: function () {
    return transportDown ? { success: false } : undefined;
  } });
  h.context.uploader.pollCommands();
  for (var poll = 0; poll < 20; poll += 1) h.context.uploader.pollCommands();
  h.threads[0]();
  assert.notEqual(h.bridge.getActive(), null);
  transportDown = false;
  for (var retry = 0; retry < 8; retry += 1) h.context.uploader.pollCommands();
  assert.equal(h.bridge.getActive(), null);
  var terminal = h.acks.filter(function (item) { return item.id === run.id; });
  assert(terminal.length >= 2);
  terminal.forEach(function (item) { assert.equal(item.result.status, "LIVE_COMMENT_ENTRY_CAPTURED"); });
});

test("outbox 内存上限、单轮重试数和原始结果快照均固定", function () {
  var sent = [];
  var transportDown = true;
  var outbox = createOutbox({ limit: 3, flushLimit: 2, send: function (id, status, result) {
    sent.push({ id: id, status: status, result: result });
    return transportDown ? { success: false } : undefined;
  } });
  var original = { status: "ORIGINAL", comments: [{ commentText: "原始" }] };
  outbox.submit({ key: "a", commandId: "a", status: "FAILED", result: original });
  outbox.submit({ key: "b", commandId: "b", status: "FAILED", result: { status: "B" } });
  outbox.submit({ key: "c", commandId: "c", status: "FAILED", result: { status: "C" } });
  original.status = "MUTATED";
  original.comments[0].commentText = "被修改";
  assert.equal(outbox.size(), 3);
  sent.length = 0;
  outbox.flush();
  assert.equal(sent.length, 2);
  transportDown = false;
  outbox.flush();
  outbox.flush();
  assert.equal(outbox.size(), 0);
  var originalRetry = sent.find(function (item) { return item.id === "a"; });
  assert.equal(originalRetry.result.status, "ORIGINAL");
  assert.equal(originalRetry.result.comments[0].commentText, "原始");
});
