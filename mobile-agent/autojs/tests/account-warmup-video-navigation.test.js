var assert = require("assert");
var test = require("node:test");
var videoUi = require("../features/account-warmup/video-warmup-ui.js");
var createDefaultUi = videoUi.createDefaultUi;

test("video navigation query timeout keeps the startup upper bound below 14 seconds", function () {
  assert.strictEqual(videoUi.NODE_QUERY_TIMEOUT_MS, 1500);
});

function createNode(bounds) {
  return {
    bounds: function () { return bounds; },
    clickable: function () { return true; },
    click: function () { return true; }
  };
}

function withGlobals(setup, callback) {
  var previous = {
    desc: global.desc,
    descContains: global.descContains,
    text: global.text,
    click: global.click
  };
  try {
    setup();
    callback();
  } finally {
    Object.keys(previous).forEach(function (key) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    });
  }
}

test("search entry discovery uses non-blocking findOnce", function () {
  var findOnceCalls = 0;
  var findOneCalls = 0;
  var node = createNode({ centerX: function () { return 1080; }, centerY: function () { return 120; } });
  var selector = {
    findOnce: function () { findOnceCalls += 1; return node; },
    findOne: function () { findOneCalls += 1; throw new Error("blocking findOne must not be used"); }
  };

  withGlobals(function () {
    global.desc = function () { return selector; };
    global.descContains = function () { return selector; };
    global.text = function () { return selector; };
    global.click = function () { return true; };
  }, function () {
    var ui = createDefaultUi({
      screenSize: function () { return { width: 1200, height: 2670 }; },
      wait: function () {}
    });
    assert.strictEqual(ui.openSearchEntry(), true);
  });

  assert(findOnceCalls > 0);
  assert.strictEqual(findOneCalls, 0);
});

test("video tab discovery enumerates nodes without unbounded find", function () {
  var first = createNode({ centerX: function () { return 200; }, centerY: function () { return 180; } });
  var second = createNode({ centerX: function () { return 700; }, centerY: function () { return 510; } });
  var clicked = 0;
  second.click = function () { clicked += 1; return true; };
  var selector = {
    findOnce: function (index) { return index === 0 ? first : index === 1 ? second : null; },
    find: function () { throw new Error("unbounded find must not be used"); }
  };

  withGlobals(function () {
    global.text = function () { return selector; };
    global.desc = function () { return selector; };
  }, function () {
    var ui = createDefaultUi({
      screenSize: function () { return { width: 1200, height: 2670 }; },
      wait: function () {}
    });
    assert.strictEqual(ui.openLowerVideoTab(), true);
  });

  assert.strictEqual(clicked, 1);
});
