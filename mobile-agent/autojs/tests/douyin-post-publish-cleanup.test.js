const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createDouyinPostPublishCleanup
} = require("../features/publish-video/douyin-post-publish-cleanup.js");

test("确认发布成功后等待 30 秒，再通过最近任务清理抖音后台", () => {
  const events = [];
  const waits = [];
  const douyinCard = { text: "抖音" };
  const agentCard = { text: "燎原星火" };
  const cleanup = createDouyinPostPublishCleanup({
    logger: {
      info(message) { events.push("info:" + message); },
      warn(message) { events.push("warn:" + message); }
    },
    wait(milliseconds) { waits.push(milliseconds); },
    openRecents() { events.push("open_recents"); return true; },
    isPublishing() { return false; },
    findDouyinCard(timeoutMs) { events.push("find_card:" + timeoutMs); return douyinCard; },
    dismissCard(card) { events.push(card === douyinCard ? "dismiss_douyin" : "dismiss_wrong_card"); return true; },
    findAgentCard(timeoutMs) { events.push("find_agent:" + timeoutMs); return agentCard; },
    openAgentCard(card) { events.push(card === agentCard ? "open_agent" : "open_wrong_card"); return true; }
  });

  const result = cleanup.run({ taskId: "cleanup-task-1" });

  assert.deepEqual(result, { completed: true });
  assert.deepEqual(waits, [30000, 1200, 1000]);
  assert.deepEqual(events, [
    "info:抖音发布成功后收尾开始",
    "open_recents",
    "find_card:3000",
    "dismiss_douyin",
    "info:抖音发布成功后后台清理完成",
    "find_agent:3000",
    "open_agent",
    "info:已从最近任务返回燎原星火"
  ]);
});

test("返回燎原星火前先执行发布任务终态收口", () => {
  const events = [];
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn() {} },
    wait() {},
    isPublishing() { return false; },
    openRecents() { return true; },
    findDouyinCard() { return { text: "抖音" }; },
    dismissCard() { events.push("dismiss_douyin"); return true; },
    findAgentCard() { return { text: "燎原星火" }; },
    openAgentCard() { events.push("open_agent"); return true; }
  });

  cleanup.run({ taskId: "cleanup-before-agent" }, {
    beforeReturnToAgent() { events.push("finalize_task"); }
  });

  assert.deepEqual(events, ["dismiss_douyin", "finalize_task", "open_agent"]);
});

test("抖音退出后台后找不到燎原星火卡片时回到系统主页", () => {
  const events = [];
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn(message) { events.push("warn:" + message); } },
    wait() {},
    isPublishing() { return false; },
    openRecents() { return true; },
    findDouyinCard() { return { text: "抖音" }; },
    dismissCard() { return true; },
    findAgentCard() { return null; },
    goHome() { events.push("home"); return true; }
  });

  assert.deepEqual(cleanup.run({ taskId: "cleanup-agent-missing" }), {
    completed: true,
    fallback: "HOME",
    reason: "AGENT_RECENTS_CARD_NOT_FOUND"
  });
  assert.equal(events.includes("home"), true);
});

test("最近任务找不到燎原星火时回桌面并点击燎原星火图标", () => {
  const events = [];
  const homeIcon = { text: "燎原星火" };
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn() {} },
    wait(milliseconds) { events.push("wait:" + milliseconds); },
    isPublishing() { return false; },
    openRecents() { events.push("recents"); return true; },
    findDouyinCard() { return { text: "抖音" }; },
    dismissCard() { events.push("dismiss-douyin"); return true; },
    findAgentCard() { return null; },
    goHome() { events.push("home"); return true; },
    findAgentHomeIcon() { events.push("find-home-icon"); return homeIcon; },
    openAgentHomeIcon(icon) { events.push(icon === homeIcon ? "open-home-icon" : "open-wrong-icon"); return true; },
    cooldownMs: 0,
    recentsReadyWaitMs: 0,
    agentCardReadyWaitMs: 0,
    homeReadyWaitMs: 0
  });

  assert.deepEqual(cleanup.run({ taskId: "cleanup-home-icon" }), {
    completed: true,
    fallback: "HOME_ICON",
    reason: "AGENT_RECENTS_CARD_NOT_FOUND"
  });
  assert.deepEqual(events, [
    "wait:0",
    "recents",
    "wait:0",
    "dismiss-douyin",
    "wait:0",
    "home",
    "wait:0",
    "find-home-icon",
    "open-home-icon"
  ]);
});

test("燎原星火卡片点击失败时回到系统主页", () => {
  const events = [];
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn(message) { events.push("warn:" + message); } },
    wait() {},
    isPublishing() { return false; },
    openRecents() { return true; },
    findDouyinCard() { return { text: "抖音" }; },
    dismissCard() { return true; },
    findAgentCard() { return { text: "燎原星火" }; },
    openAgentCard() { return false; },
    goHome() { events.push("home"); return true; }
  });

  assert.deepEqual(cleanup.run({ taskId: "cleanup-agent-click-failed" }), {
    completed: true,
    fallback: "HOME",
    reason: "AGENT_RECENTS_OPEN_FAILED"
  });
  assert.equal(events.includes("home"), true);
});

test("固定等待 30 秒后仍显示发布进度时不打开最近任务", () => {
  const events = [];
  const waits = [];
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn(message) { events.push("warn:" + message); } },
    wait(milliseconds) { waits.push(milliseconds); },
    isPublishing() { events.push("check_publishing"); return true; },
    openRecents() { events.push("open_recents"); return true; }
  });

  const result = cleanup.run({ taskId: "cleanup-task-progress" });

  assert.deepEqual(result, { completed: false, reason: "PUBLISH_STILL_IN_PROGRESS" });
  assert.deepEqual(waits, [30000]);
  assert.equal(events.includes("open_recents"), false);
});

test("找不到抖音后台卡片时跳过清理，但不将已发布任务判为失败", () => {
  const warnings = [];
  const cleanup = createDouyinPostPublishCleanup({
    logger: { info() {}, warn(message) { warnings.push(message); } },
    wait() {},
    openRecents() { return true; },
    findDouyinCard() { return null; }
  });

  const result = cleanup.run({ taskId: "cleanup-task-2" });

  assert.deepEqual(result, {
    completed: false,
    reason: "DOUYIN_RECENTS_CARD_NOT_FOUND"
  });
  assert.deepEqual(warnings, [
    "抖音发布成功后未识别到抖音任务卡片，跳过后台清理"
  ]);
});

test("默认左滑动作使用已识别抖音卡片的边界", () => {
  const previousDevice = global.device;
  const previousSwipe = global.swipe;
  const swipes = [];
  const cardBounds = {
    left: 100,
    width() { return 800; },
    height() { return 1500; },
    centerY() { return 1050; }
  };
  const card = { bounds() { return cardBounds; }, parent() { return null; } };
  global.device = { width: 1080, height: 2400 };
  global.swipe = (...args) => { swipes.push(args); };

  try {
    const cleanup = createDouyinPostPublishCleanup({
      logger: { info() {}, warn() {} },
      wait() {},
      isPublishing() { return false; },
      openRecents() { return true; },
      findDouyinCard() { return card; },
      findAgentCard() { return { text: "燎原星火" }; },
      openAgentCard() { return true; },
      recentsReadyWaitMs: 0,
      agentCardReadyWaitMs: 0
    });

    assert.deepEqual(cleanup.run({ taskId: "cleanup-card-bounds" }), { completed: true });
    assert.deepEqual(swipes, [[740, 1050, 180, 1050, 420]]);
  } finally {
    global.device = previousDevice;
    global.swipe = previousSwipe;
  }
});
