var assert = require("assert");
var createControlLoop = require("../app/control-loop.js").createControlLoop;

function createLogger(logs) {
  return {
    info: function (message, payload) {
      logs.push({ level: "INFO", message: message, payload: payload });
    },
    warn: function (message, payload) {
      logs.push({ level: "WARN", message: message, payload: payload });
    },
    error: function (message, payload) {
      logs.push({ level: "ERROR", message: message, payload: payload });
    }
  };
}

function createContext(overrides) {
  var logs = [];
  var pollCount = 0;
  var context = {
    config: {
      upload: {
        controlEnabled: true,
        commandPollIntervalSeconds: 5
      },
      device: {
        deviceId: "test-device"
      }
    },
    logger: createLogger(logs),
    uploader: {
      isRegistered: function () {
        return true;
      },
      pollCommands: function () {
        pollCount += 1;
        return [];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function () {}
    },
    floatyControl: {
      state: {
        paused: false,
        stopRequested: false,
        running: false
      },
      update: function (patch) {
        for (var key in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) {
            this.state[key] = patch[key];
          }
        }
      }
    },
    counters: {},
    commandControl: {
      lastPollAt: 0,
      polling: false
    },
    heartbeatService: {
      reportImmediateHeartbeat: function () {},
      reportAgentHeartbeat: function () {}
    },
    taskScheduler: {
      getActiveTaskType: function () { return ""; }
    },
    logs: logs,
    getPollCount: function () {
      return pollCount;
    }
  };
  overrides = overrides || {};
  for (var key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      context[key] = overrides[key];
    }
  }
  return context;
}

function withThreads(fn) {
  var previousThreads = global.threads;
  var startCount = 0;
  global.threads = {
    start: function (runner) {
      startCount += 1;
      runner();
    }
  };
  try {
    fn(function () {
      return startCount;
    });
  } finally {
    global.threads = previousThreads;
  }
}

function testPollAsyncDoesNotStartThreadBeforeInterval() {
  withThreads(function (getStartCount) {
    var context = createContext();
    context.commandControl.lastPollAt = Date.now();
    var controlLoop = createControlLoop(context);

    controlLoop.pollControlCommandsAsync(false);

    assert.strictEqual(getStartCount(), 0, "poll async must not start a thread before command poll interval");
    assert.strictEqual(context.getPollCount(), 0, "pollCommands must not run before command poll interval");
  });
}

function testUnregisteredPollAttemptsAreThrottled() {
  withThreads(function (getStartCount) {
    var context = createContext({
      uploader: {
        isRegistered: function () {
          return false;
        },
        pollCommands: function () {
          throw new Error("pollCommands must not run when device is not registered");
        },
        uploadRuntimeLog: function () {},
        ackCommand: function () {}
      }
    });
    var controlLoop = createControlLoop(context);

    controlLoop.pollControlCommandsAsync(false);
    controlLoop.pollControlCommandsAsync(false);

    assert.strictEqual(getStartCount(), 1, "unregistered poll attempts must be throttled by command interval");
  });
}

function testLiveCommentPauseRequestsInterrupt() {
  var ack = null;
  var heartbeatMessage = "";
  var context = createContext({
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () {
        return [{
          id: "cmd-pause",
          commandType: "PAUSE",
          payload: {
            taskType: "live_comment_control"
          }
        }];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        ack = { id: id, status: status, result: result };
      }
    },
    heartbeatService: {
      reportImmediateHeartbeat: function (_phase, _status, message) {
        heartbeatMessage = message;
      },
      reportAgentHeartbeat: function () {}
    },
    taskScheduler: {
      getActiveTaskType: function () { return "live_comment"; },
      startTask: function () {},
      pauseTask: function () {},
      stopTask: function () {},
      recordCheckpoint: function () {},
      resolveTaskType: function () { return "live_comment"; }
    }
  });
  var controlLoop = createControlLoop(context);

  controlLoop.pollControlCommands();

  assert.strictEqual(context.floatyControl.state.paused, true);
  assert.strictEqual(context.floatyControl.state.stopRequested, true, "live comment pause must interrupt in-flight search");
  assert.strictEqual(context.floatyControl.state.liveCommentExecutionEnabled, false);
  assert.strictEqual(context.counters.lastStopReason, "manual_pause");
  assert.strictEqual(ack && ack.status, "DONE");
  assert.strictEqual(heartbeatMessage.indexOf("暂停") >= 0 || heartbeatMessage.indexOf("鏆傚仠") >= 0, true);
}

function testStopIsNotSupersededByLaterStartInSamePoll() {
  var acks = [];
  var context = createContext({
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () {
        return [
          {
            id: "cmd-stop",
            commandType: "STOP",
            payload: {
              taskType: "live_comment_control"
            }
          },
          {
            id: "cmd-start",
            commandType: "START",
            payload: {
              taskType: "live_comment_control"
            }
          }
        ];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        acks.push({ id: id, status: status, result: result });
      }
    },
    taskScheduler: {
      getActiveTaskType: function () { return "live_comment"; },
      requestTask: function () {},
      startTask: function () {},
      pauseTask: function () {},
      stopTask: function () {},
      recordCheckpoint: function () {},
      resolveTaskType: function () { return "live_comment"; }
    }
  });
  var controlLoop = createControlLoop(context);

  controlLoop.pollControlCommands(true);

  assert.strictEqual(context.floatyControl.state.running, false);
  assert.strictEqual(context.floatyControl.state.paused, true);
  assert.strictEqual(context.floatyControl.state.stopRequested, true);
  assert.strictEqual(context.floatyControl.state.liveCommentControlStatus, "stopped");
  var stopAck = acks.filter(function (item) { return item.id === "cmd-stop"; })[0];
  var startAck = acks.filter(function (item) { return item.id === "cmd-start"; })[0];
  assert.strictEqual(stopAck && stopAck.status, "DONE");
  assert.strictEqual(startAck && startAck.status, "IGNORED");
  assert.strictEqual(startAck && startAck.result.reason, "superseded_by_stop_command");
}

testPollAsyncDoesNotStartThreadBeforeInterval();
testUnregisteredPollAttemptsAreThrottled();
testLiveCommentPauseRequestsInterrupt();
testStopIsNotSupersededByLaterStartInSamePoll();

console.log("control-loop tests passed");
