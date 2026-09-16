// Xiaomi14 uses only two gestures. Card identity and geometry must be proven before the second.
function createXiaomi14RecentsCleanup(options) {
  var logger = options.logger;
  var wait = options.wait;
  var randomInt = options.randomInt;
  var prefix = "com.miui.home:id/";

  function value(node, method) {
    return node && typeof node[method] === "function" ? String(node[method]() || "") : "";
  }
  function children(node) {
    var result = [];
    var count = node.childCount();
    if (count > 32) throw new Error("RECENTS_CHILD_LIMIT");
    for (var index = 0; index < count; index += 1) result.push(node.child(index));
    return result;
  }
  function headerTitle(wrapper) {
    var queue = children(wrapper).filter(function (node) { return value(node, "id") === prefix + "task_view_header"; });
    var titles = [];
    for (var count = 0; queue.length && count < 32; count += 1) {
      var node = queue.shift();
      if (value(node, "id") === prefix + "title") titles.push(value(node, "text"));
      queue = queue.concat(children(node));
    }
    if (queue.length || titles.length > 1) throw new Error("RECENTS_HEADER_AMBIGUOUS");
    return titles[0] || "";
  }
  function insideRecents(node) {
    for (var depth = 0; node && depth < 8; depth += 1) {
      if (value(node, "packageName") !== "com.miui.home") return false;
      if (value(node, "id") === prefix + "recents_view") return true;
      node = node.parent();
    }
    return false;
  }
  function rectangle(node, size) {
    var bounds = node.bounds();
    var rect = {};
    ["left", "top", "right", "bottom"].forEach(function (key) {
      rect[key] = Number(bounds[key]);
      if (!isFinite(rect[key])) throw new Error("RECENTS_INVALID_BOUNDS");
    });
    rect.left = Math.max(0, rect.left); rect.top = Math.max(0, rect.top);
    rect.right = Math.min(size.width, rect.right); rect.bottom = Math.min(size.height, rect.bottom);
    if (rect.right <= rect.left || rect.bottom <= rect.top) throw new Error("RECENTS_OFFSCREEN_CARD");
    return rect;
  }
  function snapshot(size) {
    var cards = [];
    try {
      if (options.getCurrentPackage() !== "com.miui.home" || typeof id !== "function") throw new Error("RECENTS_NOT_VISIBLE");
      var root = id(prefix + "recents_view").findOnce();
      if (!root || !root.visibleToUser() || !insideRecents(root)) throw new Error("RECENTS_NOT_VISIBLE");
      var nodes = id(prefix + "task_view_thumbnail").find();
      var count = typeof nodes.size === "function" ? nodes.size() : nodes.length;
      if (!isFinite(count) || count > 16) throw new Error("RECENTS_CARD_LIMIT");
      for (var index = 0; index < count; index += 1) {
        var thumbnail = typeof nodes.get === "function" ? nodes.get(index) : nodes[index];
        // Hidden target thumbnails are still tasks; never mistake an off-screen card for removal.
        if (!thumbnail.visibleToUser()) throw new Error("RECENTS_HIDDEN_TASK_UNVERIFIED");
        var wrapper = thumbnail.parent();
        var owner = wrapper && wrapper.parent();
        if (value(thumbnail, "id") !== prefix + "task_view_thumbnail" ||
          value(wrapper, "id") !== prefix + "task_view_wrapper" || !insideRecents(thumbnail)) {
          throw new Error("RECENTS_CARD_STRUCTURE_UNKNOWN");
        }
        var title = headerTitle(wrapper);
        var description = value(owner, "desc");
        var identity = /^(.+?)[,，](未加锁|已加锁)$/.exec(description);
        if (!identity || !title || title !== identity[1]) throw new Error("RECENTS_IDENTITY_UNKNOWN");
        cards.push({ name: title, locked: identity[2] === "已加锁",
          bounds: rectangle(thumbnail, size), resourceId: prefix + "task_view_thumbnail",
          match: "task_description_and_header" });
      }
      return { valid: true, cards: cards };
    } catch (error) {
      return { valid: false, cards: cards, reason: String(error.message || error) };
    }
  }
  function scale(rect, size) {
    return { left: Math.round(rect.left * size.width / 1200), right: Math.round(rect.right * size.width / 1200),
      top: Math.round(rect.top * size.height / 2670), bottom: Math.round(rect.bottom * size.height / 2670) };
  }
  function intersect(first, second) {
    var rect = { left: Math.ceil(Math.max(first.left, second.left)), top: Math.ceil(Math.max(first.top, second.top)),
      right: Math.floor(Math.min(first.right, second.right)), bottom: Math.floor(Math.min(first.bottom, second.bottom)) };
    return rect.left < rect.right && rect.top < rect.bottom ? rect : null;
  }
  function plan(state, size) {
    if (!state.valid) return { reason: state.reason };
    var targets = state.cards.filter(function (card) { return card.name === "抖音"; });
    if (targets.length !== 1) return { reason: "DOUYIN_CARD_NOT_UNIQUE" };
    var target = targets[0], bounds = target.bounds;
    if (target.locked) return { reason: "DOUYIN_CARD_LOCKED" };
    if (bounds.left < size.width * 0.55 || bounds.right - bounds.left > size.width * 0.8 ||
      bounds.bottom - bounds.top < size.height * 0.35 || bounds.bottom - bounds.top > size.height * 0.9) {
      return { reason: "DOUYIN_NOT_RIGHT_HAND_CARD" };
    }
    var margin = Math.max(4, Math.round(size.width * 24 / 1200));
    var safe = { left: bounds.left + margin, right: bounds.right - margin,
      top: bounds.top + margin, bottom: bounds.bottom - margin };
    // Business-owned geometry supersedes the old recentsExit rectangles in installed APK profiles.
    var startRect = intersect(scale({ left: 930, top: 1880, right: 1080, bottom: 2180 }, size), safe);
    var endRect = intersect(scale({ left: 930, top: 680, right: 1080, bottom: 980 }, size), safe);
    if (!startRect || !endRect) return { reason: "DOUYIN_OUTSIDE_APPROVED_RECTS" };
    var minimumHeight = Math.max(4, Math.round(size.height * 12 / 2670));
    if (startRect.bottom - startRect.top < minimumHeight || endRect.bottom - endRect.top < minimumHeight) {
      return { reason: "DOUYIN_APPROVED_RECTS_TOO_SMALL" };
    }
    var intervals = [[Math.max(startRect.left, endRect.left), Math.min(startRect.right, endRect.right)]];
    state.cards.forEach(function (card) {
      if (card === target || card.bounds.bottom < endRect.top || card.bounds.top > startRect.bottom) return;
      var next = [];
      intervals.forEach(function (interval) {
        var left = card.bounds.left - margin, right = card.bounds.right + margin;
        if (right < interval[0] || left > interval[1]) next.push(interval);
        else {
          if (left > interval[0]) next.push([interval[0], left]);
          if (right < interval[1]) next.push([right, interval[1]]);
        }
      });
      intervals = next;
    });
    intervals.sort(function (a, b) { return (b[1] - b[0]) - (a[1] - a[0]); });
    if (!intervals.length || intervals[0][1] - intervals[0][0] < Math.max(4, size.width * 12 / 1200)) {
      return { reason: "DOUYIN_PATH_OVERLAPS_OTHER_CARD" };
    }
    startRect.left = endRect.left = Math.ceil(intervals[0][0]);
    startRect.right = endRect.right = Math.floor(intervals[0][1]);
    return { target: target, startRect: startRect, endRect: endRect };
  }
  function fingerprint(state) {
    return JSON.stringify(state.cards.slice().sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : a.bounds.left - b.bounds.left;
    }));
  }
  function point(rect) { return { x: randomInt(rect.left, rect.right), y: randomInt(rect.top, rect.bottom) }; }
  function controls(start, end, rect) {
    var dx = end.x - start.x, dy = end.y - start.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = Math.max(12, Math.round(length * 0.06)), sign = randomInt(0, 1) ? -1 : 1;
    var middleX = (start.x + end.x) / 2;
    if (sign > 0 && rect.right - middleX < bow * 0.2) sign = -1;
    else if (sign < 0 && middleX - rect.left < bow * 0.2) sign = 1;
    function control(at, offset) {
      return { x: Math.max(rect.left, Math.min(rect.right, Math.round(start.x + dx * at - dy / length * offset))),
        y: Math.round(start.y + dy * at + dx / length * offset) };
    }
    return [control(randomInt(26, 40) / 100, randomInt(Math.round(bow * 0.6), bow) * sign),
      control(randomInt(60, 76) / 100, randomInt(Math.round(bow * 0.2), Math.round(bow * 0.7)) * sign)];
  }
  function failed(reason, details) {
    logger.warn("小米14停止清理未完成，停止后续手势", { reason: reason, details: details || null });
    return { completed: false, reason: reason };
  }
  function run(payload) {
    var size = { width: Number(typeof device !== "undefined" && device.width || 0),
      height: Number(typeof device !== "undefined" && device.height || 0) };
    if (size.width <= 0 || size.height <= 0) return failed("RECENTS_SCREEN_UNKNOWN");
    try {
      var driver = options.accessibility && options.accessibility.createGestureDriver();
      if (!driver || typeof driver.swipe !== "function" || typeof driver.swipeAccelerated !== "function") {
        return failed("RECENTS_DRIVER_UNAVAILABLE");
      }
      var entered = driver.swipe({ points: [{ x: Math.floor(size.width / 2), y: size.height - 2 },
        { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }], durationMs: 700 });
      if (!entered || entered.success !== true) return failed("RECENTS_GESTURE_FAILED");
      logger.info("小米14停止流程从屏幕底部中央上滑进入最近任务", { taskId: payload && payload.taskId });
      wait(1200);
      var before = snapshot(size);
      var selected = plan(before, size);
      if (selected.reason) return failed(selected.reason, before);
      wait(180);
      var fresh = snapshot(size);
      if (!fresh.valid || fingerprint(before) !== fingerprint(fresh)) return failed("RECENTS_LAYOUT_UNSTABLE", fresh);
      var start = point(selected.startRect), end = point(selected.endRect);
      var input = { points: [start, end], controlPoints: controls(start, end, selected.startRect),
        durationMs: randomInt(480, 600), timingProfile: "accelerate_ease_in" };
      logger.info("小米14已核验右侧抖音卡片及退出范围", { taskId: payload && payload.taskId,
        card: selected.target, startRect: selected.startRect, endRect: selected.endRect,
        start: start, end: end, controlPoints: input.controlPoints, durationMs: input.durationMs });
      var result = driver.swipeAccelerated(input);
      if (!result || result.success !== true) return failed("DOUYIN_RECENTS_GESTURE_REJECTED");
      wait(1000);
      var after = snapshot(size);
      function identityKey(card) { return JSON.stringify([card.name, card.locked]); }
      var expected = before.cards.filter(function (card) { return card.name !== "抖音"; }).map(identityKey).sort();
      var actual = after.cards.map(identityKey).sort();
      if (!after.valid || JSON.stringify(expected) !== JSON.stringify(actual)) return failed("DOUYIN_RECENTS_DISMISS_UNVERIFIED", after);
      logger.info("小米14抖音卡片已消失且其他卡片仍在", { taskId: payload && payload.taskId, remainingCards: actual });
      return { completed: true };
    } catch (error) {
      return failed("RECENTS_CLEANUP_ERROR", { message: String(error) });
    }
  }
  return { run: run };
}

module.exports = { createXiaomi14RecentsCleanup: createXiaomi14RecentsCleanup };
