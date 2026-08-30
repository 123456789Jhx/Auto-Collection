var assert = require("assert");
var createControlLoop = require("../app/control-loop.js").createControlLoop;

function createConfig() {
  return {
    upload: { enabled: true, controlEnabled: true, commandPollIntervalSeconds: 5 },
    device: { deviceId: "test-device" },
    task: {
      taskId: "local-task",
      platform: "douyin",
      mode: "search",
      collectComments: true,
      commentLimit: 10,
      liveComment: {}
    },
    schedule: {
      videoMinutesMin: 120,
      videoMinutesMax: 180,
      liveMinutesMin: 60,
      liveMinutesMax: 120,
      autoStart: false
    },
    runtime: { heartbeatMinutes: 1, idleHeartbeatSeconds: 60 },
    match: { agricultureKeywords: [] }
  };
}

function createRemoteConfig() {
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
    liveCommentRole: "none"
  };
}

function testBackendRecoveryPreloadsPublishHandler() {
  var logs = [];
  var loadCalls = [];
  var handled = [];
  var registrationAttempts = 0;
  var command = {
    id: "publish-after-recovery",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: { taskId: "publish-task-after-recovery" }
  };
  var context = {
    config: createConfig(),
    backendSync: { lastAt: 0, running: false, failureCount: 0, lastFailureLogAt: 0, ready: false },
    logger: {
      info: function (message, payload) { logs.push({ level: "INFO", message: message, payload: payload }); },
      warn: function (message, payload) { logs.push({ level: "WARN", message: message, payload: payload }); },
      error: function (message, payload) { logs.push({ level: "ERROR", message: message, payload: payload }); }
    },
    uploader: {
      registerDeviceToken: function () {
        registrationAttempts += 1;
        return registrationAttempts === 1 ? { success: false } : { success: true };
      },
      fetchCurrentTask: createRemoteConfig,
      retryCached: function () {},
      isRegistered: function () { return true; },
      pollCommands: function () { return [command]; },
      uploadRuntimeLog: function () {},
      ackCommand: function () {}
    },
    floatyControl: {
      state: { paused: false, stopRequested: false, exitRequested: false, running: false, manualOverride: false },
      update: function (patch) { Object.keys(patch).forEach(function (key) { this.state[key] = patch[key]; }, this); }
    },
    counters: {},
    commandControl: { lastPollAt: 0, polling: false },
    heartbeatService: { reportImmediateHeartbeat: function () {}, reportAgentHeartbeat: function () {} },
    taskScheduler: { getActiveTaskType: function () { return ""; } },
    loadBizScript: function (modulePath) {
      loadCalls.push(modulePath);
      if (modulePath === "features/publish-video/publish-video-entry.js") {
        return { createPublishVideoHandler: function () { return { handle: function (value) { handled.push(value); } }; } };
      }
      return {};
    },
    loadBaselineScript: function () { throw new Error("publish preload must not use baseline"); }
  };
  var controlLoop = createControlLoop(context);

  var startupResult = controlLoop.syncBackendOnce("startup");
  assert.strictEqual(startupResult.success, false);
  assert.strictEqual(context.backendSync.ready, false);
  assert.strictEqual(loadCalls.length, 0);

  var recoveryResult = controlLoop.syncBackendOnce("idle_loop");
  assert.strictEqual(recoveryResult.success, true);
  assert.strictEqual(context.backendSync.ready, true);
  assert.strictEqual(loadCalls.length, 0, "backend recovery must not block on publish preload");

  controlLoop.pollControlCommands(true);
  assert.deepStrictEqual(handled, [command]);
  assert(loadCalls.length > 0, "publish command must preload the publish handler on demand");
  assert(logs.some(function (entry) { return entry.message === "publish module preload ready"; }));
  assert.strictEqual(logs.some(function (entry) {
    return entry.message === "后台控制指令执行失败" && /not preloaded/.test(String(entry.payload && entry.payload.message));
  }), false);
}

testBackendRecoveryPreloadsPublishHandler();
console.log("control-loop publish preload recovery tests passed");
