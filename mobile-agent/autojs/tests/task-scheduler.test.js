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

testCommerceCardLiveCommentIsSupportedTaskType();

console.log("task-scheduler tests passed");
