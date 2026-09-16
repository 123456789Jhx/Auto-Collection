const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createDouyinPostPublishCleanup } = require("../features/publish-video/douyin-post-publish-cleanup");

const PREFIX = "com.miui.home:id/";
function node(resourceId, label, description, rectangle, children = []) {
  const [left, top, right, bottom] = rectangle;
  const bounds = { left, top, right, bottom, width: () => right - left,
    height: () => bottom - top, centerX: () => (left + right) / 2, centerY: () => (top + bottom) / 2 };
  const result = { id: () => resourceId ? PREFIX + resourceId : "", text: () => label,
    desc: () => description, packageName: () => "com.miui.home", bounds: () => bounds,
    parent: () => result.owner || null, childCount: () => children.length, child: (i) => children[i],
    clickable: () => false, visibleToUser: () => true, children: () => children };
  children.forEach((child) => { child.owner = result; });
  return result;
}
function card(name, rectangle, description = name + ",未加锁") {
  const [left, top, right, bottom] = rectangle;
  const thumbnail = node("task_view_thumbnail", "", "", rectangle);
  const title = node("title", name, "", [left + 40, top, Math.min(right, left + 180), top + 109]);
  const header = node("task_view_header", "", "", [left, top, right, top + 109], [title]);
  const wrapper = node("task_view_wrapper", "", "", rectangle, [thumbnail, header]);
  const owner = node("", "", description, rectangle, [wrapper]);
  return { owner, wrapper, thumbnail, title };
}
function harness(settings, run) {
  const keys = ["device", "currentPackage", "id", "textMatches", "descMatches", "swipe", "home", "recents", "app"];
  const saved = Object.fromEntries(keys.map((key) => [key, global[key]]));
  const agent = card("燎原星火", [195, 380, 790, 2290]);
  const douyin = card(settings.title === undefined ? "抖音" : settings.title,
    settings.rectangle || [810, 380, 1200, 2290], settings.description);
  let cards = settings.cards ? settings.cards(agent, douyin) : [agent, douyin];
  let packageName = "com.ss.android.ugc.aweme";
  const gestures = [], logs = [], unexpected = [];
  let reads = 0;
  function allNodes() {
    const root = node("recents_view", "", "", [0, 0, 1200, 2670], cards.map((item) => item.owner));
    root.visibleToUser = () => !settings.rootHidden;
    const nodes = [];
    function visit(item) { nodes.push(item); item.children().forEach(visit); }
    visit(root);
    return nodes;
  }
  global.device = { width: 1200, height: 2670 };
  global.currentPackage = () => packageName;
  global.id = (value) => ({
    find() { reads += 1; return allNodes().filter((item) => item.id() === value); },
    findOnce(index = 0) { return allNodes().filter((item) => item.id() === value)[index] || null; }
  });
  const match = (method) => (pattern) => ({ findOne() {
    const regex = new RegExp(pattern);
    return allNodes().find((item) => regex.test(item[method]())) || null;
  } });
  global.textMatches = match("text");
  global.descMatches = match("desc");
  global.swipe = (...args) => { unexpected.push(["swipe", args]); return true; };
  global.home = () => unexpected.push("home");
  global.recents = () => unexpected.push("recents");
  global.app = { launchPackage: () => unexpected.push("launch") };
  const driver = {
    swipe(input) { gestures.push(input); packageName = "com.miui.home"; return { success: !settings.enterRejected }; },
    swipeAccelerated(input) {
      gestures.push(input);
      if (settings.afterSwipe === "wrong-card") cards = [douyin];
      else if (settings.afterSwipe === "hidden-target") { douyin.thumbnail.visibleToUser = () => false; }
      else if (settings.afterSwipe === "changed-agent") cards = [card("燎原星火", [195, 380, 1005, 2290], "燎原星火,已加锁")];
      else if (settings.afterSwipe !== "bounce") cards = [agent];
      if (settings.afterSwipe === "lost-recents") packageName = "com.agri.video.collector";
      return { success: true };
    }
  };
  if (settings.noAccelerated) delete driver.swipeAccelerated;
  try {
    const cleanup = createDouyinPostPublishCleanup({
      deviceProfile: { key: "xiaomi_14", values: { recentsExit: {
        baseWidth: 1200, baseHeight: 2670,
        // An installed base still carries the old geometry; it must not override the approved business gesture.
        startRect: { left: 900, top: 1820, right: 1050, bottom: 2270 },
        endRect: { left: 900, top: 550, right: 1050, bottom: 1000 }, durationMs: [480, 600]
      } } },
      logger: { info(message, details) { logs.push({ message, details }); }, warn(message, details) { logs.push({ message, details }); } },
      accessibility: { createGestureDriver: () => driver },
      wait(milliseconds) { if (settings.drift && milliseconds === 180) douyin.thumbnail.bounds = () => agent.thumbnail.bounds(); },
      isPublishing: () => false, cooldownMs: 0, findCardTimeoutMs: 1,
      randomInt: settings.randomInt || ((min, max) => settings.randomMax ? max : min),
      findAgentCard() { unexpected.push("find-agent"); return agent.owner; },
      openAgentCard() { unexpected.push("open-agent"); return true; }
    });
    const result = cleanup.run({ taskId: "wrong-card-regression" });
    run({ result, gestures, logs, unexpected, reads });
    assert.deepEqual(unexpected, [], "Xiaomi14 must never add a fallback UI action");
  } finally {
    keys.forEach((key) => { if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; });
  }
}

for (const randomMax of [false, true]) {
  test("right Douyin card uses approved rectangles at random " + (randomMax ? "maximum" : "minimum"), () => {
    harness({ randomMax }, ({ result, gestures }) => {
      assert.equal(result.completed, true);
      assert.equal(gestures.length, 2);
      assert.deepEqual(gestures[0].points, [{ x: 600, y: 2668 }, { x: 600, y: 1335 }]);
      const [start, end] = gestures[1].points;
      assert(start.x >= 930 && start.x <= 1080 && start.y >= 1880 && start.y <= 2180);
      assert(end.x >= 930 && end.x <= 1080 && end.y >= 680 && end.y <= 980);
      for (const point of gestures[1].controlPoints) assert(point.x >= 930 && point.x <= 1080);
      assert.equal(gestures[1].controlPoints.length, 2);
      assert.equal(gestures[1].timingProfile, "accelerate_ease_in");
      assert(gestures[1].durationMs >= 480 && gestures[1].durationMs <= 600);
    });
  });
}

test("an unlabeled centered Agent is never assumed to be the prior foreground Douyin", () => {
  harness({ title: "", description: "", cards: (agent, douyin) => {
    agent.title.text = () => ""; agent.owner.desc = () => ""; return [agent, douyin];
  } }, ({ result, gestures }) => { assert.equal(result.completed, false); assert.equal(gestures.length, 1); });
});

test("Douyin text in a full-screen container cannot supply card bounds", () => {
  harness({ rectangle: [0, 0, 1200, 2670] }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("an app-content match such as 打开抖音 cannot identify a recent task", () => {
  harness({ title: "打开抖音", description: "打开抖音应用信息。" }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("a centered Douyin card does not move the approved right-side gesture into another card", () => {
  harness({ rectangle: [195, 380, 790, 2290] }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("a locked task is not swiped", () => {
  harness({ description: "抖音,已加锁" }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("layout movement between recognition and dispatch cancels the second swipe", () => {
  harness({ drift: true }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("an overlapping Agent leaves no safe corridor so no dismissal is sent", () => {
  harness({ cards: (agent, douyin) => [card("燎原星火", [700, 380, 1150, 2290]), douyin] }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

for (const afterSwipe of ["bounce", "wrong-card", "lost-recents"]) {
  test(afterSwipe + " cannot count as a completed dismissal or trigger extra gestures", () => {
    harness({ afterSwipe }, ({ result, gestures }) => { assert.equal(result.completed, false); assert.equal(gestures.length, 2); });
  });
}

test("a rejected entry gesture never falls back to system recents", () => {
  harness({ enterRejected: true }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("a hidden recents tree on the launcher desktop does not permit a card swipe", () => {
  harness({ rootHidden: true }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("partial overlap keeps the whole path beyond the protected Agent edge", () => {
  harness({ cards: (agent, douyin) => [card("燎原星火", [195, 380, 960, 2290]), douyin] }, ({ result, gestures }) => {
    assert.equal(result.completed, true);
    assert.equal(gestures.length, 2);
    for (const point of gestures[1].points.concat(gestures[1].controlPoints)) assert(point.x >= 984 && point.x <= 1080);
  });
});

test("conflicting card title and task description cancel dismissal", () => {
  harness({ description: "燎原星火,未加锁" }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});

test("edge endpoints still produce a curved path inside the safe column", () => {
  harness({ randomInt: (min, max) => min === 930 ? max : min }, ({ gestures }) => {
    const { points: [start, end], controlPoints } = gestures[1];
    assert(controlPoints.some((point) => (point.x - start.x) * (end.y - start.y) !==
      (point.y - start.y) * (end.x - start.x)), "clamping must not flatten both controls onto the endpoint line");
  });
});

for (const settings of [{ title: "", description: "抖音,未加锁" }, { description: "" }]) {
  test("both the task description and nonempty app header must agree: " + JSON.stringify(settings), () => {
    harness(settings, ({ result, gestures }) => { assert.equal(result.completed, false); assert.equal(gestures.length, 1); });
  });
}

test("a hidden target thumbnail is still a task, not a completed dismissal", () => {
  harness({ afterSwipe: "hidden-target" }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 2);
  });
});

test("a changed protected task cannot pass the post-dismissal identity check", () => {
  harness({ afterSwipe: "changed-agent" }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 2);
  });
});

test("missing accelerated driver cannot silently become an ordinary swipe", () => {
  harness({ noAccelerated: true }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 0);
  });
});

test("a tiny sliver of either approved rectangle is insufficient for a safe swipe", () => {
  harness({ rectangle: [810, 955, 1200, 1920] }, ({ result, gestures }) => {
    assert.equal(result.completed, false); assert.equal(gestures.length, 1);
  });
});
