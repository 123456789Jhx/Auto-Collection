var assert = require("assert");
var path = require("path");
var createTaskScheduler = require("../app/task-scheduler.js").createTaskScheduler;

function createLogger() {
  return {
    info: function () {},
    warn: function () {},
    error: function () {}
  };
}

function withFiles(fn) {
  var previousFiles = global.files;
  var writes = [];
  global.files = {
    join: function () {
      return path.join.apply(path, arguments);
    },
    exists: function () {
      return false;
    },
    read: function () {
      return "";
    },
    write: function (filePath, text) {
      writes.push({ filePath: filePath, text: text });
    }
  };
  try {
    fn(writes);
  } finally {
    global.files = previousFiles;
  }
}

function testCommerceCardLiveCommentIsSupportedTaskType() {
  withFiles(function () {
    var scheduler = createTaskScheduler({
      config: {
        output: {
          baseDir: "tmp"
        }
      },
      logger: createLogger()
    });

    assert.strictEqual(scheduler.resolveTaskType("commerce_card_live_comment"), "commerce_card_live_comment");
    scheduler.requestTask("commerce_card_live_comment", "START", { reason: "test" });
    assert.strictEqual(scheduler.getActiveTaskType(), "commerce_card_live_comment");
    assert.strictEqual(scheduler.getTaskState("commerce_card_live_comment").taskType, "commerce_card_live_comment");
  });
}

function createScheduler() {
  return createTaskScheduler({
    config: {
      output: {
        baseDir: "tmp"
      }
    },
    logger: createLogger()
  });
}

function workflow(assignmentId, stateVersion, lastEventSeq) {
  return {
    assignmentId: assignmentId,
    workflowVersion: 2,
    stateVersion: stateVersion,
    lastEventSeq: lastEventSeq,
    snapshotHash: "snapshot-" + assignmentId
  };
}

function testTerminalAssignmentCanRebind() {
  withFiles(function () {
    var scheduler = createScheduler();
    var first = scheduler.recordAssignmentCommand(
      "commerce_card_live_comment",
      "assignment-a",
      1,
      2,
      "command-a"
    );
    assert.strictEqual(first.accepted, true);
    scheduler.requestTask("commerce_card_live_comment", "START", {
      effectiveWorkflow: workflow("assignment-a", 3, 2),
      commandSequence: 1
    });
    scheduler.finishTask("commerce_card_live_comment", { status: "completed" });

    var rebound = scheduler.recordAssignmentCommand(
      "commerce_card_live_comment",
      "assignment-b",
      1,
      2,
      "command-b"
    );

    assert.strictEqual(rebound.accepted, true);
    assert.strictEqual(scheduler.getAssignmentContext("commerce_card_live_comment").assignmentId, "assignment-b");
    assert.strictEqual(scheduler.getAssignmentContext("commerce_card_live_comment").stateVersion, 2);
  });
}

function testDuplicateCommandReplaysAckAndStaleWorkflowDoesNotRollback() {
  withFiles(function () {
    var scheduler = createScheduler();
    scheduler.recordAssignmentCommand(
      "commerce_card_live_comment",
      "assignment-a",
      2,
      5,
      "command-a"
    );
    scheduler.requestTask("commerce_card_live_comment", "START", {
      effectiveWorkflow: workflow("assignment-a", 8, 7),
      commandSequence: 2
    });
    scheduler.rememberAssignmentCommandAck(
      "commerce_card_live_comment",
      "assignment-a",
      2,
      "command-a",
      "DONE",
      { applied: true, commandType: "START" }
    );

    var duplicate = scheduler.recordAssignmentCommand(
      "commerce_card_live_comment",
      "assignment-a",
      2,
      5,
      "command-a"
    );
    assert.strictEqual(duplicate.accepted, true);
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.ackStatus, "DONE");
    assert.deepStrictEqual(duplicate.ackResult, { applied: true, commandType: "START" });

    scheduler.requestTask("commerce_card_live_comment", "RESUME", {
      effectiveWorkflow: workflow("assignment-a", 4, 3),
      commandSequence: 1
    });
    var runtime = scheduler.getAssignmentContext("commerce_card_live_comment");
    assert.strictEqual(runtime.stateVersion, 8);
    assert.strictEqual(runtime.lastEventSeq, 7);
    assert.strictEqual(scheduler.getTaskState("commerce_card_live_comment").lastCommandSequence, 2);

    var stale = scheduler.recordAssignmentCommand(
      "commerce_card_live_comment",
      "assignment-a",
      1,
      8,
      "command-old"
    );
    assert.strictEqual(stale.accepted, false);
    assert.strictEqual(stale.reason, "assignment_command_out_of_order");
  });
}

testCommerceCardLiveCommentIsSupportedTaskType();
testTerminalAssignmentCanRebind();
testDuplicateCommandReplaysAckAndStaleWorkflowDoesNotRollback();

console.log("task-scheduler tests passed");
