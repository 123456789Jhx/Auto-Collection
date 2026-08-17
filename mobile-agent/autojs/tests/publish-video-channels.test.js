const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createWechatChannelsPublishHandler,
  correctWechatStartup,
  decideWechatStartupCorrection
} = require("../features/publish-video/channels-publish-flow.js");
const {
  markChannelsVerificationPopup
} = require("../features/publish-video/channels-verify-popup.js");
const { createWechatChannelsPublishUi } = require("../features/publish-video/channels-publish-ui.js");

function withWechatBottomTabMocks(label, callback) {
  const previous = {
    currentPackage: global.currentPackage,
    descMatches: global.descMatches,
    text: global.text,
    device: global.device
  };
  const node = {
    bounds() { return { centerY() { return 2200; } }; },
    selected() { return true; },
    desc() { return label + "，已选中"; },
    parent() { return null; }
  };
  const selector = (kind, value) => ({ findOne() {
    return kind === "descMatches" && value.indexOf("^" + label) === 0 ? node : null;
  } });
  global.currentPackage = () => "com.tencent.mm";
  global.descMatches = (pattern) => selector("descMatches", String(pattern.source || pattern));
  global.text = (value) => selector("text", value);
  global.device = { width: 1080, height: 2400 };
  try {
    callback();
  } finally {
    Object.assign(global, previous);
  }
}

function createContext(events) {
  return {
    config: {
      device: { deviceId: "device-14", deviceToken: "token-14" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      output: { cacheDir: "/runtime/cache", baseDir: "/runtime" }
    },
    loadBizScript(modulePath) {
      return require("../" + modulePath);
    },
    logger: { info() {}, warn() {} },
    uploader: {
      ackCommand(id, status, result) {
        events.push("ack:" + status);
        return { id, status, result };
      }
    }
  };
}

function createSuccessfulUi(events) {
  const startupStates = [
    { foreground: false, bottomTab: "" },
    { foreground: true, bottomTab: "发现" },
    { foreground: true, bottomTab: "信息" }
  ];
  return {
    inspectStartupState() { events.push("检查启动"); return startupStates.shift(); },
    launchWechat() { events.push("启动微信"); },
    forceRestartWechat() { events.push("杀后台重开"); },
    selectWechatHomeTab() { events.push("微信首页页签"); },
    dismissVersionUpdateInvite() { return false; },
    snapshot() { return { visibleText: "视频号正常页面", currentActivityName: "ChannelsActivity" }; },
    openDiscover() { events.push("发现"); },
    openChannels() { events.push("视频号"); },
    openMine() { events.push("我的图标"); },
    openPublishVideo() { events.push("发表视频"); },
    openAlbum() { events.push("相册"); },
    readFirstGalleryItems() { return [{ durationText: "图片" }, { durationText: "00:21" }]; },
    clickGalleryItem(index) { events.push("选择素材:" + index); },
    clickNext() { events.push("下一步"); },
    addTitle() { events.push("添加标题"); },
    inputTitle(value) { events.push("输入标题:" + value); },
    confirmTitle() { events.push("对勾"); },
    tapOutsideTitle() { events.push("标题框外"); },
    completeTitle() { events.push("完成标题"); },
    openCoverSettings() { events.push("封面设置"); },
    chooseCoverFromAlbum() { events.push("从相册选择"); },
    clickCoverGalleryItem(index) { events.push("选择封面:" + index); },
    completeCoverSelection() { events.push("完成封面选择"); },
    completeCoverSettings() { events.push("完成封面设置"); },
    fillDescription(value) { events.push("描述:" + value); },
    selectTopic(topic) { events.push("话题:" + topic); },
    listSelectedTopics() { return ["春耕", "农技"]; },
    publish() { events.push("发表"); },
    waitForPublishOutcome() { events.push("成功判定"); return { success: true }; },
    readPublishedResult() {
      return {
        platformContentId: "channels-14",
        publishedUrl: "https://channels.weixin.qq.com/channels-14"
      };
    },
    states: {
      discoverReady() { return true; },
      channelsReady() { return true; },
      mineReady() { return true; },
      publishMenuReady() { return true; },
      galleryReady() { return true; },
      nextReady() { return true; },
      titleReady() { return true; },
      titleInputReady() { return true; },
      exportStarted() { return true; },
      exportComplete() { return true; },
      coverSourceReady() { return true; },
      coverGalleryReady() { return true; },
      descriptionReady() { return true; },
      publishReady() { return true; }
    }
  };
}

test("微信启动校正仅在底栏信息时保持当前进程", () => {
  assert.deepEqual(decideWechatStartupCorrection({ foreground: false, bottomTab: "" }), {
    action: "LAUNCH",
    reason: "wechat_not_foreground"
  });
  assert.deepEqual(decideWechatStartupCorrection({ foreground: true, bottomTab: "信息" }), {
    action: "KEEP",
    reason: "information_tab_ready"
  });
  assert.deepEqual(decideWechatStartupCorrection({ foreground: true, bottomTab: "发现" }), {
    action: "FORCE_RESTART",
    reason: "information_tab_not_selected"
  });
});

test("强制重启后底栏状态仍不可读时点击微信首页页签继续", () => {
  const events = [];
  const states = [
    { foreground: true, bottomTab: "发现" },
    { foreground: true, bottomTab: "" },
    { foreground: true, bottomTab: "" }
  ];
  const result = correctWechatStartup({
    dismissVersionUpdateInvite() {},
    inspectStartupState() { return states.shift(); },
    forceRestartWechat() { events.push("杀后台重开"); },
    selectWechatHomeTab() { events.push("微信首页页签"); }
  });
  assert.deepEqual(events, ["杀后台重开", "微信首页页签"]);
  assert.deepEqual(result.state, { foreground: true, bottomTab: "信息", inferred: true });
  assert.deepEqual(result.decision, { action: "KEEP", reason: "home_tab_forced_after_restart" });
});

test("微信底栏别名映射为信息并保持发现页前置条件", () => {
  withWechatBottomTabMocks("微信", () => {
    const ui = createWechatChannelsPublishUi({ logger: { warn() {} } });
    assert.deepEqual(ui.inspectStartupState(), { foreground: true, bottomTab: "信息" });
    assert.equal(ui.states.wechatHomeReady(), true);
  });
});

test("信息底栏原路径继续映射为信息", () => {
  withWechatBottomTabMocks("信息", () => {
    const ui = createWechatChannelsPublishUi({ logger: { warn() {} } });
    assert.deepEqual(ui.inspectStartupState(), { foreground: true, bottomTab: "信息" });
    assert.equal(ui.states.wechatHomeReady(), true);
  });
});

test("微信底栏无障碍节点缺失时使用 OCR 回退识别首页", () => {
  const previous = {
    currentPackage: global.currentPackage,
    descMatches: global.descMatches,
    text: global.text,
    device: global.device
  };
  const emptySelector = () => ({ findOne() { return null; } });
  global.currentPackage = () => "com.tencent.mm";
  global.descMatches = emptySelector;
  global.text = emptySelector;
  global.device = { width: 1080, height: 2400 };
  try {
    const ui = createWechatChannelsPublishUi({
      logger: { info() {}, warn() {} },
      screenRecognizer: { extractFastText() { return { combinedText: "微信(63) 通讯录 发现 我" }; } }
    });
    assert.deepEqual(ui.inspectStartupState(), { foreground: true, bottomTab: "信息" });
    assert.equal(ui.states.wechatHomeReady(), true);
  } finally {
    Object.assign(global, previous);
  }
});

test("视频号额外验证弹窗返回待人工标记和弹窗特征", () => {
  const marked = markChannelsVerificationPopup({
    visibleText: "请完成安全验证\n拖动滑块完成拼图",
    currentPackageName: "com.tencent.mm",
    currentActivityName: "VerifyActivity"
  }, "发表前");
  const normal = markChannelsVerificationPopup({ visibleText: "添加描述 发表" }, "发表前");

  assert.equal(marked.detected, true);
  assert.equal(marked.status, "CHANNELS_VERIFY_PENDING");
  assert.equal(marked.feature.stage, "发表前");
  assert.deepEqual(marked.feature.markers, ["安全验证", "拖动滑块"]);
  assert.equal(normal.detected, false);
});

test("视频号流程按启动校正、素材、标题、导出、描述、发表顺序执行", () => {
  const events = [];
  const reports = [];
  const ui = createSuccessfulUi(events);
  const handler = createWechatChannelsPublishHandler(createContext(events), {
    ui,
    materialDownloader: {
      download() {
        events.push("下载素材");
        return { videoPath: "/download/video.mp4", coverPath: "/download/cover.jpg" };
      }
    },
    resultReporter: {
      report(taskId, result) {
        reports.push({ taskId, result });
        events.push("report:" + result.status);
        return { success: true };
      }
    },
    gate: {
      waitForNext(name, predicate) {
        assert.equal(predicate(), true);
        events.push("gate:" + name);
      }
    }
  });

  const result = handler.handle({
    id: "channels-command-14",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "channels-task-14",
      platform: "WECHAT_CHANNELS",
      title: "春耕",
      description: "春耕记录 #春耕 #农技",
      videoUrl: "https://example.test/video.mp4",
      expectedTopicCount: 2,
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(events, [
    "下载素材", "检查启动", "启动微信", "检查启动", "杀后台重开", "检查启动",
    "发现", "gate:进入发现", "视频号", "gate:进入视频号", "我的图标", "gate:打开我的",
    "发表视频", "gate:打开发表视频", "相册", "gate:打开相册", "选择素材:1", "gate:选择发布素材",
    "下一步", "gate:素材下一步", "添加标题", "gate:打开标题输入", "输入标题:春耕",
    "对勾", "标题框外", "完成标题", "gate:完成标题", "gate:等待导出完成",
    "封面设置", "gate:打开封面设置", "从相册选择", "gate:从相册选择封面",
    "选择封面:0", "完成封面选择", "gate:完成封面选择",
    "完成封面设置", "gate:完成封面设置", "描述:春耕记录 #春耕 #农技", "发表", "成功判定",
    "report:SUCCEEDED", "ack:DONE"
  ]);
  assert.equal(reports[0].result.platformContentId, "channels-14");
});

test("视频号将话题保留在描述中且不触发断点补全", () => {
  const events = [];
  const reports = [];
  const ui = createSuccessfulUi(events);
  const handler = createWechatChannelsPublishHandler(createContext(events), {
    ui,
    materialDownloader: {
      download() {
        events.push("下载素材");
        return { videoPath: "/download/video.mp4", coverPath: "/download/cover.jpg" };
      }
    },
    resultReporter: {
      report(taskId, result) {
        reports.push({ taskId, result });
        events.push("report:" + result.status);
        return { success: true };
      }
    },
    gate: { waitForNext(_name, predicate) { assert.equal(predicate(), true); } }
  });

  const result = handler.handle({
    id: "channels-topic-resume-14",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "channels-topic-resume-task-14",
      platform: "WECHAT_CHANNELS",
      title: "春耕",
      description: "初始 #春耕 #农技",
      videoUrl: "https://example.test/video.mp4",
      expectedTopicCount: 2
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(reports.map((item) => item.result.status), ["SUCCEEDED"]);
  assert.equal(events.filter((value) => value === "下载素材").length, 1);
  assert.equal(events.filter((value) => value === "启动微信").length, 1);
  assert.equal(events.filter((value) => value === "杀后台重开").length, 1);
  const progression = ["描述:初始 #春耕 #农技", "发表"];
  assert.deepEqual(events.filter((value) => progression.includes(value)), progression);
  assert.equal(events.includes("poll"), false);
});

test("流程中发现验证弹窗立即上报 CHANNELS_VERIFY_PENDING", () => {
  const events = [];
  const reports = [];
  const ui = createSuccessfulUi(events);
  let popupVisible = false;
  ui.openDiscover = function () {
    events.push("发现");
    popupVisible = true;
  };
  ui.snapshot = function () {
    return { visibleText: popupVisible ? "请完成安全验证\n验证码" : "正常页面" };
  };
  const handler = createWechatChannelsPublishHandler(createContext(events), {
    ui,
    materialDownloader: { download() { return { videoPath: "/download/video.mp4", coverPath: "" }; } },
    resultReporter: {
      report(taskId, result) { reports.push({ taskId, result }); return { success: true }; }
    },
    gate: {
      waitForNext(name, predicate) { return predicate(); }
    }
  });

  const result = handler.handle({
    id: "channels-verify-14",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "channels-verify-task-14",
      platform: "WECHAT_CHANNELS",
      videoUrl: "https://example.test/video.mp4"
    }
  });

  assert.equal(result.status, "CHANNELS_VERIFY_PENDING");
  assert.match(reports[0].result.error, /安全验证/);
  assert.equal(events.includes("视频号"), false);
  assert.equal(events.at(-1), "ack:DONE");
});

test("添加标题后出现验证弹窗时不继续输入或点击", () => {
  const events = [];
  const reports = [];
  const ui = createSuccessfulUi(events);
  let popupVisible = false;
  ui.addTitle = function () {
    events.push("添加标题");
    popupVisible = true;
  };
  ui.snapshot = function () {
    return { visibleText: popupVisible ? "请完成身份验证\n验证码" : "正常页面" };
  };
  const handler = createWechatChannelsPublishHandler(createContext(events), {
    ui,
    materialDownloader: { download() { return { videoPath: "/download/video.mp4", coverPath: "" }; } },
    resultReporter: {
      report(taskId, result) { reports.push({ taskId, result }); return { success: true }; }
    },
    gate: { waitForNext(name, predicate) { return predicate(); } }
  });

  const result = handler.handle({
    id: "channels-title-verify-14",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "channels-title-verify-task-14",
      platform: "WECHAT_CHANNELS",
      title: "春耕",
      description: "春耕记录 #春耕",
      videoUrl: "https://example.test/video.mp4",
      expectedTopicCount: 1
    }
  });

  assert.equal(result.status, "CHANNELS_VERIFY_PENDING");
  assert.equal(events.some((value) => value.startsWith("输入标题:")), false);
  assert.equal(events.includes("对勾"), false);
  assert.equal(events.includes("标题框外"), false);
  assert.equal(events.includes("完成"), false);
  assert.equal(events.some((value) => /^(描述:|话题:|发表$|成功判定$)/.test(value)), false);
  assert.match(reports[0].result.error, /身份验证/);
});
