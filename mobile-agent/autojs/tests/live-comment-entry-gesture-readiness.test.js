var assert = require("assert");
var createDefaultRuntime = require("../features/account-warmup/live-comment-entry-runtime.js").createDefaultRuntime;

var driverCreations = 0;
var taps = 0;
var context = {
  forceBaselineLiveCommentEntry: true,
  loadBaselineScript: function (path) {
    if (path === "domain/live-comment-capture.js") return {};
    if (path === "core/accessibility.js") {
      return {
        createGestureDriver: function () {
          driverCreations += 1;
          return {
            tap: function () { taps += 1; return { success: true }; },
            swipe: function () { return { success: true }; }
          };
        }
      };
    }
    if (path === "features/account-warmup/fast-target-search.js") {
      return {
        createFastTargetSearch: function (options) {
          return {
            gestureAware: true,
            openSearch: function () { return options.gestureDriver.tap({ x: 1, y: 1 }); }
          };
        }
      };
    }
    throw new Error("unexpected dependency: " + path);
  }
};

var runtime = createDefaultRuntime(context, null, { gestureMode: "accessibility" });
assert.strictEqual(driverCreations, 0);
assert.deepStrictEqual(runtime.openSearch("药材种植", {}), { success: true });
assert.strictEqual(driverCreations, 1);
assert.strictEqual(taps, 1);
console.log("live comment entry gesture readiness tests passed");
