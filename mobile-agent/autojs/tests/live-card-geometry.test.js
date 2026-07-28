const assert = require("assert");
const geometry = require("../platforms/douyin/live-card-geometry.js");

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
  assert.strictEqual(
    geometry.isSearchLiveBadgeText("\u76f4\u64ad\u4e2d", rect(300, 300, 360, 330), screen),
    true
  );
}

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
    rect(54, 218, 106, 248),
    { targetBounds: rect(132, 206, 255, 258) }
  );

  assert.strictEqual(candidate.type, "user_live_row");
  assert(candidate.bounds.top <= 206, "user live row should include the account row");
  assert(candidate.bounds.bottom >= 258, "user live row should include the account text");
  assert.strictEqual(candidate.clickPoints[0].name, "avatar_live_badge");
  assert(candidate.clickPoints[0].x < screen.width * 0.25, "first click should target the avatar/live badge");
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

{
  assert.strictEqual(typeof geometry.buildSearchResultLiveFallbackClickPoints, "function");
  const points = geometry.buildSearchResultLiveFallbackClickPoints(screen);
  const lowerRightBadge = points.find((point) => point.name === "visible_lower_right_live_badge");
  const lowerRightCard = points.find((point) => point.name === "visible_lower_right_card_center");

  assert(lowerRightBadge, "fallback should cover lower-right visible live badge");
  assert(lowerRightCard, "fallback should cover lower-right visible live card body");
  assert(lowerRightBadge.x >= screen.width * 0.78, "lower-right badge point should stay near the right column");
  assert(lowerRightBadge.y >= screen.height * 0.80, "lower-right badge point should cover lower visible cards");
  assert(lowerRightBadge.y <= screen.height * 0.92, "lower-right badge point should stay above the nav bar");
  assert(lowerRightCard.x >= screen.width * 0.62, "lower-right card point should stay in the right card");
  assert(lowerRightCard.y >= screen.height * 0.74, "lower-right card point should cover the exposed lower card");
}

{
  assert.strictEqual(typeof geometry.buildSearchResultLiveOcrRegions, "function");
  const regions = geometry.buildSearchResultLiveOcrRegions(screen);

  assert(regions.lowerRightLiveBadge, "ocr regions should include lower-right live badge");
  assert(regions.lowerRightLiveCard, "ocr regions should include lower-right live card");
  assert(regions.lowerRightLiveBadge.x >= screen.width * 0.66, "lower-right badge OCR region should scan the right column");
  assert(regions.lowerRightLiveBadge.y >= screen.height * 0.74, "lower-right badge OCR region should scan lower visible cards");
  assert(regions.lowerRightLiveBadge.w > 40, "lower-right badge OCR region should be wide enough for live text");
  assert(regions.lowerRightLiveBadge.h > 20, "lower-right badge OCR region should be tall enough for live text");
}

console.log("live-card-geometry tests passed");
