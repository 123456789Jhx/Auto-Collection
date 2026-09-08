var assert = require("assert");
var createAgentHeartbeatDaemon = require("../app/agent-heartbeat-daemon.js").createAgentHeartbeatDaemon;

function createLogger() {
  return {
    info: function () {},
    warn: function () {},
    error: function () {}
  };
}

function testDaemonKeepsReportingWhileMainTaskIsBusy() {
  var heartbeats = [];
  var sleepCount = 0;
  var context = {
    config: {
      runtime: {
        agentHeartbeatDaemonSeconds: 1
      }
    },
    logger: createLogger(),
    floatyControl: {
      state: {
        running: true,
        paused: false,
        stopRequested: false,
        exitRequested: false,
        lastMessage: "直播评论执行中"
      }
    },
    heartbeatService: {
      reportAgentHeartbeat: function (status, message, force) {
        heartbeats.push({
          status: status,
          message: message,
          force: force
        });
      }
    }
  };
  var daemon = createAgentHeartbeatDaemon(context, {
    threadStart: function (fn) {
      fn();
      return {};
    },
    sleep: function () {
      sleepCount += 1;
      if (sleepCount >= 4) {
        context.floatyControl.state.exitRequested = true;
      }
    }
  });

  var started = daemon.start();

  assert.strictEqual(started, true);
  assert(heartbeats.length >= 4, "daemon must report heartbeats without waiting for business loops");
  assert.strictEqual(heartbeats[0].status, "running");
  assert.strictEqual(heartbeats[0].message, "直播评论执行中");
  assert.strictEqual(heartbeats[0].force, true);
}

function testDaemonStatusSnapshotUsesPausedAndStoppedStates() {
  var heartbeats = [];
  var context = {
    config: {
      runtime: {
        agentHeartbeatDaemonSeconds: 1
      }
    },
    logger: createLogger(),
    floatyControl: {
      state: {
        running: true,
        paused: true,
        stopRequested: false,
        exitRequested: false,
        lastMessage: "后台指令暂停"
      }
    },
    heartbeatService: {
      reportAgentHeartbeat: function (status, message) {
        heartbeats.push({ status: status, message: message });
      }
    }
  };
  var sleepCount = 0;
  var daemon = createAgentHeartbeatDaemon(context, {
    threadStart: function (fn) {
      fn();
      return {};
    },
    sleep: function () {
      sleepCount += 1;
      context.floatyControl.state.paused = false;
      context.floatyControl.state.stopRequested = true;
      context.floatyControl.state.lastMessage = "后台指令停止";
      if (sleepCount >= 1) {
        context.floatyControl.state.exitRequested = true;
      }
    }
  });

  daemon.start();

  assert.strictEqual(heartbeats[0].status, "paused");
  assert.strictEqual(heartbeats[0].message, "后台指令暂停");
}

function testDaemonReportsRunningWhenWarmupBridgeIsActive() {
  var heartbeats = [];
  var context = {
    config: {
      runtime: {
        agentHeartbeatDaemonSeconds: 1
      }
    },
    logger: createLogger(),
    floatyControl: {
      state: {
        running: false,
        paused: false,
        stopRequested: false,
        exitRequested: false,
        lastMessage: "等待控制循环"
      }
    },
    accountWarmupCommandBridge: {
      getActive: function () {
        return {
          commandId: "warmup-command-1",
          featureKey: "video_warmup",
          stopRequested: false
        };
      }
    },
    heartbeatService: {
      reportAgentHeartbeat: function (status, message) {
        heartbeats.push({ status: status, message: message });
      }
    }
  };
  var daemon = createAgentHeartbeatDaemon(context, {
    threadStart: function (fn) {
      fn();
      return {};
    },
    sleep: function () {
      context.floatyControl.state.exitRequested = true;
    }
  });

  daemon.start();

  assert.strictEqual(heartbeats[0].status, "running");
}

function testDaemonReportsRunningWhenIsolatedCommentBridgeIsActive() {
  var heartbeats = [];
  var context = {
    config: { runtime: { agentHeartbeatDaemonSeconds: 1 } },
    logger: createLogger(),
    floatyControl: {
      state: {
        running: false, paused: false, stopRequested: false,
        exitRequested: false, lastMessage: "等待控制循环"
      }
    },
    newCommentCommandBridge: {
      getStatusSnapshot: function () {
        return { status: "running", stopRequested: false, lastMessage: "隔离评论任务执行中" };
      }
    },
    heartbeatService: {
      reportAgentHeartbeat: function (status, message) {
        heartbeats.push({ status: status, message: message });
      }
    }
  };
  var daemon = createAgentHeartbeatDaemon(context, {
    threadStart: function (fn) { fn(); return {}; },
    sleep: function () { context.floatyControl.state.exitRequested = true; }
  });

  daemon.start();

  assert.strictEqual(heartbeats[0].status, "running");
  assert.strictEqual(heartbeats[0].message, "隔离评论任务执行中");
}

testDaemonKeepsReportingWhileMainTaskIsBusy();
testDaemonStatusSnapshotUsesPausedAndStoppedStates();
testDaemonReportsRunningWhenWarmupBridgeIsActive();
testDaemonReportsRunningWhenIsolatedCommentBridgeIsActive();

console.log("agent-heartbeat-daemon tests passed");
