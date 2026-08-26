var assert = require("assert");
var createTask = require("../features/account-warmup/live-comment-entry.js").createLiveCommentEntryTask;

var liveRoomChecks = 0;
var waits = 0;
var task = createTask({
  runtime: {
    openDouyin: function () { return true; },
    openSearch: function () { return true; },
    openLiveTab: function () { return true; },
    openFirstLive: function () { return true; },
    readViewerCount: function () { return { count: 21, source: "ocr" }; },
    isLiveRoom: function () {
      liveRoomChecks += 1;
      return liveRoomChecks >= 2;
    },
    waitRandom: function () { waits += 1; }
  },
  captureRunnerModule: {
    createCommentCaptureRunner: function () {
      return { capture: function () { return { status: "LIVE_COMMENT_ENTRY_CAPTURED" }; } };
    }
  }
});

var result = task.run({ targetKeyword: "药材种植", minViewerCount: 0 }, {
  shouldStop: function () { return false; }
});

assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_CAPTURED");
assert.strictEqual(liveRoomChecks, 2);
assert.ok(waits > 0);
console.log("live comment entry live room confirmation test passed");
