function numberValue(value, fallback) {
  var result = Number(value);
  return isFinite(result) ? result : fallback;
}

function normalizeRect(bounds) {
  if (!bounds) {
    return null;
  }
  var left = typeof bounds.left === "function" ? bounds.left() : bounds.left;
  var top = typeof bounds.top === "function" ? bounds.top() : bounds.top;
  var right = typeof bounds.right === "function" ? bounds.right() : bounds.right;
  var bottom = typeof bounds.bottom === "function" ? bounds.bottom() : bounds.bottom;
  left = numberValue(left, 0);
  top = numberValue(top, 0);
  right = numberValue(right, left);
  bottom = numberValue(bottom, top);
  return {
    left: left,
    top: top,
    right: right,
    bottom: bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    centerX: Math.floor((left + right) / 2),
    centerY: Math.floor((top + bottom) / 2)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectFromValues(left, top, right, bottom, screen) {
  return normalizeRect({
    left: clamp(Math.floor(left), 0, screen.width),
    top: clamp(Math.floor(top), 0, screen.height),
    right: clamp(Math.floor(right), 0, screen.width),
    bottom: clamp(Math.floor(bottom), 0, screen.height)
  });
}

function isSearchLiveBadgeText(textValue, bounds, screen) {
  textValue = String(textValue || "").replace(/\s+/g, "");
  var rect = normalizeRect(bounds);
  if (/(\u76f4\u64ad\u4e2d|\u6b63\u5728\s*\u76f4\u64ad|\u5f00\u64ad\u4e2d|LIVE)/i.test(textValue) && rect && screen) {
    if (rect.centerY < screen.height * 0.12 || rect.centerY > screen.height * 0.82) {
      return false;
    }
    if (rect.width > screen.width * 0.42 || rect.height > screen.height * 0.12) {
      return false;
    }
    return true;
  }
  if (!rect || !screen) {
    return false;
  }
  if (!/(直播中|正在直播|正在播|开播中|LIVE)/i.test(textValue)) {
    return false;
  }
  if (rect.centerY < screen.height * 0.12 || rect.centerY > screen.height * 0.82) {
    return false;
  }
  if (rect.width > screen.width * 0.42 || rect.height > screen.height * 0.12) {
    return false;
  }
  return true;
}

function buildGridCardFromBadge(screen, badge) {
  var gap = Math.max(6, Math.floor(screen.width * 0.018));
  var contentLeft = Math.max(0, Math.floor(screen.width * 0.035));
  var contentRight = Math.min(screen.width, Math.floor(screen.width * 0.97));
  var columnWidth = Math.floor((contentRight - contentLeft - gap) / 2);
  var badgeCenterX = badge.centerX;
  var leftColumn = badgeCenterX < screen.width * 0.5;
  var left = leftColumn ? contentLeft : contentLeft + columnWidth + gap;
  var right = left + columnWidth;
  var top = Math.max(Math.floor(screen.height * 0.15), badge.top - Math.floor(screen.height * 0.06));
  var bottom = Math.min(screen.height - Math.floor(screen.height * 0.08), top + Math.floor(columnWidth * 1.42));
  return rectFromValues(left, top, right, bottom, screen);
}

function buildLargeUserCardFromBadge(screen, badge, targetBounds) {
  var contentLeft = Math.max(0, Math.floor(screen.width * 0.045));
  var contentRight = Math.min(screen.width, Math.floor(screen.width * 0.965));
  var topFloor = targetBounds ? targetBounds.bottom + Math.floor(screen.height * 0.012) : screen.height * 0.26;
  var top = Math.max(topFloor, badge.top - Math.floor(screen.height * 0.035));
  var preferredBottom = top + Math.floor(screen.height * 0.39);
  var bottom = Math.min(screen.height - Math.floor(screen.height * 0.08), preferredBottom);
  return rectFromValues(contentLeft, top, contentRight, bottom, screen);
}

function isUserLiveRowBadge(screen, badge, targetBounds) {
  if (!screen || !badge || !targetBounds) {
    return false;
  }
  var rowTop = targetBounds.top - Math.floor(screen.height * 0.08);
  var rowBottom = targetBounds.bottom + Math.floor(screen.height * 0.04);
  return (
    badge.centerX < targetBounds.left &&
    badge.centerX < screen.width * 0.30 &&
    badge.centerY >= rowTop &&
    badge.centerY <= rowBottom
  );
}

function buildUserLiveRowFromBadge(screen, badge, targetBounds) {
  var contentLeft = Math.max(0, Math.floor(screen.width * 0.045));
  var contentRight = Math.min(screen.width, Math.floor(screen.width * 0.965));
  var top = Math.min(badge.top, targetBounds.top) - Math.floor(screen.height * 0.025);
  var bottom = Math.max(badge.bottom, targetBounds.bottom) + Math.floor(screen.height * 0.035);
  return rectFromValues(contentLeft, top, contentRight, bottom, screen);
}

function buildClickPoints(bounds, badge, type, targetBounds, screen) {
  if (type === "user_live_row") {
    var rowCenterY = targetBounds ? targetBounds.centerY : bounds.centerY;
    return [
      {
        name: "avatar_live_badge",
        x: clamp(badge.centerX, bounds.left + 8, bounds.right - 8),
        y: clamp(badge.centerY, bounds.top + 8, bounds.bottom - 8)
      },
      {
        name: "avatar_center",
        x: clamp(Math.floor((screen && screen.width || bounds.right) * 0.13), bounds.left + 8, bounds.right - 8),
        y: clamp(rowCenterY, bounds.top + 8, bounds.bottom - 8)
      },
      {
        name: "user_name_row",
        x: clamp(targetBounds ? targetBounds.centerX : bounds.centerX, bounds.left + 8, bounds.right - 8),
        y: clamp(rowCenterY, bounds.top + 8, bounds.bottom - 8)
      }
    ];
  }
  var points = [
    {
      name: "card_center",
      x: bounds.centerX,
      y: Math.floor(bounds.top + bounds.height * 0.42)
    },
    {
      name: "card_upper",
      x: bounds.centerX,
      y: Math.floor(bounds.top + bounds.height * 0.28)
    }
  ];
  if (badge) {
    points.push({
      name: "badge_nearby",
      x: clamp(badge.centerX, bounds.left + 8, bounds.right - 8),
      y: clamp(badge.centerY + Math.floor(bounds.height * 0.08), bounds.top + 8, bounds.bottom - 8)
    });
  }
  return points;
}

function buildSearchResultLiveFallbackClickPoints(screen) {
  screen = screen || {};
  var width = numberValue(screen.width, 0);
  var height = numberValue(screen.height, 0);
  var minY = Math.floor(height * 0.16);
  var maxY = height - Math.floor(height * 0.08);

  function point(name, xRatio, yRatio) {
    return {
      name: name,
      x: clamp(Math.floor(width * xRatio), 8, Math.max(8, width - 8)),
      y: clamp(Math.floor(height * yRatio), minY, Math.max(minY, maxY))
    };
  }

  return [
    point("visible_user_avatar_live_badge", 0.13, 0.26),
    point("visible_user_name_row", 0.36, 0.25),
    point("visible_live_card_badge", 0.60, 0.36),
    point("visible_live_card_center", 0.36, 0.50),
    point("visible_live_card_upper", 0.36, 0.42),
    point("visible_lower_right_live_badge", 0.88, 0.86),
    point("visible_lower_right_card_center", 0.73, 0.82),
    point("visible_lower_right_card_upper", 0.73, 0.76),
    point("visible_lower_left_live_badge", 0.42, 0.86),
    point("visible_lower_left_card_center", 0.28, 0.82)
  ];
}

function buildSearchResultLiveOcrRegions(screen) {
  screen = screen || {};
  var width = numberValue(screen.width, 0);
  var height = numberValue(screen.height, 0);

  function region(xRatio, yRatio, wRatio, hRatio) {
    var x = clamp(Math.floor(width * xRatio), 0, Math.max(0, width - 1));
    var y = clamp(Math.floor(height * yRatio), 0, Math.max(0, height - 1));
    var right = clamp(Math.floor(width * (xRatio + wRatio)), x + 1, width);
    var bottom = clamp(Math.floor(height * (yRatio + hRatio)), y + 1, height);
    return {
      x: x,
      y: y,
      w: Math.max(1, right - x),
      h: Math.max(1, bottom - y)
    };
  }

  return {
    upperLiveCard: region(0.02, 0.30, 0.96, 0.28),
    lowerLeftLiveBadge: region(0.20, 0.74, 0.30, 0.18),
    lowerLeftLiveCard: region(0.02, 0.68, 0.46, 0.26),
    lowerRightLiveBadge: region(0.68, 0.74, 0.30, 0.18),
    lowerRightLiveCard: region(0.52, 0.68, 0.46, 0.26)
  };
}

function buildLiveCardCandidateFromBadge(screen, badgeBounds, options) {
  options = options || {};
  var badge = normalizeRect(badgeBounds);
  var targetBounds = normalizeRect(options.targetBounds);
  if (!screen || !badge) {
    return null;
  }
  var type = isUserLiveRowBadge(screen, badge, targetBounds) ? "user_live_row" :
    (targetBounds && badge.centerY > targetBounds.bottom ? "user_large_live_card" : "grid_live_card");
  var bounds = type === "user_live_row" ?
    buildUserLiveRowFromBadge(screen, badge, targetBounds) :
    (type === "user_large_live_card" ?
      buildLargeUserCardFromBadge(screen, badge, targetBounds) :
      buildGridCardFromBadge(screen, badge));
  return {
    type: type,
    badgeBounds: badge,
    targetBounds: targetBounds,
    bounds: bounds,
    clickPoints: buildClickPoints(bounds, badge, type, targetBounds, screen)
  };
}

function matchesTargetKeywords(textValue, targetKeywords) {
  textValue = String(textValue || "");
  if (!targetKeywords || !targetKeywords.length) {
    return false;
  }
  for (var i = 0; i < targetKeywords.length; i++) {
    var keyword = String(targetKeywords[i] || "").replace(/\s+/g, " ").trim();
    if (keyword && textValue.indexOf(keyword) >= 0) {
      return true;
    }
  }
  return false;
}

module.exports = {
  normalizeRect: normalizeRect,
  isSearchLiveBadgeText: isSearchLiveBadgeText,
  buildLiveCardCandidateFromBadge: buildLiveCardCandidateFromBadge,
  buildSearchResultLiveFallbackClickPoints: buildSearchResultLiveFallbackClickPoints,
  buildSearchResultLiveOcrRegions: buildSearchResultLiveOcrRegions,
  matchesTargetKeywords: matchesTargetKeywords
};
