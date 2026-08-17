var assert = require("assert");
var createTask = require("../features/account-warmup/video-warmup-foundation.js").createVideoWarmupFoundationTask;

function testUsesTheTaskKeywordForTheExistingVideoFlow() {
  var opened = 0;
  var searchedKeyword = "";
  var stopped = false;
  var task = createTask({
    context: {
      douyin: {
        openApp: function () {
          opened += 1;
          return true;
        }
      }
    },
    logger: { info: function () {}, warn: function () {} },
    wait: function () {},
    ui: {
      openSearchEntry: function () { return true; },
      setSearchKeyword: function (keyword) { searchedKeyword = keyword; return true; },
      submitSearch: function () { return true; },
      openUpperVideoTab: function () { return true; },
      openLowerVideoTab: function () { return true; },
      openFirstVideo: function () { return true; },
      nextVideo: function () { stopped = true; return true; }
    }
  });

  assert.deepStrictEqual(task.run({ targetKeyword: "  人参种植  ", secondsPerVideo: 10 }, {
    shouldStop: function () { return stopped; }
  }), { status: "STOPPED", watchedVideos: 1 });
  assert.strictEqual(opened, 1);
  assert.strictEqual(searchedKeyword, "人参种植");
}

function testRejectsAnEmptyTaskKeywordBeforeOpeningDouyin() {
  var opened = 0;
  var task = createTask({
    context: { douyin: { openApp: function () { opened += 1; return true; } } },
    logger: { info: function () {}, warn: function () {} }
  });

  assert.deepStrictEqual(task.run({ targetKeyword: "   " }), {
    status: "VIDEO_WARMUP_KEYWORD_REQUIRED"
  });
  assert.strictEqual(opened, 0);
}

function testReportsWhenDouyinCannotBeOpened() {
  var task = createTask({
    context: { douyin: { openApp: function () { return false; } } },
    logger: { info: function () {}, warn: function () {} }
  });

  assert.deepStrictEqual(task.run({ targetKeyword: "药材种植" }), { status: "DOUYIN_OPEN_FAILED" });
}

testUsesTheTaskKeywordForTheExistingVideoFlow();
testRejectsAnEmptyTaskKeywordBeforeOpeningDouyin();
testReportsWhenDouyinCannotBeOpened();
console.log("account warmup video entry tests passed");
