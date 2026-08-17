var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createBridge = require("../app/single-interface-publish-command-bridge.js").createSingleInterfacePublishCommandBridge;

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {} };
}

function createHarness() {
  var acknowledgements = [];
  var queuedThreads = [];
  var interrupted = false;
  var handled = [];
  var commandSets = [];
  var pollIndex = 0;
  var uploader = {
    pollCommands: function () { return commandSets[pollIndex++] || []; },
    ackCommand: function (id, status, result) {
      acknowledgements.push({ id: id, status: status, result: result });
      return { success: true };
    }
  };
  return {
    context: {
      uploader: uploader,
      logger: { info: function () {}, warn: function () {}, error: function () {} },
      startThread: function (runner) {
        queuedThreads.push(runner);
        return { interrupt: function () { interrupted = true; } };
      }
    },
    dependencies: {
      execute: function (runCommand) {
        handled.push(runCommand);
        uploader.ackCommand(runCommand.id, "DONE", { status: "SUCCEEDED" });
        return { status: "SUCCEEDED" };
      }
    },
    commandSets: commandSets,
    acknowledgements: acknowledgements,
    queuedThreads: queuedThreads,
    handled: handled,
    wasInterrupted: function () { return interrupted; }
  };
}

function testPassesOrdinaryPublishAndStopThroughUnchanged() {
  var harness = createHarness();
  var ordinaryPublish = command("publish-1", "PUBLISH_VIDEO_TASK", { taskId: "task-1" });
  var ordinaryStop = command("stop-1", "STOP", {});
  harness.commandSets.push([ordinaryPublish, ordinaryStop]);
  var bridge = createBridge(harness.context, harness.dependencies);
  bridge.install();

  assert.deepStrictEqual(harness.context.uploader.pollCommands(), [ordinaryPublish, ordinaryStop]);
  assert.strictEqual(harness.queuedThreads.length, 0);
}

function testRunsOnlyDedicatedCommandOnWorkerThread() {
  var harness = createHarness();
  var run = command("interface-run-command", "SINGLE_INTERFACE_PUBLISH_TASK", {
    runId: "run-1",
    taskId: "task-1"
  });
  harness.commandSets.push([run]);
  var bridge = createBridge(harness.context, harness.dependencies);
  bridge.install();

  assert.deepStrictEqual(harness.context.uploader.pollCommands(), []);
  assert.strictEqual(harness.queuedThreads.length, 1);
  harness.queuedThreads[0]();
  assert.strictEqual(harness.handled[0].commandType, "PUBLISH_VIDEO_TASK");
  assert.deepStrictEqual(harness.acknowledgements[0], {
    id: "interface-run-command",
    status: "DONE",
    result: { status: "SUCCEEDED" }
  });
}

function testRejectsDedicatedRunWithoutExactIdentity() {
  var harness = createHarness();
  harness.commandSets.push([command("invalid-run", "SINGLE_INTERFACE_PUBLISH_TASK", { taskId: "task-1" })]);
  var bridge = createBridge(harness.context, harness.dependencies);
  bridge.install();

  assert.deepStrictEqual(harness.context.uploader.pollCommands(), []);
  assert.strictEqual(harness.queuedThreads.length, 0);
  assert.deepStrictEqual(harness.acknowledgements[0], {
    id: "invalid-run",
    status: "FAILED",
    result: { status: "INVALID_SINGLE_INTERFACE_PUBLISH_IDENTITY" }
  });
}

function testStopRequiresExactRunTaskAndTargetCommand() {
  var harness = createHarness();
  var run = command("interface-run-command", "SINGLE_INTERFACE_PUBLISH_TASK", { runId: "run-1", taskId: "task-1" });
  var wrongStop = command("wrong-stop", "SINGLE_INTERFACE_PUBLISH_STOP", {
    runId: "run-1", taskId: "other-task", targetCommandId: "interface-run-command"
  });
  harness.commandSets.push([run], [wrongStop]);
  var bridge = createBridge(harness.context, harness.dependencies);
  bridge.install();

  harness.context.uploader.pollCommands();
  harness.context.uploader.pollCommands();
  assert.strictEqual(harness.wasInterrupted(), false);
  assert.strictEqual(harness.acknowledgements[0].id, "wrong-stop");
  assert.strictEqual(harness.acknowledgements[0].status, "IGNORED");
}

function testMatchingStopInterruptsAndClosesRunAsStopped() {
  var harness = createHarness();
  var run = command("interface-run-command", "SINGLE_INTERFACE_PUBLISH_TASK", { runId: "run-1", taskId: "task-1" });
  var stop = command("interface-stop-command", "SINGLE_INTERFACE_PUBLISH_STOP", {
    runId: "run-1", taskId: "task-1", targetCommandId: "interface-run-command"
  });
  harness.commandSets.push([run], [stop]);
  var bridge = createBridge(harness.context, harness.dependencies);
  bridge.install();

  harness.context.uploader.pollCommands();
  harness.context.uploader.pollCommands();
  assert.strictEqual(harness.wasInterrupted(), true);
  assert.deepStrictEqual(harness.acknowledgements, [
    { id: "interface-stop-command", status: "DONE", result: {
      status: "STOPPED", runId: "run-1", taskId: "task-1", targetCommandId: "interface-run-command", externalMaterialReleased: false
    } }
  ]);
  assert.strictEqual(bridge.getActive(), null);
}

function testControlLoopInstallsDedicatedBridgeWithoutReplacingOrdinaryPublishBranch() {
  var source = fs.readFileSync(path.join(__dirname, "../app/control-loop.js"), "utf8");
  assert(source.indexOf("createSingleInterfacePublishCommandBridge") >= 0);
  assert(source.indexOf("singleInterfacePublishCommandBridge.install()") >= 0);
  assert(source.indexOf('if (commandType === "PUBLISH_VIDEO_TASK")') >= 0);
}

testPassesOrdinaryPublishAndStopThroughUnchanged();
testRunsOnlyDedicatedCommandOnWorkerThread();
testRejectsDedicatedRunWithoutExactIdentity();
testStopRequiresExactRunTaskAndTargetCommand();
testMatchingStopInterruptsAndClosesRunAsStopped();
testControlLoopInstallsDedicatedBridgeWithoutReplacingOrdinaryPublishBranch();
console.log("single interface publish command bridge tests passed");
