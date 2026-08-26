var assert = require("assert");
var createControlLoop = require("../app/control-loop.js").createControlLoop;

function createFixture(options) {
  options = options || {};
  var heartbeats = [];
  var state = Object.assign({
    running: false,
    paused: false,
    stopRequested: false,
    manualOverride: false,
    exitRequested: false
  }, options.state || {});
  var config = {
    upload: { enabled: true, failureLogIntervalMs: 60000 },
    device: { deviceId: "test-device" },
    task: { taskId: "task-1", keywords: [], liveComment: {} },
    schedule: { autoStart: options.autoStart === true },
    runtime: { heartbeatMinutes: 1, idleHeartbeatSeconds: 60 },
    match: { agricultureKeywords: [] }
  };
  var logs = [];
  var context = {
    config: config,
    logger: {
      info: function () {},
      warn: function () {},
      error: function () {}
    },
    uploader: {
      registerDeviceToken: function () {
        return options.registered === false
          ? { success: false, statusCode: 503, message: "temporary failure" }
          : { success: true, statusCode: 200 };
      },
      fetchCurrentTask: function () {
        return options.configAvailable === false ? null : {
          taskId: "task-1",
          autoStart: options.autoStart === true,
          heartbeatMinutes: 1,
          collectComments: true,
          commentLimit: 10
        };
      },
      retryCached: function () {},
      uploadRuntimeLog: function (level, message, payload) {
        logs.push({ level: level, message: message, payload: payload });
      },
      isRegistered: function () { return true; },
      pollCommands: function () { return []; },
      ackCommand: function () {}
    },
    floatyControl: {
      state: state,
      update: function (patch) {
        Object.keys(patch).forEach(function (key) {
          state[key] = patch[key];
        });
      }
    },
    counters: { currentPhase: "" },
    commandControl: { lastPollAt: 0, polling: false },
    heartbeatService: {
      reportImmediateHeartbeat: function (phase, status, message) {
        heartbeats.push({ phase: phase, status: status, message: message });
      },
      reportAgentHeartbeat: function (status, message) {
        heartbeats.push({ status: status, message: message });
      }
    },
    taskScheduler: { getActiveTaskType: function () { return ""; } },
    logs: logs
  };
  return {
    context: context,
    state: state,
    heartbeats: heartbeats,
    controlLoop: createControlLoop(context)
  };
}

function testRegistrationFailureEntersSafeRecoveryPause() {
  var fixture = createFixture({ registered: false, autoStart: true });
  var result = fixture.controlLoop.syncBackendOnce("test");
  assert.strictEqual(result.success, false);
  assert.strictEqual(fixture.state.paused, true);
  assert.strictEqual(fixture.state.running, false);
  assert.strictEqual(fixture.state.stopRequested, false);
  assert.strictEqual(fixture.state.manualOverride, false);
  assert.strictEqual(fixture.state.backendRecoveryPending, true);
}

function testSuccessfulAutoStartClearsRecoveryAndRuns() {
  var fixture = createFixture({ registered: false, autoStart: true });
  fixture.controlLoop.syncBackendOnce("failed");
  fixture.context.uploader.registerDeviceToken = function () { return { success: true, statusCode: 200 }; };
  var result = fixture.controlLoop.syncBackendOnce("recovery");
  assert.strictEqual(result.success, true);
  assert.strictEqual(fixture.state.running, true);
  assert.strictEqual(fixture.state.paused, false);
  assert.strictEqual(fixture.state.stopRequested, false);
  assert.strictEqual(fixture.state.backendRecoveryPending, false);
  assert.strictEqual(fixture.heartbeats[fixture.heartbeats.length - 1].status, "running");
}

function testSuccessfulNoAutoStartLeavesIdle() {
  var fixture = createFixture({ registered: false, autoStart: false });
  fixture.controlLoop.syncBackendOnce("failed");
  fixture.context.uploader.registerDeviceToken = function () { return { success: true, statusCode: 200 }; };
  fixture.controlLoop.syncBackendOnce("recovery");
  assert.strictEqual(fixture.state.running, false);
  assert.strictEqual(fixture.state.paused, false);
  assert.strictEqual(fixture.state.stopRequested, false);
  assert.strictEqual(fixture.state.backendRecoveryPending, false);
  assert.strictEqual(fixture.heartbeats[fixture.heartbeats.length - 1].status, "idle");
}

function testManualPauseAndStopArePreserved() {
  [
    { paused: true, manualOverride: true, stopRequested: false },
    { paused: true, manualOverride: true, stopRequested: true }
  ].forEach(function (state) {
    var fixture = createFixture({ registered: false, autoStart: true, state: state });
    fixture.controlLoop.syncBackendOnce("failed");
    fixture.context.uploader.registerDeviceToken = function () { return { success: true, statusCode: 200 }; };
    fixture.controlLoop.syncBackendOnce("recovery");
    assert.strictEqual(fixture.state.manualOverride, true);
    assert.strictEqual(fixture.state.paused, true);
    assert.strictEqual(fixture.state.stopRequested, state.stopRequested);
    assert.strictEqual(fixture.state.running, false);
  });
}

testRegistrationFailureEntersSafeRecoveryPause();
testSuccessfulAutoStartClearsRecoveryAndRuns();
testSuccessfulNoAutoStartLeavesIdle();
testManualPauseAndStopArePreserved();
console.log("agent registration recovery tests passed");
