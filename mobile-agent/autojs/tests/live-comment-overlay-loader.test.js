var assert = require("assert");
var entryModule = require("../features/account-warmup/live-comment-entry.js");
var runtimeModule = require("../features/account-warmup/live-comment-entry-runtime.js");
var runnerModule = require("../features/account-warmup/live-comment-entry-comment-runner.js");

function testEntryLoadsOverlayDependenciesThroughContext() {
  var loaded = [];
  var runtime = {
    openDouyin: function () { return true; },
    openSearch: function () { return true; },
    openLiveTab: function () { return true; },
    openFirstLive: function () { return true; },
    isLiveRoom: function () { return true; },
    readViewerCount: function () { return { count: 10 }; },
    waitRandom: function () {},
    readComments: function () { return { text: "甲：测试评论" }; },
    swipeComments: function () { return true; }
  };
  var context = {
    loadBizScript: function (path) {
      loaded.push(path);
      if (path === "features/account-warmup/live-comment-entry-runtime.js") {
        return { createDefaultRuntime: function () { return runtime; } };
      }
      if (path === "features/account-warmup/live-comment-entry-comment-runner.js") {
        return { createCommentCaptureRunner: function () {
          return { capture: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } };
        } };
      }
      if (path === "domain/live-comment-capture.js") return {
        buildCandidates: function () { return []; },
        flattenPages: function () { return []; }
      };
      throw new Error("unexpected module: " + path);
    }
  };

  entryModule.createLiveCommentEntryTask({ context: context, runtime: runtime });
  assert.deepStrictEqual(loaded, [
    "features/account-warmup/live-comment-entry-runtime.js",
    "features/account-warmup/live-comment-entry-comment-runner.js"
  ]);
}

function testRuntimeLoadsBaselineDependenciesThroughContext() {
  var loaded = [];
  var context = {
    loadBizScript: function (path) {
      loaded.push(path);
      if (path === "domain/live-comment-capture.js") return {
        commentOcrRegions: function () { return {}; },
        commentSwipeCoordinates: function () { return {
          startX: 1, startY: 2, endX: 1, endY: 1, durationMs: 1
        }; }
      };
      if (path === "core/accessibility.js") return {
        createGestureDriver: function () { return {}; }
      };
      if (path === "features/account-warmup/fast-target-search.js") return {
        createFastTargetSearch: function () { return {}; }
      };
      throw new Error("unexpected module: " + path);
    }
  };

  runtimeModule.createDefaultRuntime(context);
  assert.deepStrictEqual(loaded, [
    "domain/live-comment-capture.js",
    "core/accessibility.js",
    "features/account-warmup/fast-target-search.js"
  ]);
}

function testRunnerLoadsCaptureDomainThroughContext() {
  var loaded = [];
  var context = {
    loadBizScript: function (path) {
      loaded.push(path);
      if (path === "domain/live-comment-capture.js") return {
        COMMENT_SWIPE_COUNT: 0,
        buildCandidates: function () { return []; },
        flattenPages: function () { return []; },
        parseCommentLines: function () { return []; }
      };
      throw new Error("unexpected module: " + path);
    }
  };
  runnerModule.createCommentCaptureRunner({ context: context });
  assert.deepStrictEqual(loaded, ["domain/live-comment-capture.js"]);
}

function testBaselineLoaderWinsForLiveCommentOverlayFallback() {
  var loaded = [];
  var context = {
    forceBaselineLiveCommentEntry: true,
    loadBizScript: function () {
      throw new Error("overlay loader must not be used for the live comment entry fallback");
    },
    loadBaselineScript: function (path) {
      loaded.push(path);
      if (path.indexOf("live-comment-entry-runtime.js") >= 0) {
        return { createDefaultRuntime: function () { return {}; } };
      }
      if (path.indexOf("live-comment-entry-comment-runner.js") >= 0) {
        return { createCommentCaptureRunner: function () { return { capture: function () { return {}; } }; } };
      }
      if (path === "domain/live-comment-capture.js") return {};
      throw new Error("unexpected baseline module: " + path);
    }
  };
  entryModule.createLiveCommentEntryTask({ context: context });
  assert.deepStrictEqual(loaded, [
    "features/account-warmup/live-comment-entry-runtime.js",
    "features/account-warmup/live-comment-entry-comment-runner.js"
  ]);
}

function testEntryUsesPreloadedModulesWithoutLoadingInsideWorker() {
  var runtime = {};
  var task = entryModule.createLiveCommentEntryTask({
    context: {
      loadBizScript: function () { throw new Error("worker must use preloaded modules"); }
    },
    runtime: runtime,
    runtimeAdapter: { createDefaultRuntime: function () { return runtime; } },
    captureRunnerModule: {
      createCommentCaptureRunner: function () {
        return { capture: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } };
      }
    }
  });
  assert.strictEqual(typeof task.run, "function");
}

testEntryLoadsOverlayDependenciesThroughContext();
testRuntimeLoadsBaselineDependenciesThroughContext();
testRunnerLoadsCaptureDomainThroughContext();
testBaselineLoaderWinsForLiveCommentOverlayFallback();
testEntryUsesPreloadedModulesWithoutLoadingInsideWorker();
console.log("live-comment-overlay-loader tests passed");
