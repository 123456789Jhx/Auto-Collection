var assert = require("assert");
var createFastTargetSearch = require("../features/account-warmup/fast-target-search.js").createFastTargetSearch;

function createHarness(overrides) {
  var now = 0;
  var events = [];
  var logs = [];
  var deps = {
    now: function () { return now; },
    sleep: function (ms) { events.push("sleep:" + ms); now += ms; },
    screenSize: function () { return { width: 1080, height: 2248 }; },
    findSearchEntry: function () { return { id: "entry" }; },
    findInput: function () { return { id: "input" }; },
    findSubmit: function () { return { id: "submit" }; },
    clickNode: function (node) { events.push("click:" + node.id); return true; },
    clickPoint: function (x, y) { events.push("point:" + x + ":" + y); return true; },
    setInput: function (node, keyword) { events.push("input:" + node.id + ":" + keyword); return true; },
    pressEnter: function () { events.push("enter"); return true; },
    isResultFor: function (keyword) { events.push("result:" + keyword); return true; }
  };
  Object.keys(overrides || {}).forEach(function (key) { deps[key] = overrides[key]; });
  return {
    events: events,
    logs: logs,
    search: createFastTargetSearch({
      dependencies: deps,
      logger: { info: function (message, payload) { logs.push({ message: message, payload: payload }); } }
    })
  };
}

function testUsesBoundedNodePathAndReportsFourStages() {
  var harness = createHarness();
  var result = harness.search.openSearch("药材种植", { shouldStop: function () { return false; } });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.stage, "result_confirmed");
  assert(result.elapsedMs <= 9000);
  assert.deepStrictEqual(harness.events, [
    "click:entry",
    "sleep:3000",
    "input:input:药材种植",
    "sleep:3000",
    "click:submit",
    "sleep:300",
    "result:药材种植"
  ]);
  assert.deepStrictEqual(harness.logs.map(function (item) { return item.payload.stage; }), [
    "entry_opened",
    "keyword_entered",
    "search_submitted",
    "result_confirmed"
  ]);
}

function testUsesCoordinateAndEnterFallbacks() {
  var harness = createHarness({
    findSearchEntry: function () { return null; },
    findSubmit: function () { return null; }
  });
  var result = harness.search.openSearch("药材种植", { shouldStop: function () { return false; } });

  assert.strictEqual(result.success, true);
  assert(harness.events.some(function (item) { return item.indexOf("point:") === 0; }));
  assert(harness.events.indexOf("enter") >= 0);
}

function testStopsDuringBoundedWait() {
  var checks = 0;
  var harness = createHarness({ findInput: function () { return null; } });
  var result = harness.search.openSearch("药材种植", {
    shouldStop: function () { checks += 1; return checks >= 4; }
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.stopped, true);
  assert.strictEqual(result.stage, "input_wait");
}

testUsesBoundedNodePathAndReportsFourStages();
testUsesCoordinateAndEnterFallbacks();
testStopsDuringBoundedWait();
console.log("account warmup fast target search tests passed");
