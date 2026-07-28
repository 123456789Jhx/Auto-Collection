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

testDaemonKeepsReportingWhileMainTaskIsBusy();
testDaemonStatusSnapshotUsesPausedAndStoppedStates();

console.log("agent-heartbeat-daemon tests passed");
