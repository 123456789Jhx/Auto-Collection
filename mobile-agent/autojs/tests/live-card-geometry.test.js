const assert = require("assert");
const geometry = require("../platforms/live-card-geometry.js");

function rect(left, top, right, bottom) {
  return {
    left: left,
    top: top,
    right: right,
    bottom: bottom
  };
}

function assertPointInside(point, bounds) {
  assert(point.x >= bounds.left, "x should be inside left edge");
  assert(point.x <= bounds.right, "x should be inside right edge");
  assert(point.y >= bounds.top, "y should be inside top edge");
  assert(point.y <= bounds.bottom, "y should be inside bottom edge");
}

const screen = { width: 450, height: 900 };

{
  const candidate = geometry.buildLiveCardCandidateFromBadge(
    screen,
    rect(142, 236, 188, 268),
    { targetBounds: null }
  );

  assert.strictEqual(candidate.type, "grid_live_card");
  assert(candidate.bounds.left < 40, "left grid card should start near screen left");
  assert(candidate.bounds.right < screen.width * 0.55, "left grid card should stay in left column");
  assert(candidate.clickPoints.length >= 2, "candidate should expose stable click points");
  assertPointInside(candidate.clickPoints[0], candidate.bounds);
}

{
  const candidate = geometry.buildLiveCardCandidateFromBadge(
    screen,
    rect(248, 302, 294, 334),
    { targetBounds: rect(22, 170, 424, 286) }
  );

  assert.strictEqual(candidate.type, "user_large_live_card");
  assert(candidate.bounds.left <= 35, "large user card should align with content left edge");
  assert(candidate.bounds.right >= 290, "large user card should include badge on the right");
  assert(candidate.bounds.top > 285, "large user card should start below the user row");
  assertPointInside(candidate.clickPoints[0], candidate.bounds);
}

{
  assert.strictEqual(
    geometry.isSearchLiveBadgeText("直播中", rect(300, 300, 350, 330), screen),
    true
  );
  assert.strictEqual(
    geometry.isSearchLiveBadgeText("直播", rect(214, 92, 260, 124), screen),
    false
  );
}

{
  assert.strictEqual(
    geometry.matchesTargetKeywords("爱番茄的蛋正在直播\n粉丝: 8", ["爱番茄的蛋"]),
    true
  );
  assert.strictEqual(
    geometry.matchesTargetKeywords("古堡探秘\n直播中", ["爱番茄的蛋"]),
    false
  );
}

console.log("live-card-geometry tests passed");
