var assert = require("assert");
var createRemoteWakeCoordinator = require("../app/remote-wake-coordinator.js").createRemoteWakeCoordinator;
var createRemoteWakeReporter = require("../app/remote-wake-reporter.js").createRemoteWakeReporter;
var createRemoteWakeCommandBridge = require("../app/remote-wake-command-bridge.js").createRemoteWakeCommandBridge;

function createCommand(id) {
  return {
    commandType: "OPEN_AGENT_APP",
    commandId: id || "00000000-0000-4000-8000-000000000037",
    deviceId: "mi8-a",
    targetPackage: "com.agri.video.collector",
    expiresAt: "2026-08-11T10:01:00.000Z",
    ackToken: "ack-token"
  };
}

function createStore() {
  var values = {};
  return {
    get: function (key) { return values[key] || null; },
    put: function (key, value) { values[key] = value; }
  };
}

function successfulActions(calls) {
  return {
    screen: {
      wake: function () { calls.push("wake"); return { success: true }; },
      dismissKeyguard: function () { calls.push("unlock"); return { success: true }; }
    },
    recents: {
      clearExistingTask: function () { throw new Error("OPEN_AGENT_APP must never clear recent tasks"); }
    },
    launcher: {
      launch: function () { calls.push("launch"); return { success: true }; },
      waitForUiReady: function () { calls.push("ui"); return { success: true }; }
    }
  };
}

function testCoordinatorReportsEverySuccessfulStage() {
  var calls = [];
  var stages = [];
  var acknowledgements = [];
  var actions = successfulActions(calls);
  var coordinator = createRemoteWakeCoordinator({
    screen: actions.screen,
    recents: actions.recents,
    launcher: actions.launcher,
    reporter: {
      reportStage: function (_command, stage) { stages.push(stage); return { success: true }; },
      acknowledge: function (_command, result) { acknowledgements.push(result); return { success: true }; }
    },
    store: createStore(),
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  var result = coordinator.execute(createCommand());
  assert.strictEqual(result.status, "SUCCEEDED");
  assert.deepStrictEqual(calls, ["wake", "unlock", "launch", "ui"]);
  assert.deepStrictEqual(stages, [
    "DEVICE_RECEIVED",
    "SCREEN_ON",
    "KEYGUARD_DISMISSED",
    "APP_LAUNCHED",
    "UI_READY"
  ]);
  assert.deepStrictEqual(acknowledgements, [{ status: "SUCCEEDED" }]);
}

function testCoordinatorMapsFailureAndDoesNotContinue() {
  var calls = [];
  var acknowledgements = [];
  var actions = successfulActions(calls);
  actions.launcher.launch = function () { calls.push("launch"); return { success: false }; };
  var coordinator = createRemoteWakeCoordinator({
    screen: actions.screen,
    recents: actions.recents,
    launcher: actions.launcher,
    reporter: {
      reportStage: function () { return { success: true }; },
      acknowledge: function (_command, result) { acknowledgements.push(result); return { success: true }; }
    },
    store: createStore(),
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  var result = coordinator.execute(createCommand("00000000-0000-4000-8000-000000000040"));
  assert.strictEqual(result.status, "FAILED");
  assert.strictEqual(result.errorCode, "APP_LAUNCH_FAILED");
  assert.deepStrictEqual(calls, ["wake", "unlock", "launch"]);
  assert.strictEqual(acknowledgements[0].errorCode, "APP_LAUNCH_FAILED");
}

function testDuplicateCommandReplaysAckWithoutActions() {
  var calls = [];
  var acknowledgements = [];
  var actions = successfulActions(calls);
  var coordinator = createRemoteWakeCoordinator({
    screen: actions.screen,
    recents: actions.recents,
    launcher: actions.launcher,
    reporter: {
      reportStage: function () { return { success: true }; },
      acknowledge: function (_command, result) { acknowledgements.push(result); return { success: true }; }
    },
    store: createStore(),
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });
  var command = createCommand("00000000-0000-4000-8000-000000000068");

  coordinator.execute(command);
  coordinator.execute(command);
  assert.deepStrictEqual(calls, ["wake", "unlock", "launch", "ui"]);
  assert.strictEqual(acknowledgements.length, 2);
  assert.strictEqual(acknowledgements[1].status, "SUCCEEDED");
}

function testCoordinatorStopsAtOverallTimeout() {
  var currentTime = new Date("2026-08-11T10:00:00.000Z");
  var acknowledgements = [];
  var coordinator = createRemoteWakeCoordinator({
    screen: {
      wake: function () {
        currentTime = new Date("2026-08-11T10:00:31.000Z");
        return { success: true };
      },
      dismissKeyguard: function () { throw new Error("must not unlock after timeout"); }
    },
    recents: { clearExistingTask: function () { throw new Error("must not clear after timeout"); } },
    launcher: {
      launch: function () { throw new Error("must not launch after timeout"); },
      waitForUiReady: function () { throw new Error("must not inspect UI after timeout"); }
    },
    reporter: {
      reportStage: function () { return { success: true }; },
      acknowledge: function (_command, result) { acknowledgements.push(result); return { success: true }; }
    },
    store: createStore(),
    totalTimeoutMs: 30000,
    now: function () { return currentTime; }
  });

  var result = coordinator.execute(createCommand("00000000-0000-4000-8000-000000000067"));
  assert.strictEqual(result.status, "TIMED_OUT");
  assert.strictEqual(result.errorCode, "COMMAND_TIMED_OUT");
  assert.strictEqual(acknowledgements[0].status, "TIMED_OUT");
}

function testCoordinatorDoesNotTouchRecents() {
  var actions = successfulActions([]);
  actions.recents.clearExistingTask = function () { throw new Error("recents crashed"); };
  var coordinator = createRemoteWakeCoordinator({
    screen: actions.screen,
    recents: actions.recents,
    launcher: actions.launcher,
    reporter: {
      reportStage: function () { return { success: true }; },
      acknowledge: function () { return { success: true }; }
    },
    store: createStore(),
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  var result = coordinator.execute(createCommand("00000000-0000-4000-8000-000000000069"));
  assert.strictEqual(result.status, "SUCCEEDED");
}

function testReporterUsesAckTokenEndpoints() {
  var requests = [];
  var reporter = createRemoteWakeReporter({
    baseUrl: "https://example.test/api/v1",
    postJson: function (url, body, headers) {
      requests.push({ url: url, body: body, headers: headers });
      return { statusCode: 200 };
    }
  });
  var command = createCommand("00000000-0000-4000-8000-000000000039");

  reporter.reportStage(command, "SCREEN_ON");
  reporter.acknowledge(command, { status: "SUCCEEDED" });
  assert.strictEqual(requests[0].url, "https://example.test/api/v1/mobile/remote-wake/commands/00000000-0000-4000-8000-000000000039/stages");
  assert.deepStrictEqual(requests[0].body, { stage: "SCREEN_ON" });
  assert.strictEqual(requests[0].headers.Authorization, "Bearer ack-token");
  assert.strictEqual(requests[1].url.endsWith("/ack"), true);
}

function testBridgeLeavesNativeOwnedRemoteWakeCommandOutOfTheInnerAgent() {
  var executed = [];
  var uploader = {
    pollCommands: function () {
      var commands = [
        { id: "regular", commandType: "STATUS" },
        {
          id: "00000000-0000-4000-8000-000000000038",
          commandType: "OPEN_AGENT_APP",
          payload: {
            deviceId: "mi8-a",
            expiresAt: "2026-08-11T10:01:00.000Z",
            ackToken: "ack-token"
          }
        }
      ];
      commands.deviceRecoveryRequestSucceeded = true;
      return commands;
    }
  };
  var bridge = createRemoteWakeCommandBridge({
    config: { device: { deviceId: "mi8-a" }, upload: {} },
    uploader: uploader,
    logger: { info: function () {}, warn: function () {}, error: function () {} }
  }, {
    coordinator: { execute: function (command) { executed.push(command.commandId); } },
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  bridge.install();
  var passthrough = uploader.pollCommands();
  assert.deepStrictEqual(Array.prototype.slice.call(passthrough), [{ id: "regular", commandType: "STATUS" }]);
  assert.deepStrictEqual(executed, []);
  assert.strictEqual(passthrough.deviceRecoveryRequestSucceeded, true);
}

function testBridgeDoesNotCreateInnerRecoverySideEffectsForNativeCommands() {
  var started = [];
  var recorded = [];
  var uploader = {
    pollCommands: function () {
      return [{
        id: "00000000-0000-4000-8000-000000000071",
        commandType: "OPEN_AGENT_APP",
        payload: {
          deviceId: "mi8-a",
          expiresAt: "2026-08-11T10:01:00.000Z",
          ackToken: "ack-token"
        }
      }];
    }
  };
  var bridge = createRemoteWakeCommandBridge({
    config: { device: { deviceId: "mi8-a" }, upload: {} },
    uploader: uploader,
    deviceRecoveryJournal: {
      startManualWake: function (command) { started.push(command.commandId); }
    },
    deviceRecoverySync: {
      recordStage: function (stage) { recorded.push(stage); }
    },
    logger: { info: function () {}, warn: function () {}, error: function () {} }
  }, {
    coordinator: { execute: function () { return { status: "SUCCEEDED" }; } },
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  bridge.install();
  uploader.pollCommands();
  assert.deepStrictEqual(started, []);
  assert.deepStrictEqual(recorded, []);
}

testCoordinatorReportsEverySuccessfulStage();
testCoordinatorMapsFailureAndDoesNotContinue();
testDuplicateCommandReplaysAckWithoutActions();
testCoordinatorStopsAtOverallTimeout();
testCoordinatorDoesNotTouchRecents();
testReporterUsesAckTokenEndpoints();
testBridgeLeavesNativeOwnedRemoteWakeCommandOutOfTheInnerAgent();
testBridgeDoesNotCreateInnerRecoverySideEffectsForNativeCommands();
console.log("remote wake coordinator tests passed");
