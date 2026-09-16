const assert = require("node:assert/strict");
const { test } = require("node:test");

const targetLive = require("../features/account-warmup/target-live-entry.js");

function withXiaomiGlobals(run) {
  const previous = {
    device: global.device,
    currentPackage: global.currentPackage,
    textMatches: global.textMatches,
    descMatches: global.descMatches,
    id: global.id,
    recents: global.recents,
    home: global.home,
    sleep: global.sleep,
    click: global.click,
    app: global.app
  };
  global.device = { width: 1200, height: 2670 };
  global.currentPackage = () => "com.ss.android.ugc.aweme";
  global.textMatches = () => ({ findOne() { return null; } });
  global.descMatches = () => ({ findOne() { return null; } });
  global.recents = () => { throw new Error("recover must use the injected gesture driver"); };
  global.home = () => { throw new Error("recover must not return to home"); };
  global.sleep = () => {};
  global.click = () => { throw new Error("recover must not click the agent card"); };
  global.app = { launchPackage() { throw new Error("recover must not launch a package"); } };
  try {
    return run();
  } finally {
    Object.keys(previous).forEach((key) => {
      global[key] = previous[key];
    });
  }
}

function createContext(state) {
  return {
    deviceProfile: { key: "xiaomi_14", values: {
      recentsExit: {
        baseWidth: 1200,
        baseHeight: 2670,
        startRect: { left: 930, top: 1880, right: 1080, bottom: 2180 },
        endRect: { left: 930, top: 680, right: 1080, bottom: 980 },
        durationMs: [480, 600]
      }
    } },
    accessibility: {
      createGestureDriver() {
        return {
          swipe(input) {
            state.gestures.push(input);
            if (state.gestures.length === 1) global.currentPackage = () => "com.miui.home";
            return { success: true };
          },
          swipeAccelerated(input) {
            state.gestures.push(input);
            return { success: true };
          }
        };
      }
    }
  };
}

function installRecentsTree(state, includeDouyin) {
  const root = { id: () => "com.miui.home:id/recents_view", packageName: () => "com.miui.home",
    visibleToUser: () => true, parent: () => null, childCount: () => 0 };
  function card(name, left) {
    const title = { id: () => "com.miui.home:id/title", text: () => name, childCount: () => 0,
      parent: () => header };
    const header = { id: () => "com.miui.home:id/task_view_header", text: () => "", childCount: () => 1,
      child: () => title, parent: () => wrapper };
    const owner = { id: () => "com.miui.home:id/task_view", packageName: () => "com.miui.home",
      desc: () => name + ",未加锁", parent: () => root, childCount: () => 0 };
    const wrapper = { id: () => "com.miui.home:id/task_view_wrapper", packageName: () => "com.miui.home",
      childCount: () => 1, child: () => header, parent: () => owner };
    return { id: () => "com.miui.home:id/task_view_thumbnail", packageName: () => "com.miui.home",
      visibleToUser: () => true, bounds: () => ({ left, top: 343, right: left + 456, bottom: 2327 }),
      parent: () => wrapper, childCount: () => 0 };
  }
  const douyin = card("抖音", 744);
  const agent = card("燎原星火", 207);
  global.id = (selector) => ({
    findOnce() { return selector === "com.miui.home:id/recents_view" ? root : null; },
    find() {
      if (selector !== "com.miui.home:id/task_view_thumbnail") return [];
      return state.gestures.length > 1 || !includeDouyin ? [agent] : [douyin, agent];
    }
  });
}

test("target-live 小米14恢复复用清理器并只执行两段上滑", () => withXiaomiGlobals(() => {
  const state = { gestures: [] };
  installRecentsTree(state, true);
  const runtime = targetLive.createTargetLiveRuntime(createContext(state), { info() {}, warn() {} });

  const result = runtime.recover();
  assert.equal(result, true);
  assert.equal(state.gestures.length, 2);
  assert.deepEqual(state.gestures[0].points, [{ x: 600, y: 2668 }, { x: 600, y: 1335 }]);
  assert.equal(state.gestures[1].points[0].y > state.gestures[1].points[1].y, true);
  assert.equal(state.gestures[1].points[0].x >= 930 && state.gestures[1].points[0].x <= 1080, true);
  assert.equal(state.gestures[1].points[1].x >= 930 && state.gestures[1].points[1].x <= 1080, true);
}));

test("target-live 小米14身份不确定时拒绝第二段上滑", () => withXiaomiGlobals(() => {
  const state = { gestures: [] };
  installRecentsTree(state, false);
  const runtime = targetLive.createTargetLiveRuntime(createContext(state), { info() {}, warn() {} });

  assert.equal(runtime.recover(), false);
  assert.deepEqual(state.gestures.map((gesture) => gesture.points), [[
    { x: 600, y: 2668 }, { x: 600, y: 1335 }
  ]]);
}));

test("target-live 非小米14恢复保留原最近任务和回桌面行为", () => {
  const saved = { recents: global.recents, home: global.home, sleep: global.sleep, textMatches: global.textMatches };
  const events = [];
  global.recents = () => { events.push("recents"); };
  global.home = () => { events.push("home"); };
  global.sleep = () => {};
  global.textMatches = () => ({ findOne: () => null });
  try {
    const runtime = targetLive.createTargetLiveRuntime({ deviceProfile: { key: "mi_8" } }, { info() {}, warn() {} });
    assert.equal(runtime.recover(), true);
    assert.deepEqual(events, ["recents", "home"]);
  } finally {
    Object.keys(saved).forEach((key) => { global[key] = saved[key]; });
  }
});
