var assert = require("assert");
var createLikeTiming = require("../features/account-warmup/like-timing.js").createLikeTiming;

function testUsesStandardBoundsWithoutSubSecondIntervals() {
  var minimum = createLikeTiming({ random: function () { return 0; } }).nextDelay(1);
  var maximum = createLikeTiming({ random: function () { return 0.999999; } }).nextDelay(2);
  assert.deepStrictEqual(minimum, { kind: "standard", delayMs: 1200 });
  assert.deepStrictEqual(maximum, { kind: "standard", delayMs: 5400 });
  assert(minimum.delayMs >= 1000);
}

function testUsesExtendedPauseAfterEveryThreeCompletedDoubleTaps() {
  var minimum = createLikeTiming({ random: function () { return 0; } }).nextDelay(3);
  var maximum = createLikeTiming({ random: function () { return 0.999999; } }).nextDelay(6);
  assert.deepStrictEqual(minimum, { kind: "extended_pause", delayMs: 5255 });
  assert.deepStrictEqual(maximum, { kind: "extended_pause", delayMs: 7565 });
  assert.strictEqual(createLikeTiming({ random: function () { return 0; } }).nextDelay(0).kind, "standard");
}

testUsesStandardBoundsWithoutSubSecondIntervals();
testUsesExtendedPauseAfterEveryThreeCompletedDoubleTaps();
console.log("account warmup like timing tests passed");
