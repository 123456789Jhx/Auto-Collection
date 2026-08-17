const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/publish-video-entry.js");
const { createEditCoverStep } = require("../features/publish-video/edit-cover.js");
const { createPublishTaskLock } = require("../domain/publish-task-lock.js");

function createContext(events) {
  return {
    config: {
      device: { deviceId: "device-13", deviceToken: "token-13" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      output: { baseDir: "/runtime" }
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

function createSteps(events) {
  return {
    open(payload) {
      events.push("打开抖音到相机页");
      assert.equal(payload.title, "春耕");
    },
    select(materials) {
      events.push("选择发布素材:" + materials.videoPath);
    },
    editCover(materials) {
      events.push("编辑封面:" + materials.coverPath);
    },
    fill(payload) {
      events.push("填写标题描述话题:" + payload.expectedTopicCount);
    },
    publish() {
      events.push("执行发布与结果判定");
      return {
        platformContentId: "douyin-13",
        publishedUrl: "https://www.douyin.com/video/douyin-13"
      };
    },
    states: {
      galleryReady() { return true; },
      coverEditReady() { return true; },
      publishFormReady() { return true; },
      publishReviewReady() { return true; }
    }
  };
}

test("发布入口按动作与双闸口顺序执行并回传成功", () => {
  const events = [];
  const reports = [];
  const ui = {
    openCamera() { events.push("ui:打开抖音到相机页"); },
    openAlbum() { events.push("ui:打开相册"); },
    readFirstGalleryItems() { return [{ durationText: "" }, { durationText: "00:18" }]; },
    clickGalleryItem(index) { events.push("ui:选择素材:" + index); },
    clickNextIfPresent() { events.push("ui:下一步"); },
    openCoverAlbum() { events.push("ui:AI编辑封面到相册"); },
    closeCoverDiagnostic() { events.push("ui:关闭封面诊断"); },
    saveCover() { events.push("ui:保存封面"); },
    fillTitleAndDescription(title, description) {
      events.push("ui:填写:" + title + ":" + description);
    },
    selectTopic(topic) { events.push("ui:选择话题:" + topic); },
    listSelectedTopics() { return ["春耕", "农技"]; },
    confirmReview() { events.push("ui:发布前复核"); return true; },
    publish() { events.push("ui:发布"); },
    waitForPublishSuccess() { events.push("ui:判定成功"); return true; },
    readPublishedResult() {
      events.push("ui:读取发布结果");
      return {
        platformContentId: "douyin-13",
        publishedUrl: "https://www.douyin.com/video/douyin-13"
      };
    },
    states: {
      galleryReady() { return true; },
      coverEditReady() { return true; },
      publishFormReady() { return true; },
      publishReviewReady() { return true; }
    }
  };
  const handler = createPublishVideoHandler(createContext(events), {
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
    id: "command-13",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-13",
      title: "春耕",
      description: "春耕记录 #春耕 #农技",
      videoUrl: "https://example.test/video.mp4",
      coverUrl: "https://example.test/cover.jpg",
      downloadDir: "/download",
      expectedTopicCount: 2,
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(events, [
    "下载素材",
    "ui:打开抖音到相机页",
    "gate:选择发布素材",
    "ui:打开相册",
    "ui:选择素材:1",
    "ui:下一步",
    "gate:编辑封面",
    "ui:AI编辑封面到相册",
    "ui:选择素材:0",
    "ui:下一步",
    "ui:关闭封面诊断",
    "ui:保存封面",
    "ui:下一步",
    "gate:填写标题描述话题",
    "ui:填写:春耕:春耕记录 #春耕 #农技",
    "gate:执行发布与结果判定",
    "ui:发布前复核",
    "ui:发布",
    "ui:判定成功",
    "ui:读取发布结果",
    "report:SUCCEEDED",
    "ack:DONE"
  ]);
  assert.deepEqual(reports, [{
    taskId: "task-13",
    result: {
      deviceId: "device-13",
      deviceToken: "token-13",
      status: "SUCCEEDED",
      publishedUrl: "https://www.douyin.com/video/douyin-13",
      platformContentId: "douyin-13"
    }
  }]);
});

test("没有封面时编辑步骤仍进入下一页", () => {
  let nextCount = 0;
  const editCover = createEditCoverStep({
    clickNextIfPresent() { nextCount += 1; }
  });

  assert.deepEqual(editCover({ videoPath: "/download/video.mp4", coverPath: "" }), { skipped: true });
  assert.equal(nextCount, 1);
});

test("任一素材下载失败上报 MATERIAL_INVALID 并停止 UI 流程", () => {
  const events = [];
  const reports = [];
  const handler = createPublishVideoHandler(createContext(events), {
    materialDownloader: {
      download() {
        throw new Error("video download 404");
      }
    },
    resultReporter: {
      report(taskId, result) {
        reports.push({ taskId, result });
        return { success: true };
      }
    },
    gate: { waitForNext() { throw new Error("gate should not run"); } },
    steps: createSteps(events)
  });

  const result = handler.handle({
    id: "command-13-failed",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-13-failed",
      description: "发布 #春耕 #农技",
      expectedTopicCount: 2,
      videoUrl: "https://example.test/missing.mp4"
    }
  });

  assert.equal(result.status, "MATERIAL_INVALID");
  assert.match(result.error, /video download 404/);
  assert.equal(reports[0].result.status, "MATERIAL_INVALID");
  assert.deepEqual(events, ["ack:FAILED"]);
});

test("视频号经共享入口在验证待处理或异常时清理目录并释放锁", () => {
  const cases = [
    { status: "CHANNELS_VERIFY_PENDING", ack: "DONE", popupText: "请先验证" },
    { status: "FAILED", ack: "FAILED", throwStartup: true }
  ];
  for (const scenario of cases) {
    const events = [];
    const reports = [];
    const acknowledgements = [];
    const context = createContext(events);
    context.uploader.ackCommand = function (id, status, detail) { events.push("ack:" + status); acknowledgements.push({ id, status, detail }); };
    const handler = createPublishVideoHandler(context, {
      materialManager: {
        beginTask() { events.push("begin"); return { dir: "/channels/task", videoPath: "/channels/task/video.mp4", coverPath: "/channels/task/cover.jpg" }; },
        download(paths) { events.push("download"); return paths; },
        endTask(dir) { events.push("cleanup:" + dir); }
      },
      publishLock: {
        acquire() { events.push("acquire"); return true; },
        release() { events.push("release"); }
      },
      resultReporter: { report(taskId, result) { reports.push({ taskId, result }); events.push("report:" + result.status); } },
      channelsUi: {
        inspectStartupState() {
          events.push("startup");
          if (scenario.throwStartup) throw new Error("微信启动异常");
          return { foreground: true, bottomTab: "信息" };
        },
        snapshot() { events.push("snapshot"); return { visibleText: scenario.popupText || "" }; },
        openDiscover() { events.push("open-discover"); }
      }
    });
    const result = handler.handle({
      id: "channels-cleanup-" + scenario.status,
      commandType: "PUBLISH_VIDEO_TASK",
      payload: { taskId: "channels-cleanup-task", platform: "WECHAT_CHANNELS", description: "发布 #春耕 #农技", expectedTopicCount: 2, videoUrl: "https://example.test/video.mp4", coverUrl: "https://example.test/cover.jpg" }
    });

    assert.equal(result.status, scenario.status);
    assert.equal(reports[0].result.status, scenario.status);
    const acknowledgement = acknowledgements[0];
    assert.equal(acknowledgement.status, scenario.ack);
    if (scenario.status === "CHANNELS_VERIFY_PENDING") assert.ok(acknowledgement.detail.popupFeature);
    assert.equal(events.filter((value) => value === "cleanup:/channels/task").length, 1);
    assert.equal(events.filter((value) => value === "release").length, 1);
    assert.equal(events.includes("open-discover"), false);
  }
});

test("第一条发布执行中重入第二条时返回 PUBLISH_BUSY", () => {
  const events = [];
  const reports = [];
  const acknowledgements = [];
  const context = createContext(events);
  context.uploader.ackCommand = function (id, status, result) {
    events.push("ack:" + status);
    acknowledgements.push({ id, status, result });
    return { id, status, result };
  };
  const lockValues = {};
  const storage = {
    get(key, fallback) { return Object.hasOwn(lockValues, key) ? lockValues[key] : fallback; },
    put(key, value) { lockValues[key] = value; },
    remove(key) { delete lockValues[key]; }
  };
  const publishLock = createPublishTaskLock({ storage, now: () => 1000, ownerId: "flow-test" });
  const materialManager = {
    beginTask() {
      events.push("begin");
      return { dir: "/sdcard/20260728", videoPath: "/sdcard/20260728/video.mp4", coverPath: "/sdcard/20260728/cover.jpg" };
    },
    download(paths) { events.push("download"); return paths; },
    endTask(dir) { events.push("end:" + dir); }
  };
  const steps = createSteps(events);
  let secondResult;
  let handler;
  const originalOpen = steps.open;
  steps.open = function (payload) {
    originalOpen(payload);
    secondResult = handler.handle({
      id: "command-overlap-second",
      commandType: "PUBLISH_VIDEO_TASK",
      payload: { taskId: "task-overlap-second", title: "春耕" }
    });
  };
  handler = createPublishVideoHandler(context, {
    steps,
    materialManager,
    publishLock,
    resultReporter: {
      report(taskId, result) { reports.push({ taskId, result }); return { success: true }; }
    },
    topicContinuation: { waitForResolvedDescription() { events.push("topic-resume"); } },
    gate: { waitForNext(name, predicate) { assert.equal(predicate(), true); events.push("gate:" + name); } }
  });

  const firstResult = handler.handle({
    id: "command-overlap-first",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-overlap-first",
      title: "春耕",
      description: "#春耕 #农技",
      videoUrl: "https://example.test/video.mp4",
      coverUrl: "https://example.test/cover.jpg",
      expectedTopicCount: 2
    }
  });

  assert.equal(firstResult.status, "SUCCEEDED");
  assert.deepEqual(secondResult, {
    status: "PUBLISH_BUSY",
    error: "上一发布任务仍在执行",
    publishedUrl: "",
    platformContentId: ""
  });
  assert.equal(events.filter((value) => value === "begin").length, 1);
  assert.equal(events.filter((value) => value === "download").length, 1);
  assert.equal(events.filter((value) => value === "打开抖音到相机页").length, 1);
  assert.equal(events.includes("topic-resume"), false);
  assert.equal(events.some((value) => /retry|delay|重试|延迟/.test(value)), false);
  assert.equal(events.at(-1), "end:/sdcard/20260728");
  assert.deepEqual(reports.map((value) => value.result.status), ["PUBLISH_BUSY", "SUCCEEDED"]);
  const busyAck = acknowledgements.find((value) => value.id === "command-overlap-second");
  assert.deepEqual(busyAck, {
    id: "command-overlap-second",
    status: "FAILED",
    result: { applied: false, commandType: "PUBLISH_VIDEO_TASK", status: "PUBLISH_BUSY", message: "上一发布任务仍在执行", publishedUrl: "", platformContentId: "" }
  });
  assert.equal("nextDispatchAt" in busyAck.result, false);
  assert.equal("retryAfterMs" in busyAck.result, false);
  assert.equal(publishLock.acquire(), true);
  publishLock.release();
});

test("素材下载失败仍清理任务目录并释放执行器锁", () => {
  const events = [];
  const handler = createPublishVideoHandler(createContext(events), {
    materialManager: {
      beginTask() {
        events.push("begin");
        return { dir: "/sdcard/20260728", videoPath: "/sdcard/20260728/video.mp4", coverPath: "/sdcard/20260728/cover.jpg" };
      },
      download() { events.push("download"); throw new Error("缺少封面素材：接口 coverUrl 为空"); },
      endTask(dir) { events.push("end:" + dir); }
    },
    publishLock: {
      acquire() { events.push("acquire"); return true; },
      release() { events.push("release"); }
    },
    resultReporter: { report() { events.push("report"); return { success: true }; } },
    gate: { waitForNext() { throw new Error("gate should not run"); } },
    steps: createSteps(events)
  });

  const result = handler.handle({
    id: "command-missing-cover",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-missing-cover",
      description: "发布 #春耕 #农技",
      expectedTopicCount: 2,
      videoUrl: "https://example.test/video.mp4",
      coverUrl: null
    }
  });

  assert.equal(result.status, "MATERIAL_INVALID");
  assert.equal(result.error, "缺少封面素材：接口 coverUrl 为空");
  assert.deepEqual(events, [
    "acquire", "begin", "download", "report", "ack:FAILED", "end:/sdcard/20260728", "release"
  ]);
});
