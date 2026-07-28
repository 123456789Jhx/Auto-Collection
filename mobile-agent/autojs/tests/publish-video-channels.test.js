const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createWechatChannelsPublishHandler,
  decideWechatStartupCorrection
} = require("../features/publish-video/channels-publish-flow.js");
const {
  markChannelsVerificationPopup
} = require("../features/publish-video/channels-verify-popup.js");

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
    completeTitle() { events.push("完成"); },
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
      albumReady() { return true; },
      titleReady() { return true; },
      exportComplete() { return true; },
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

test("视频号流程按启动校正、素材、标题、导出、话题、发表顺序执行", () => {
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
    "gate:进入发现", "发现", "gate:进入视频号", "视频号", "gate:打开我的",
    "我的图标", "gate:打开发表视频", "发表视频", "gate:选择发布素材", "相册",
    "选择素材:1", "下一步", "gate:添加标题", "添加标题", "输入标题:春耕",
    "对勾", "标题框外", "完成", "gate:等待导出", "描述:春耕记录 #春耕 #农技",
    "话题:春耕", "话题:农技", "gate:发表视频", "发表", "成功判定",
    "report:SUCCEEDED", "ack:DONE"
  ]);
  assert.equal(reports[0].result.platformContentId, "channels-14");
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
  assert.match(reports[0].result.error, /身份验证/);
});
