var assert = require("assert");
var createLikePlan = require("../features/account-warmup/like-plan.js").createLikePlan;

function randomSequence(first) {
  var firstPending = true;
  var state = 17;
  return function () {
    if (firstPending) { firstPending = false; return first; }
    state = (state * 37 + 11) % 997;
    return state / 997;
  };
}

function timingStub() {
  return {
    nextDelay: function (completed) {
      return completed > 0 && completed % 3 === 0
        ? { kind: "extended_pause", delayMs: 5255 }
        : { kind: "standard", delayMs: 1200 };
    }
  };
}

function build(firstRandom) {
  return createLikePlan({
    random: randomSequence(firstRandom),
    screenSize: function () { return { width: 1080, height: 2248 }; },
    timing: timingStub(),
    logger: { info: function () {} }
  });
}

function testGeneratesSevenToFourteenDoubleTapActions() {
  assert.strictEqual(build(0).actions.length, 7);
  assert.strictEqual(build(0.999999).actions.length, 14);
  build(0.5).actions.forEach(function (action) {
    assert.strictEqual(action.type, "double_tap");
    assert(!Object.prototype.hasOwnProperty.call(action, "swipe"));
  });
}

function testKeepsCoordinatesUniqueAndInsideTheRedFrame() {
  var plan = build(0.999999);
  var points = {};
  plan.actions.forEach(function (action) {
    assert(action.x >= 97 && action.x <= 1036);
    assert(action.y >= 472 && action.y <= 1503);
    points[action.x + ":" + action.y] = true;
  });
  assert.strictEqual(Object.keys(points).length, plan.actions.length);
}

function testAttachesTheExistingTimingRuleToEachAction() {
  var plan = build(0);
  assert.deepStrictEqual(plan.actions.slice(0, 4).map(function (action) {
    return [action.delayKind, action.delayAfterMs];
  }), [
    ["standard", 1200],
    ["standard", 1200],
    ["extended_pause", 5255],
    ["standard", 1200]
  ]);
}

testGeneratesSevenToFourteenDoubleTapActions();
testKeepsCoordinatesUniqueAndInsideTheRedFrame();
testAttachesTheExistingTimingRuleToEachAction();
console.log("account warmup like plan tests passed");
