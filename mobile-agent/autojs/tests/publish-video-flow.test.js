const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/发布视频-入口.js");
const { createEditCoverStep } = require("../features/publish-video/编辑封面.js");
const { createPublishTaskLock } = require("../domain/发布任务锁.js");

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
    "ui:选择话题:春耕",
    "ui:选择话题:农技",
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
    payload: { taskId: "task-13-failed", videoUrl: "https://example.test/missing.mp4" }
  });

  assert.equal(result.status, "MATERIAL_INVALID");
  assert.match(result.error, /video download 404/);
  assert.equal(reports[0].result.status, "MATERIAL_INVALID");
  assert.deepEqual(events, ["ack:FAILED"]);
});

test("话题校验失败上报 TOPIC_PENDING 且不执行发布", () => {
  const events = [];
  const reports = [];
  const steps = createSteps(events);
  steps.fill = function () {
    events.push("填写标题描述话题:pending");
    const error = new Error("界面已选话题数量不足，缺少：农技");
    error.publishStatus = "TOPIC_PENDING";
    throw error;
  };
  const handler = createPublishVideoHandler(createContext(events), {
    materialDownloader: {
      download() {
        return { videoPath: "/download/video.mp4", coverPath: "" };
      }
    },
    resultReporter: {
      report(taskId, result) {
        reports.push({ taskId, result });
        return { success: true };
      }
    },
    gate: {
      waitForNext(name, predicate) {
        assert.equal(predicate(), true);
        events.push("gate:" + name);
      }
    },
    steps
  });

  const result = handler.handle({
    id: "command-topic-pending",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-topic-pending",
      title: "春耕",
      description: "春耕记录 #春耕 #农技",
      videoUrl: "https://example.test/video.mp4",
      expectedTopicCount: 2
    }
  });

  assert.equal(result.status, "TOPIC_PENDING");
  assert.equal(reports[0].result.status, "TOPIC_PENDING");
  assert.match(reports[0].result.error, /缺少：农技/);
  assert.equal(events.includes("执行发布与结果判定"), false);
  assert.equal(events.at(-1), "ack:DONE");
});

test("共享入口把视频号平台任务交给视频号 handler", () => {
  const events = [];
  const command = {
    id: "channels-command-route",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: { taskId: "channels-task-route", platform: "WECHAT_CHANNELS" }
  };
  const handler = createPublishVideoHandler(createContext(events), {
    steps: createSteps(events),
    materialDownloader: { download() { throw new Error("抖音下载器不应执行"); } },
    resultReporter: { report() { throw new Error("抖音上报器不应执行"); } },
    channelsHandler: {
      handle(value) {
        events.push("channels:" + value.payload.taskId);
        return { status: "SUCCEEDED" };
      }
    }
  });

  assert.deepEqual(handler.handle(command), { status: "SUCCEEDED" });
  assert.deepEqual(events, ["channels:channels-task-route"]);
});

test("第一条发布执行中重入第二条时返回 PUBLISH_BUSY", () => {
  const events = [];
  const reports = [];
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
  handler = createPublishVideoHandler(createContext(events), {
    steps,
    materialManager,
    publishLock,
    resultReporter: {
      report(taskId, result) { reports.push({ taskId, result }); return { success: true }; }
    },
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
  assert.equal(events.at(-1), "end:/sdcard/20260728");
  assert.deepEqual(reports.map((value) => value.result.status), ["PUBLISH_BUSY", "SUCCEEDED"]);
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
    payload: { taskId: "task-missing-cover", videoUrl: "https://example.test/video.mp4", coverUrl: null }
  });

  assert.equal(result.status, "MATERIAL_INVALID");
  assert.equal(result.error, "缺少封面素材：接口 coverUrl 为空");
  assert.deepEqual(events, [
    "acquire", "begin", "download", "report", "ack:FAILED", "end:/sdcard/20260728", "release"
  ]);
});
