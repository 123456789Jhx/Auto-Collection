var assert = require("assert");
var collectorApp = require("../app/collector-app.js");

function testFinishedTaskReturnsAgentToIdleState() {
  assert.strictEqual(typeof collectorApp.createFinishedTaskStatePatch, "function");

  var patch = collectorApp.createFinishedTaskStatePatch({
    finishReason: "live_comment_finished",
    finishStatus: "completed",
    exitRequested: false
  });

  assert.strictEqual(patch.running, false);
  assert.strictEqual(patch.paused, false);
  assert.strictEqual(patch.stopRequested, false);
  assert.strictEqual(patch.manualOverride, true);
  assert.strictEqual(patch.lastManualAction, "live_comment_finished");
  assert.strictEqual(patch.lastMessage, "任务结束，待命中");
}

function testFailedTaskReturnsAgentToIdleStateWithFailureMessage() {
  var patch = collectorApp.createFinishedTaskStatePatch({
    finishReason: "target_search_open_failed",
    finishStatus: "failed",
    exitRequested: false
  });

  assert.strictEqual(patch.running, false);
  assert.strictEqual(patch.paused, false);
  assert.strictEqual(patch.stopRequested, false);
  assert.strictEqual(patch.lastMessage, "任务失败，待命中：target_search_open_failed");
}

function testFreshAgentStartsIdleWithoutAutoStart() {
  var patch = collectorApp.createStartupIdleStatePatch({ autoStart: false, manualOverride: false });

  assert.strictEqual(patch.running, false);
  assert.strictEqual(patch.paused, false);
  assert.strictEqual(patch.stopRequested, false);
  assert.strictEqual(patch.lastMessage, "未执行任务");
}

function testStartupIdleDoesNotOverrideActiveOrManualState() {
  assert.strictEqual(collectorApp.createStartupIdleStatePatch({ autoStart: true, manualOverride: false }), null);
  assert.strictEqual(collectorApp.createStartupIdleStatePatch({ autoStart: false, manualOverride: true }), null);
}

testFinishedTaskReturnsAgentToIdleState();
testFailedTaskReturnsAgentToIdleStateWithFailureMessage();
testFreshAgentStartsIdleWithoutAutoStart();
testStartupIdleDoesNotOverrideActiveOrManualState();

console.log("collector-app finish state tests passed");
