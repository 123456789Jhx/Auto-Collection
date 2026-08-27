"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var createBridge = require("../features/new-comment/command-bridge.js").createNewCommentCommandBridge;

var FEATURE_KEY = "isolated_live_comment_entry";

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {}, requestTime: "2026-08-27T10:00:00.000Z" };
}

function isolatedRun(id, batchId, config) {
  return command(id, "ACCOUNT_WARMUP_RUN", {
    featureKey: FEATURE_KEY,
    batchId: batchId,
    config: config || { targetKeyword: "药材种植", minViewerCount: 300 }
  });
}

function createHarness(options) {
  options = options || {};
  var acknowledgements = [];
  var events = [];
  var logs = [];
  var threads = [];
  var taskRuns = [];
  var taskCreates = [];
  var cleanupCalls = [];
  var pollSets = options.pollSets || [[]];
  var pollIndex = 0;
  var ackResults = (options.ackResults || []).slice();
  var task = {
    cleanup: {
      run: function (payload) {
        cleanupCalls.push(payload);
        events.push("cleanup");
        return options.cleanupResult || { completed: true };
      }
    },
    run: function (payload, control) {
      taskRuns.push({ payload: payload, control: control });
      if (options.onRun) return options.onRun(payload, control, taskCreates[taskCreates.length - 1].options);
      return options.workerResult || { status: "LIVE_COMMENT_ENTRY_CAPTURED" };
    }
  };
  var featureModule = {
    createIsolatedLiveCommentEntryTask: function (context, taskOptions) {
      taskCreates.push({ context: context, options: taskOptions });
      return task;
    }
  };
  var polled = function () {
    return pollSets[Math.min(pollIndex++, pollSets.length - 1)] || [];
  };
  var context = {
    config: { device: { deviceId: "device-41cc82eb" } },
    uploader: {
      pollCommands: polled,
      ackCommand: function (id, status, result) {
        acknowledgements.push({ id: id, status: status, result: result });
        events.push("ack:" + id + ":" + status);
        var next = ackResults.length ? ackResults.shift() : undefined;
        if (next instanceof Error) throw next;
        return next;
      }
    },
    logger: {
      info: function (message, detail) { logs.push({ level: "info", message: message, detail: detail }); },
      warn: function (message, detail) { logs.push({ level: "warn", message: message, detail: detail }); },
      error: function (message, detail) { logs.push({ level: "error", message: message, detail: detail }); }
    },
    loadBizScript: function (path) {
      events.push("load-biz:" + path);
      if (options.bizLoadError) throw options.bizLoadError;
      return featureModule;
    },
    loadBaselineScript: function (path) {
      events.push("load-baseline:" + path);
      return featureModule;
    },
    startThread: function (runner) {
      threads.push(runner);
      return { interrupt: function () { events.push("interrupt"); } };
    },
    accountWarmupCommandBridge: {
      getActive: function () { return options.oldActive ? { commandId: "old-run" } : null; }
    }
  };
  return {
    context: context,
    acknowledgements: acknowledgements,
    cleanupCalls: cleanupCalls,
    events: events,
    logs: logs,
    taskCreates: taskCreates,
    taskRuns: taskRuns,
    threads: threads
  };
}

test("精确隔离 RUN 预加载新入口并透传配置、批次和停止控制", function () {
  var harness = createHarness({
    onRun: function (_payload, _control, options) {
      for (var index = 1; index <= 21; index += 1) {
        options.reportStage(index === 2 ? {
          stage: "STAGE_2", comments: [{ commentId: "c1" }], commentCount: 1, commentSourceCount: 3
        } : { stage: "STAGE_" + index });
      }
      return { status: "LIVE_COMMENT_ENTRY_CAPTURED", captureCompleted: true };
    },
    ackResults: [{ success: false }]
  });
  var bridge = createBridge(harness.context);
  assert.equal(bridge.install(), true);
  assert.equal(bridge.install(), false);
  var run = isolatedRun("run-exact", "batch-exact", { targetKeyword: "药材种植", minViewerCount: 0 });
  assert.deepEqual(bridge.intercept([run]), []);
  harness.threads[0]();

  assert.deepEqual(harness.events.slice(0, 1), ["load-biz:features/new-comment/index.js"]);
  assert.equal(harness.taskCreates.length, 1);
  assert.deepEqual(harness.taskRuns[0].payload, {
    targetKeyword: "药材种植", minViewerCount: 0, batchId: "batch-exact"
  });
  assert.equal(harness.taskRuns[0].control.shouldStop(), false);
  var terminal = harness.acknowledgements[harness.acknowledgements.length - 1];
  assert.equal(terminal.status, "DONE");
  assert.equal(terminal.result.featureKey, FEATURE_KEY);
  assert.equal(terminal.result.batchId, "batch-exact");
  assert.equal(terminal.result.stage, "STAGE_21");
  assert.equal(terminal.result.stageHistory.length, 20);
  assert.equal(terminal.result.stageHistory[0], "STAGE_2");
  assert.deepEqual(terminal.result.comments, [{ commentId: "c1" }]);
  assert.equal(terminal.result.commentSourceCount, 3);
  var stageLog = harness.logs.find(function (item) { return item.message.indexOf("阶段进度回执失败") >= 0; });
  assert.equal(stageLog.detail.batchId, "batch-exact");
});

test("畸形隔离路由终态拒绝，legacy 命令及数组属性原样透传", function () {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  var malformed = command("bad-isolated", "ACCOUNT_WARMUP_RUN", {
    featureKey: "isolated_unknown", batchId: "batch-bad", config: {}
  });
  var missing = command("missing-batch", "ACCOUNT_WARMUP_RUN", { featureKey: FEATURE_KEY, config: {} });
  var padded = command("padded-isolated", "ACCOUNT_WARMUP_RUN", {
    featureKey: " isolated_live_comment_entry ", batchId: "batch-padded",
    config: { targetKeyword: "药材种植" }
  });
  var legacyEmpty = command("legacy-empty", "ACCOUNT_WARMUP_RUN", {});
  var legacyOther = command("legacy-other", "ACCOUNT_WARMUP_RUN", { featureKey: "video_warmup" });
  var input = [malformed, missing, padded, legacyEmpty, legacyOther];
  input.deviceRecoveryRequestSucceeded = true;
  var output = bridge.intercept(input);

  assert.deepEqual(output.slice(), [legacyEmpty, legacyOther]);
  assert.equal(output.deviceRecoveryRequestSucceeded, true);
  assert.equal(harness.acknowledgements.length, 3);
  harness.acknowledgements.forEach(function (ack) {
    assert.equal(ack.status, "FAILED");
    assert.equal(ack.result.status, "ROUTE_MISMATCH");
    assert.equal(ack.result.reasonCode, "ROUTE_MISMATCH");
    assert.equal(typeof ack.result.featureKey, "string");
    assert.equal(typeof ack.result.batchId, "string");
  });
  var mismatchLog = harness.logs.find(function (item) { return item.message.indexOf("错路由") >= 0; });
  assert.deepEqual(Object.keys(mismatchLog.detail).sort(), [
    "batchId", "commandId", "commandType", "deviceId", "featureKey", "requestTime"
  ]);
  assert.equal(harness.threads.length, 0);
});

test("新旧任务双向互斥且空闲时旧 RUN 继续透传", function () {
  var blockedNew = createHarness({ oldActive: true });
  var blockedBridge = createBridge(blockedNew.context);
  assert.deepEqual(blockedBridge.intercept([isolatedRun("new-busy", "batch-new-busy")]), []);
  assert.equal(blockedNew.acknowledgements[0].status, "FAILED");
  assert.equal(blockedNew.acknowledgements[0].result.status, "ACCOUNT_WARMUP_BUSY");
  assert.equal(blockedNew.threads.length, 0);

  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.intercept([isolatedRun("new-active", "batch-active")]);
  var oldRun = command("old-while-new", "ACCOUNT_WARMUP_RUN", {
    featureKey: "video_warmup", batchId: "batch-legacy"
  });
  assert.deepEqual(bridge.intercept([oldRun]), []);
  assert.equal(harness.acknowledgements[0].result.status, "ACCOUNT_WARMUP_BUSY");
  assert.equal(harness.acknowledgements[0].result.featureKey, "video_warmup");
  assert.equal(harness.acknowledgements[0].result.batchId, "batch-legacy");
  var busyLog = harness.logs.find(function (item) { return item.message.indexOf("互斥拦截") >= 0; });
  assert.equal(busyLog.detail.featureKey, "video_warmup");
  assert.equal(busyLog.detail.batchId, "batch-legacy");
  var duplicate = isolatedRun("new-active", "batch-active");
  bridge.intercept([duplicate]);
  assert.equal(harness.threads.length, 1);

  var idle = createHarness();
  var idleOld = command("old-idle", "ACCOUNT_WARMUP_RUN", { featureKey: "target_live_interaction" });
  assert.deepEqual(createBridge(idle.context).intercept([idleOld]), [idleOld]);
});

test("STOP 必须同时匹配任务号和批次号，否则完整透传旧桥", function () {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.intercept([isolatedRun("run-stop-match", "batch-stop-match")]);
  var wrongId = command("stop-wrong-id", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: "other", batchId: "batch-stop-match"
  });
  var wrongBatch = command("stop-wrong-batch", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: "run-stop-match", batchId: "other"
  });
  assert.deepEqual(bridge.intercept([wrongId, wrongBatch]), [wrongId, wrongBatch]);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(createBridge(createHarness().context).intercept([wrongId]), [wrongId]);
});

test("匹配 STOP 先中断和清理，再回执 STOP 并终结 RUN，且保留部分结果", function () {
  var bridge;
  var stop;
  var harness = createHarness({
    onRun: function (_payload, control, options) {
      options.reportStage({
        stage: "COMMENT_PAGE_CAPTURED", comments: [{ commentId: "c1", commentText: "已抓取" }],
        commentCount: 1, commentSourceCount: 4
      });
      options.reportStage({ stage: "SWIPING_COMMENTS" });
      bridge.intercept([stop]);
      assert.equal(control.shouldStop(), true);
      return { status: "STOPPED" };
    }
  });
  bridge = createBridge(harness.context);
  var run = isolatedRun("run-stop", "batch-stop");
  stop = command("stop-exact", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: "run-stop", batchId: "batch-stop"
  });
  bridge.intercept([run]);
  harness.threads[0]();

  assert.deepEqual(harness.events.filter(function (event) {
    return event === "interrupt" || event === "cleanup" || event.indexOf("ack:") === 0;
  }).slice(-4), ["interrupt", "cleanup", "ack:stop-exact:DONE", "ack:run-stop:DONE"]);
  assert.equal(harness.cleanupCalls.length, 1);
  assert.equal(harness.cleanupCalls[0].taskId, "run-stop");
  assert.equal(harness.cleanupCalls[0].batchId, "batch-stop");
  assert.equal(harness.cleanupCalls[0].control.shouldStop(), true);
  var stopAck = harness.acknowledgements.find(function (item) { return item.id === "stop-exact"; });
  assert.equal(stopAck.result.status, "LIVE_COMMENT_ENTRY_STOPPED");
  assert.equal(stopAck.result.stage, "STOPPED");
  assert.equal(stopAck.result.featureKey, FEATURE_KEY);
  assert.equal(stopAck.result.captureStatus, "LIVE_COMMENT_ENTRY_PARTIAL");
  assert.equal(stopAck.result.captureCompleted, false);
  assert.equal(stopAck.result.commentCount, 1);
  assert.equal(stopAck.result.commentSourceCount, 4);
  bridge.intercept([stop]);
  assert.equal(harness.cleanupCalls.length, 1);
  assert.equal(harness.acknowledgements[harness.acknowledgements.length - 1].result.status,
    "ALREADY_STOPPED");
});

test("验证或 cleanupRequired 只调用新任务 cleanup 一次并按结果决定终态", function () {
  var harness = createHarness({
    workerResult: {
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION", reasonCode: "PLATFORM_VERIFICATION",
      cleanupRequired: true
    }
  });
  var bridge = createBridge(harness.context);
  bridge.intercept([isolatedRun("run-risk", "batch-risk")]);
  harness.threads[0]();
  assert.equal(harness.cleanupCalls.length, 1);
  assert.equal(harness.acknowledgements[0].status, "FAILED");
  assert.deepEqual(harness.acknowledgements[0].result.cleanup, { completed: true });

  var stopped = createHarness({ workerResult: { status: "STOPPED" } });
  var stoppedBridge = createBridge(stopped.context);
  stoppedBridge.intercept([isolatedRun("run-worker-stop", "batch-worker-stop")]);
  stopped.threads[0]();
  assert.equal(stopped.acknowledgements[0].status, "DONE");
  assert.equal(stopped.acknowledgements[0].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
});

test("STOP 回执抛错仍终结原 RUN，重复 STOP 可稳定重试", function () {
  var harness = createHarness({ ackResults: [new Error("stop ack offline"), undefined, undefined] });
  var bridge = createBridge(harness.context);
  var run = isolatedRun("run-stop-ack-error", "batch-stop-ack-error");
  var stop = command("stop-ack-error", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: run.id, batchId: "batch-stop-ack-error"
  });
  bridge.intercept([run]);
  assert.doesNotThrow(function () { bridge.intercept([stop]); });
  assert.equal(bridge.getActive(), null);
  assert.equal(harness.cleanupCalls.length, 1);
  assert.equal(harness.acknowledgements[0].result.captureStatus, "LIVE_COMMENT_ENTRY_PARTIAL");
  assert.equal(harness.acknowledgements[0].result.captureCompleted, false);
  var stopLog = harness.logs.find(function (item) { return item.message.indexOf("停止回执失败") >= 0; });
  assert.equal(stopLog.detail.batchId, "batch-stop-ack-error");
  bridge.intercept([stop]);
  assert.equal(harness.cleanupCalls.length, 1);
  assert.equal(harness.acknowledgements[harness.acknowledgements.length - 1].result.status,
    "LIVE_COMMENT_ENTRY_STOPPED");
});

test("终态 ACK 失败只重试回执，成功终态缓存有界且任务不重跑", function () {
  var harness = createHarness({ ackResults: [{ success: false }, undefined] });
  var bridge = createBridge(harness.context);
  var run = isolatedRun("run-retry", "batch-retry");
  bridge.intercept([run]);
  harness.threads[0]();
  bridge.intercept([run]);
  assert.equal(harness.threads.length, 1);
  assert.equal(harness.taskRuns.length, 1);
  assert.equal(harness.acknowledgements.length, 2);
  assert.equal(bridge.getActive(), null);
  bridge.intercept([run]);
  assert.equal(harness.taskRuns.length, 1);
  assert.equal(harness.acknowledgements.length, 3);

  var cachedRuns = [];
  for (var index = 0; index < 21; index += 1) {
    var next = isolatedRun("cached-" + index, "batch-" + index);
    cachedRuns.push(next);
    bridge.intercept([next]);
    harness.threads[harness.threads.length - 1]();
  }
  var runCount = harness.taskRuns.length;
  bridge.intercept([cachedRuns[20]]);
  assert.equal(harness.taskRuns.length, runCount);
  bridge.intercept([cachedRuns[0]]);
  harness.threads[harness.threads.length - 1]();
  assert.equal(harness.taskRuns.length, runCount + 1);
});

test("终态 ACK 抛错保留终态，重复 RUN 只重试回执", function () {
  var harness = createHarness({ ackResults: [new Error("terminal ack offline"), undefined] });
  var bridge = createBridge(harness.context);
  var run = isolatedRun("run-terminal-throw", "batch-terminal-throw");
  bridge.intercept([run]);
  harness.threads[0]();
  assert.notEqual(bridge.getActive(), null);
  bridge.intercept([run]);
  assert.equal(bridge.getActive(), null);
  assert.equal(harness.taskRuns.length, 1);
  assert.equal(harness.acknowledgements.length, 2);
  var terminalLog = harness.logs.find(function (item) { return item.message.indexOf("终态回执失败") >= 0; });
  assert.equal(terminalLog.detail.batchId, "batch-terminal-throw");
});

test("普通 FAILED 与 worker 异常都先执行新任务 cleanup 再回执失败", function () {
  var failed = createHarness({ workerResult: { status: "LIVE_COMMENT_ENTRY_FAILED", reasonCode: "NO_RESULT" } });
  var failedBridge = createBridge(failed.context);
  failedBridge.intercept([isolatedRun("run-failed", "batch-failed")]);
  failed.threads[0]();
  assert.deepEqual(failed.events.slice(-2), ["cleanup", "ack:run-failed:FAILED"]);
  assert.equal(failed.cleanupCalls.length, 1);

  var thrown = createHarness({ onRun: function () { throw new Error("worker exploded"); } });
  var thrownBridge = createBridge(thrown.context);
  thrownBridge.intercept([isolatedRun("run-thrown", "batch-thrown")]);
  thrown.threads[0]();
  assert.deepEqual(thrown.events.slice(-2), ["cleanup", "ack:run-thrown:FAILED"]);
  assert.equal(thrown.cleanupCalls.length, 1);
  assert.equal(thrown.acknowledgements[0].result.cleanup.completed, true);
  var workerLog = thrown.logs.find(function (item) { return item.message.indexOf("任务失败") >= 0; });
  assert.equal(workerLog.detail.batchId, "batch-thrown");
});

test("入口热更新层失败时回落 APK 基础层", function () {
  var harness = createHarness({ bizLoadError: new Error("overlay broken") });
  var bridge = createBridge(harness.context);
  bridge.install();
  assert.deepEqual(harness.events.slice(0, 2), [
    "load-biz:features/new-comment/index.js",
    "load-baseline:features/new-comment/index.js"
  ]);
});
