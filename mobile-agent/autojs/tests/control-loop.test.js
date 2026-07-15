var assert = require("assert");
var fs = require("fs");
var path = require("path");
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

function testRefreshRuntimeConfigAppliesCommerceCardConfig() {
  var context = createContext({
    config: {
      upload: {
        controlEnabled: true,
        commandPollIntervalSeconds: 5
      },
      device: {
        deviceId: "test-device"
      },
      task: {
        taskId: "local-task",
        platform: "douyin",
        mode: "search",
        collectComments: true,
        commentLimit: 10,
        commerceCardLiveComment: {
          enabled: false
        },
        liveComment: {}
      },
      schedule: {
        videoMinutesMin: 120,
        videoMinutesMax: 180,
        liveMinutesMin: 60,
        liveMinutesMax: 120,
        autoStart: false
      },
      runtime: {
        heartbeatMinutes: 1,
        idleHeartbeatSeconds: 60
      },
      match: {
        agricultureKeywords: []
      }
    },
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () { return []; },
      uploadRuntimeLog: function () {},
      ackCommand: function () {},
      fetchCurrentTask: function () {
        return {
          taskId: "remote-task",
          platform: "douyin",
          mode: "search",
          videoMinutesMin: 120,
          videoMinutesMax: 180,
          liveMinutesMin: 60,
          liveMinutesMax: 120,
          heartbeatMinutes: 1,
          autoStart: false,
          collectComments: true,
          commentLimit: 10,
          liveCommentMode: "agri_chatbot",
          liveCommentRole: "none",
          commerceCardLiveComment: {
            enabled: true,
            executeEnabled: true,
            manualExecutionApproved: true,
            searchKeywords: ["夏橙"],
            matchKeywords: ["秭归", "夏橙"],
            targetRoom: {
              enabled: true,
              targetName: "鲜橙四季秭归",
              matchKeywords: ["鲜橙四季秭归"],
              similarityThreshold: 0.9
            }
          }
        };
      }
    }
  });
  var controlLoop = createControlLoop(context);

  var result = controlLoop.refreshRuntimeConfig();

  assert.strictEqual(result.applied, true);
  assert.strictEqual(context.config.task.commerceCardLiveComment.enabled, true);
  assert.deepStrictEqual(context.config.task.commerceCardLiveComment.searchKeywords, ["夏橙"]);
  assert.deepStrictEqual(context.config.task.commerceCardLiveComment.matchKeywords, ["秭归", "夏橙"]);
  assert.strictEqual(context.config.task.commerceCardLiveComment.targetRoom.enabled, true);
  assert.strictEqual(context.config.task.commerceCardLiveComment.targetRoom.targetName, "鲜橙四季秭归");
  assert.deepStrictEqual(context.config.task.commerceCardLiveComment.targetRoom.matchKeywords, ["鲜橙四季秭归"]);
  assert.strictEqual(context.config.task.commerceCardLiveComment.targetRoom.similarityThreshold, 0.9);
}

function testCommerceCardLiveStartUsesIndependentTaskType() {
  var ack = null;
  var requestedTasks = [];
  var context = createContext({
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () {
        return [{
          id: "cmd-commerce-card",
          commandType: "START",
          payload: {
            taskType: "commerce_card_live_comment"
          }
        }];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        ack = { id: id, status: status, result: result };
      }
    },
    taskScheduler: {
      getActiveTaskType: function () { return ""; },
      requestTask: function (taskType) { requestedTasks.push(taskType); },
      pauseTask: function () {},
      stopTask: function () {},
      recordCheckpoint: function () {}
    }
  });
  var controlLoop = createControlLoop(context);

  controlLoop.pollControlCommands(true);

  assert.deepStrictEqual(requestedTasks, ["commerce_card_live_comment"]);
  assert.strictEqual(ack && ack.status, "DONE");
  assert.strictEqual(ack && ack.result.taskType, "commerce_card_live_comment");
}

function testUnsupportedExplicitStartTaskDoesNotFallbackToVideo() {
  var ack = null;
  var requestedTasks = [];
  var context = createContext({
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () {
        return [{
          id: "cmd-unknown-task",
          commandType: "START",
          payload: {
            taskType: "new_task_from_backend"
          }
        }];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        ack = { id: id, status: status, result: result };
      }
    },
    taskScheduler: {
      getActiveTaskType: function () { return ""; },
      requestTask: function (taskType) { requestedTasks.push(taskType); },
      pauseTask: function () {},
      stopTask: function () {},
      recordCheckpoint: function () {}
    }
  });
  var controlLoop = createControlLoop(context);

  controlLoop.pollControlCommands(true);

  assert.deepStrictEqual(requestedTasks, []);
  assert.strictEqual(ack && ack.status, "FAILED");
  assert.strictEqual(ack && ack.result.reason, "unsupported_explicit_task_type");
  assert.strictEqual(context.floatyControl.state.running, false);
}

function createV2ControlFixture(commandType) {
  var acks = [];
  var pauseCalls = 0;
  var stopCalls = 0;
  var checkpoint = {
    checkpointVersion: 2,
    assignmentId: "assignment-v2",
    checkpointSequence: 4,
    pendingSideEffect: null
  };
  var effectiveWorkflow = {
    assignmentId: "assignment-v2",
    workflowVersion: 2,
    stateVersion: 6,
    lastEventSeq: 5,
    snapshotHash: "snapshot-v2"
  };
  var command = {
    id: "command-" + commandType.toLowerCase(),
    assignmentId: "assignment-v2",
    commandSequence: 3,
    commandType: commandType,
    payload: {
      taskType: "commerce_card_live_comment",
      workflowVersion: 2,
      assignmentId: "assignment-v2",
      commandSequence: 3,
      expectedStateVersion: 6,
      effectiveWorkflow: effectiveWorkflow
    }
  };
  var context = createContext({
    config: {
      upload: {
        controlEnabled: true,
        commandPollIntervalSeconds: 5
      },
      device: {
        deviceId: "test-device"
      },
      task: {
        effectiveWorkflow: effectiveWorkflow
      }
    },
    counters: {
      currentPhase: "commerce_card_live_comment",
      phaseEndedAt: ""
    },
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () { return [command]; },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        acks.push({ id: id, status: status, result: result });
        return { success: true, data: {} };
      }
    },
    taskScheduler: {
      getActiveTaskType: function () { return "commerce_card_live_comment"; },
      getCheckpoint: function () { return checkpoint; },
      recordAssignmentCommand: function () { return { accepted: true }; },
      rememberAssignmentCommandAck: function () { return true; },
      requestTask: function () {},
      pauseTask: function () { pauseCalls += 1; },
      stopTask: function () { stopCalls += 1; },
      updateAssignmentRuntime: function () {}
    }
  });
  return {
    context: context,
    acks: acks,
    checkpoint: checkpoint,
    getPauseCalls: function () { return pauseCalls; },
    getStopCalls: function () { return stopCalls; }
  };
}

function testV2PauseWaitsForSafeCheckpoint() {
  var fixture = createV2ControlFixture("PAUSE");
  var controlLoop = createControlLoop(fixture.context);

  controlLoop.pollControlCommands(true);

  assert.strictEqual(fixture.acks[0].status, "FETCHED");
  assert.strictEqual(fixture.acks[0].result.checkpointStable, false);
  assert.strictEqual(fixture.getPauseCalls(), 0);

  fixture.checkpoint.checkpointSequence = 5;
  fixture.checkpoint.pendingSideEffect = { actionId: "action-pending" };
  var blocked = controlLoop.completePendingAssignmentControl("PAUSE", { checkpointStable: true });
  assert.strictEqual(blocked.skipped, true);
  assert.strictEqual(fixture.acks.length, 1);

  fixture.checkpoint.pendingSideEffect = null;
  var completed = controlLoop.completePendingAssignmentControl("PAUSE", { checkpointStable: true });
  assert.strictEqual(completed.success, true);
  assert.strictEqual(fixture.acks[1].status, "DONE");
  assert.strictEqual(fixture.acks[1].result.checkpointStable, true);
  assert.strictEqual(fixture.acks[1].result.completed, true);
}

function testV2StopWaitsForSafeCheckpoint() {
  var fixture = createV2ControlFixture("STOP");
  var controlLoop = createControlLoop(fixture.context);

  controlLoop.pollControlCommands(true);

  assert.strictEqual(fixture.acks[0].status, "FETCHED");
  assert.strictEqual(fixture.getStopCalls(), 0);
  fixture.checkpoint.checkpointSequence = 5;
  var completed = controlLoop.completePendingAssignmentControl("STOP", { reason: "backend_stop" });
  assert.strictEqual(completed.success, true);
  assert.strictEqual(fixture.acks[1].status, "DONE");
  assert.strictEqual(fixture.acks[1].result.completed, true);
}

function testDuplicateV2CommandReplaysFinalAck() {
  var ack = null;
  var requestCount = 0;
  var effectiveWorkflow = {
    assignmentId: "assignment-v2",
    workflowVersion: 2,
    stateVersion: 6,
    lastEventSeq: 5,
    snapshotHash: "snapshot-v2"
  };
  var context = createContext({
    config: {
      upload: { controlEnabled: true, commandPollIntervalSeconds: 5 },
      device: { deviceId: "test-device" },
      task: { effectiveWorkflow: effectiveWorkflow }
    },
    uploader: {
      isRegistered: function () { return true; },
      pollCommands: function () {
        return [{
          id: "command-start",
          assignmentId: "assignment-v2",
          commandSequence: 1,
          commandType: "START",
          payload: {
            taskType: "commerce_card_live_comment",
            workflowVersion: 2,
            assignmentId: "assignment-v2",
            commandSequence: 1,
            expectedStateVersion: 2,
            effectiveWorkflow: effectiveWorkflow
          }
        }];
      },
      uploadRuntimeLog: function () {},
      ackCommand: function (id, status, result) {
        ack = { id: id, status: status, result: result };
        return { success: true, data: {} };
      }
    },
    taskScheduler: {
      getActiveTaskType: function () { return ""; },
      recordAssignmentCommand: function () {
        return {
          accepted: true,
          duplicate: true,
          ackStatus: "DONE",
          ackResult: { applied: true, commandType: "START", taskType: "commerce_card_live_comment" }
        };
      },
      rememberAssignmentCommandAck: function () { return true; },
      requestTask: function () { requestCount += 1; }
    }
  });
  var controlLoop = createControlLoop(context);

  controlLoop.pollControlCommands(true);

  assert.strictEqual(requestCount, 0);
  assert.strictEqual(ack.status, "DONE");
  assert.deepStrictEqual(ack.result, {
    applied: true,
    commandType: "START",
    taskType: "commerce_card_live_comment"
  });
}

function testLauncherStopsDuplicateInstancesBeforeLayout() {
  var source = fs.readFileSync(path.join(__dirname, "../launcher.js"), "utf8");
  var cleanupCall = source.indexOf("stopDuplicateLaunchers();");
  var layoutCall = source.indexOf("ui.layout(");

  assert(cleanupCall >= 0, "launcher should stop duplicate launcher engines");
  assert(layoutCall >= 0, "launcher should still render the startup UI");
  assert(cleanupCall < layoutCall, "duplicate launcher cleanup must happen before UI layout");
  assert(source.indexOf('stopEngines("launcher.js")') >= 0, "launcher cleanup should target launcher instances");
}

testPollAsyncDoesNotStartThreadBeforeInterval();
testUnregisteredPollAttemptsAreThrottled();
testLiveCommentPauseRequestsInterrupt();
testStopIsNotSupersededByLaterStartInSamePoll();
testRefreshRuntimeConfigAppliesCommerceCardConfig();
testCommerceCardLiveStartUsesIndependentTaskType();
testUnsupportedExplicitStartTaskDoesNotFallbackToVideo();
testV2PauseWaitsForSafeCheckpoint();
testV2StopWaitsForSafeCheckpoint();
testDuplicateV2CommandReplaysFinalAck();
testLauncherStopsDuplicateInstancesBeforeLayout();

console.log("control-loop tests passed");
