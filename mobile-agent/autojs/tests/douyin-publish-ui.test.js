const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createDouyinPublishUi } = require("../features/publish-video/douyin-publish-ui.js");

function withAutoJsMocks(resolveNode, callback) {
  const previous = {
    textMatches: global.textMatches,
    descMatches: global.descMatches,
    textContains: global.textContains,
    sleep: global.sleep,
    click: global.click,
    device: global.device,
    app: global.app
  };
  const selector = (kind, value) => ({ findOne: () => resolveNode(kind, value) });
  global.textMatches = (pattern) => selector("textMatches", String(pattern.source || pattern));
  global.descMatches = (pattern) => selector("descMatches", String(pattern.source || pattern));
  global.textContains = (value) => selector("textContains", value);
  global.sleep = () => {};
  global.click = () => false;
  global.device = { width: 1080, height: 2400 };
  try {
    callback();
  } finally {
    Object.assign(global, previous);
  }
}

function clickableNode(onClick) {
  return {
    clickable() { return true; },
    click() { onClick(); return true; },
    parent() { return null; }
  };
}

test("打开抖音后仍处于其他窗口时强制停止后重新打开", () => {
  const events = [];
  let launchCount = 0;
  let foreground = false;
  let phase = "";
  const stop = clickableNode(() => { events.push("stop"); phase = "confirm"; });
  const confirm = clickableNode(() => { events.push("confirm"); });
  const ui = createDouyinPublishUi({
    douyin: {
      openApp() { launchCount += 1; events.push("open"); foreground = launchCount > 1; },
      isForeground() { return foreground; }
    },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (phase === "confirm" && value.includes("确定")) return confirm;
    if (!phase && value.includes("强行停止")) return stop;
    return null;
  }, () => {
    global.app = { openAppSetting(packageName) { events.push("settings:" + packageName); } };
    assert.equal(ui.openApp(), true);
  });

  assert.deepEqual(events, ["open", "settings:com.ss.android.ugc.aweme", "stop", "confirm", "open"]);
});

test("误入直播页时切换拍摄页签并确认相册入口", () => {
  const events = [];
  const logs = [];
  let screen = "home";
  const entry = clickableNode(() => { events.push("entry"); screen = "live"; });
  const cameraTab = clickableNode(() => { events.push("camera-tab"); screen = "camera"; });
  const album = clickableNode(() => { events.push("album"); });
  const ui = createDouyinPublishUi({
    douyin: { openApp() { events.push("open-app"); } },
    logger: {
      info(message, data) { logs.push({ level: "info", message, data }); },
      warn(message, data) { logs.push({ level: "warn", message, data }); }
    }
  });

  withAutoJsMocks((kind, value) => {
    if (screen === "home" && kind === "descMatches" && value.includes("发布作品")) return entry;
    if (screen === "live" && kind === "textMatches" && value === "^(拍摄|相机)$") return cameraTab;
    if (screen === "camera" && kind === "textMatches" && value === "^(相册|从相册选择)$") return album;
    return null;
  }, () => {
    assert.equal(ui.openCamera(), true);
  });

  assert.deepEqual(events, ["open-app", "entry", "camera-tab"]);
  assert.deepEqual(logs.at(-1), {
    level: "info",
    message: "抖音相机页已就绪",
    data: { recoveredFromLive: true }
  });
});

test("拍摄页签仅以包含文本的无障碍描述暴露时仍可从直播页恢复", () => {
  const events = [];
  let screen = "home";
  const entry = clickableNode(() => { events.push("entry"); screen = "live"; });
  const cameraTab = clickableNode(() => { events.push("camera-tab"); screen = "camera"; });
  const album = clickableNode(() => { events.push("album"); });
  const ui = createDouyinPublishUi({
    douyin: { openApp() { events.push("open-app"); } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (screen === "home" && kind === "descMatches" && value.includes("发布作品")) return entry;
    if (screen === "live" && kind === "descMatches" && value === ".*(拍摄|相机).*") return cameraTab;
    if (screen === "camera" && kind === "textMatches" && value === "^(相册|从相册选择)$") return album;
    return null;
  }, () => {
    assert.equal(ui.openCamera(), true);
  });

  assert.deepEqual(events, ["open-app", "entry", "camera-tab"]);
});

test("相机页签不存在时停止发布前置流程", () => {
  let screen = "home";
  const entry = clickableNode(() => { screen = "live"; });
  const ui = createDouyinPublishUi({
    douyin: { openApp() {} },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (screen === "home" && kind === "descMatches" && value.includes("发布作品")) return entry;
    return null;
  }, () => {
    assert.throws(() => ui.openCamera(), /未找到拍摄\/相机页签/);
  });
});

test("相册入口可见时不要求拍摄页签可识别", () => {
  const events = [];
  let screen = "home";
  const entry = clickableNode(() => { events.push("entry"); screen = "camera"; });
  const album = clickableNode(() => { events.push("album"); });
  const ui = createDouyinPublishUi({
    douyin: { openApp() { events.push("open-app"); } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (screen === "home" && kind === "descMatches" && value.includes("发布作品")) return entry;
    if (screen === "camera" && kind === "textMatches" && value === "^(相册|从相册选择)$") return album;
    return null;
  }, () => {
    assert.equal(ui.openCamera(), true);
  });

  assert.deepEqual(events, ["open-app", "entry"]);
});

test("抖音快速文本快照使用 combinedText 判断相册页", () => {
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { combinedText: "相册 拍摄 视频" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.states.galleryReady(), true);
  });
});

test("相册 selector 命中时即使 OCR 为空也允许选择发布素材", () => {
  const album = clickableNode(() => {});
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return ""; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (kind === "textMatches" && value === "^(相册|从相册选择)$") return album;
    return null;
  }, () => {
    assert.equal(ui.states.galleryReady(), true);
  });
});

test("切回相机页后 galleryReady 复用相机页 selector 判定", () => {
  let screen = "home";
  const entry = clickableNode(() => { screen = "live"; });
  const cameraTab = clickableNode(() => { screen = "camera"; });
  const album = clickableNode(() => {});
  const ui = createDouyinPublishUi({
    douyin: {
      openApp() {},
      extractFastText() { return ""; }
    },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (screen === "home" && kind === "descMatches" && value.includes("发布作品")) return entry;
    if (screen === "live" && kind === "textMatches" && value === "^(拍摄|相机)$") return cameraTab;
    if (screen === "camera" && kind === "textMatches" && value === "^(相册|从相册选择)$") return album;
    return null;
  }, () => {
    assert.equal(ui.openCamera(), true);
    assert.equal(ui.states.galleryReady(), true);
  });
});

test("屏幕识别快照使用 visibleText 判断封面编辑页", () => {
  const ui = createDouyinPublishUi({
    screenRecognizer: { extractFastText() { return { visibleText: "AI编辑封面 下一步" }; } },
    logger: { info() {}, warn() {} }
  });

  assert.equal(ui.states.coverEditReady(), true);
});

test("快照文本字段支持发布结果提取且不会回退为对象字符串", () => {
  const ui = createDouyinPublishUi({
    screenRecognizer: {
      extractFastText() {
        return { screenText: "发布成功 https://example.test/video-123 作品ID:video123" };
      }
    },
    logger: { info() {}, warn() {} }
  });

  assert.deepEqual(ui.readPublishedResult(), {
    publishedUrl: "https://example.test/video-123",
    platformContentId: "video123"
  });
});

test("发布进度持续存在时不能判定发布成功", () => {
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { visibleText: "发布进度 75% 正在发布" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.waitForPublishSuccess(10), false);
  });
});

test("曾出现发布进度且随后连续稳定回到首页时可判定成功", () => {
  const snapshots = [
    "发布进度 20%",
    "首页 朋友 消息 我",
    "首页 朋友 消息 我",
    "首页 朋友 消息 我"
  ];
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { visibleText: snapshots.shift() || "首页 朋友 消息 我" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.waitForPublishSuccess(100), true);
  });
});

test("从未观察到发布进度时普通首页不能作为成功证据", () => {
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { visibleText: "首页 朋友 消息 我" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.waitForPublishSuccess(10), false);
  });
});

test("发布进度消失后仅出现我的作品不能冒充稳定首页", () => {
  const snapshots = ["发布进度 90%", "我的作品"];
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { visibleText: snapshots.shift() || "我的作品" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.waitForPublishSuccess(10), false);
  });
});

test("作品已发布属于明确成功证据", () => {
  const ui = createDouyinPublishUi({
    douyin: { extractFastText() { return { visibleText: "作品已发布" }; } },
    logger: { info() {}, warn() {} }
  });

  withAutoJsMocks(() => null, () => {
    assert.equal(ui.waitForPublishSuccess(10), true);
  });
});


test("封面入口文本可作为封面页就绪条件", () => {
  const ui = createDouyinPublishUi({
    screenRecognizer: { extractFastText() { return { visibleText: "选封面 发布" }; } },
    logger: { info() {}, warn() {} }
  });

  assert.equal(ui.states.coverEditReady(), true);
});

test("抖音新版本内测邀请统一点击以后再说", () => {
  const events = [];
  const ui = createDouyinPublishUi({
    douyin: { openApp() { events.push("open-app"); } },
    logger: { info(message) { events.push(message); }, warn() {} }
  });

  withAutoJsMocks((kind, value) => {
    if (kind === "textMatches" && value === "^新版本内测邀请$") return clickableNode(() => {});
    if (kind === "textMatches" && value === "^以后再说$") return clickableNode(() => { events.push("later"); });
    return null;
  }, () => assert.equal(ui.openApp(), true));

  assert.deepEqual(events, ["open-app", "later", "抖音新版本内测邀请已跳过"]);
});

test("共享启动入口识别遗留素材页并停止新发布任务", () => {
  const events = [];
  const ui = createDouyinPublishUi({
    douyin: {
      openApp() { events.push("open-app"); },
      extractFastText() { return { combinedText: "相册\n选择视频素材\n下一步" }; }
    },
    logger: { info() {}, warn(message) { events.push(message); } }
  });

  withAutoJsMocks(() => null, () => {
    assert.throws(() => ui.openApp(), /DOUYIN_UNEXPECTED_PAGE/);
  });

  assert.deepEqual(events, ["open-app", "抖音仍停留在上次发布页面，已停止新任务"]);
});

test("封面相册优先点击无障碍首项", () => {
  const events = [];
  const ui = createDouyinPublishUi({ logger: { info() {}, warn() {} } });

  withAutoJsMocks((kind, value) => {
    if (kind === "descMatches" && value.includes("点按两次即可激活")) {
      return clickableNode(() => { events.push("accessible-cover"); });
    }
    return null;
  }, () => ui.clickGalleryItem(0, true));

  assert.deepEqual(events, ["accessible-cover"]);
});
