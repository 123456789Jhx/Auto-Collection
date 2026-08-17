var assert = require("assert");
var createBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;
var createVideoTask = require("../features/account-warmup/video-warmup-foundation.js").createVideoWarmupFoundationTask;

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {} };
}

function createHarness() {
  var acknowledgements = [];
  var events = [];
  var queuedThreads = [];
  var uploader = {
    pollCommands: function () { return []; },
    ackCommand: function (id, status, result) {
      acknowledgements.push({ id: id, status: status, result: result });
      events.push("ack:" + id + ":" + status);
      return {};
    }
  };
  var context = {
    uploader: uploader,
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function () {
      return {
        createAccountWarmupRegistry: function () {
          return {
            create: function () {
              return { run: function (payload, control) {
                return control.shouldStop() ? { status: "STOPPED" } : { status: "TARGET_LIVE_ENTERED" };
              } };
            }
          };
        }
      };
    },
    loadBaselineScript: function () {
      return {
        createDouyinPostPublishCleanup: function () {
          return { run: function () { events.push("legacy-cleanup"); return { completed: true }; } };
        }
      };
    },
    startThread: function (runner) {
      queuedThreads.push(runner);
      return { interrupt: function () { events.push("interrupt-worker"); } };
    }
  };
  return {
    context: context,
    acknowledgements: acknowledgements,
    events: events,
    queuedThreads: queuedThreads
  };
}

function start(bridge, featureKey, batchId) {
  var run = command("run-" + batchId, "ACCOUNT_WARMUP_RUN", {
    featureKey: featureKey,
    batchId: batchId,
    config: {}
  });
  bridge.intercept([run]);
  return run;
}

function videoStop(id, batchId) {
  return command(id, "VIDEO_WARMUP_STOP", {
    featureKey: "video_warmup",
    batchId: batchId,
    reason: "USER_REQUESTED"
  });
}

function findAck(harness, id) {
  return harness.acknowledgements.filter(function (item) { return item.id === id; })[0];
}

function testMatchingVideoStopInterruptsAndReturnsToAgent() {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.install();
  var run = start(bridge, "video_warmup", "batch-video-1");

  assert.deepStrictEqual(bridge.intercept([videoStop("stop-video-1", "batch-video-1")]), []);
  assert.deepStrictEqual(harness.events, [
    "interrupt-worker",
    "legacy-cleanup",
    "ack:stop-video-1:DONE",
    "ack:" + run.id + ":DONE"
  ]);
  assert.strictEqual(findAck(harness, "stop-video-1").result.status, "STOPPED");
  assert.deepStrictEqual(findAck(harness, "stop-video-1").result.cleanup, { completed: true });
  assert.strictEqual(bridge.getActive(), null);
}

function testVideoStopDoesNotAffectTargetLiveTask() {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.install();
  start(bridge, "target_live_interaction", "batch-live-1");

  bridge.intercept([videoStop("stop-live-wrongly", "batch-live-1")]);

  assert.strictEqual(harness.events.indexOf("interrupt-worker"), -1);
  assert.strictEqual(harness.events.indexOf("legacy-cleanup"), -1);
  assert.strictEqual(findAck(harness, "stop-live-wrongly").status, "IGNORED");
  assert.strictEqual(bridge.getActive().featureKey, "target_live_interaction");
}

function testStaleBatchCannotStopNewVideoTask() {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.install();
  start(bridge, "video_warmup", "batch-new");

  bridge.intercept([videoStop("stop-old", "batch-old")]);

  assert.strictEqual(harness.events.indexOf("interrupt-worker"), -1);
  assert.strictEqual(findAck(harness, "stop-old").status, "IGNORED");
  assert.strictEqual(bridge.getActive().batchId, "batch-new");
}

function testRepeatedVideoStopIsIdempotent() {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.install();
  start(bridge, "video_warmup", "batch-repeat");

  bridge.intercept([videoStop("stop-repeat-1", "batch-repeat")]);
  bridge.intercept([videoStop("stop-repeat-2", "batch-repeat")]);

  assert.strictEqual(harness.events.filter(function (event) { return event === "interrupt-worker"; }).length, 1);
  assert.strictEqual(findAck(harness, "stop-repeat-2").status, "DONE");
  assert.strictEqual(findAck(harness, "stop-repeat-2").result.status, "ALREADY_STOPPED");
}

function testVideoWaitChecksStopWithinFiveHundredMilliseconds() {
  var waits = [];
  var stopped = false;
  var task = createVideoTask({
    context: { douyin: { openApp: function () { throw new Error("must stop before opening Douyin"); } } },
    logger: { info: function () {}, warn: function () {} },
    wait: function (delayMs) { waits.push(delayMs); stopped = true; }
  });

  assert.deepStrictEqual(task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return stopped; } }), {
    status: "STOPPED",
    watchedVideos: 0
  });
  assert.deepStrictEqual(waits, [500]);
}

testMatchingVideoStopInterruptsAndReturnsToAgent();
testVideoStopDoesNotAffectTargetLiveTask();
testStaleBatchCannotStopNewVideoTask();
testRepeatedVideoStopIsIdempotent();
testVideoWaitChecksStopWithinFiveHundredMilliseconds();
console.log("account warmup video stop tests passed");
