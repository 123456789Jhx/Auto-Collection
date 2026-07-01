var assert = require("assert");
var resolverModule = require("../app/run-request-resolver.js");

function createTaskScheduler(activeTaskType) {
  return {
    resolveTaskType: function (taskType, fallbackTaskType) {
      var value = String(taskType || "").trim();
      if (value === "live_comment_control" || value === "liveComment" || value === "live-comment") {
        value = "live_comment";
      }
      if (value === "video_control" || value === "video_feed") {
        value = "video";
      }
      if (value === "live_control" || value === "live_feed") {
        value = "live";
      }
      if (value === "video" || value === "live" || value === "live_comment") {
        return value;
      }
      if (activeTaskType) {
        return activeTaskType;
      }
      if (fallbackTaskType) {
        return fallbackTaskType;
      }
      return "video";
    },
    getActiveTaskType: function () {
      return activeTaskType || "";
    }
  };
}

function createContext(activeTaskType) {
  return {
    taskScheduler: createTaskScheduler(activeTaskType),
    floatyControl: {
      state: {
        liveCommentControlStatus: ""
      }
    },
    liveCommentPriorityRequested: false
  };
}

function testPendingLiveCommentBeatsStaleVideo() {
  var context = createContext("video");
  var resolver = resolverModule.createRunRequestResolver(context);

  resolver.setPendingTaskType("live_comment", "backend_start");

  assert.strictEqual(resolver.resolveRequestedTaskType(), "live_comment");
  assert.strictEqual(resolver.resolveRequestedTaskType(), "video");
}

function testPendingLiveBeatsStaleVideo() {
  var context = createContext("video");
  var resolver = resolverModule.createRunRequestResolver(context);

  resolver.setPendingTaskType("live", "backend_start");

  assert.strictEqual(resolver.resolveRequestedTaskType(), "live");
  assert.strictEqual(resolver.resolveRequestedTaskType(), "video");
}

function testLiveCommentPriorityFallbackBeatsStaleVideo() {
  var context = createContext("video");
  context.liveCommentPriorityRequested = true;
  var resolver = resolverModule.createRunRequestResolver(context);

  assert.strictEqual(resolver.resolveRequestedTaskType(), "live_comment");
}

function testNormalizeDoesNotUseStaleActiveTask() {
  var context = createContext("video");
  var resolver = resolverModule.createRunRequestResolver(context);

  assert.strictEqual(resolver.normalizeTaskType("", ""), "");
  assert.strictEqual(resolver.normalizeTaskType("unknown", ""), "");
  assert.strictEqual(resolver.normalizeTaskType("", "live"), "live");
}

function testLiveCommentControlAlias() {
  var context = createContext("video");
  var resolver = resolverModule.createRunRequestResolver(context);

  assert.strictEqual(resolver.setPendingTaskType("live_comment_control", "backend_live_comment"), "live_comment");
  assert.strictEqual(resolver.resolveRequestedTaskType(), "live_comment");
}

testPendingLiveCommentBeatsStaleVideo();
testPendingLiveBeatsStaleVideo();
testLiveCommentPriorityFallbackBeatsStaleVideo();
testNormalizeDoesNotUseStaleActiveTask();
testLiveCommentControlAlias();

console.log("run-request-resolver tests passed");
