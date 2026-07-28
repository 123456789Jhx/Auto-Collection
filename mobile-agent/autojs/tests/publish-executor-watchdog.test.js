const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishExecutorWatchdog } = require("../domain/发布执行器看门狗.js");
const { createPublishVideoHandler } = require("../features/publish-video/发布视频-入口.js");

test("发布执行器看门狗超时触发一次回调且完成后可中断线程", () => {
  let runner;
  let timeoutCount = 0;
  let interrupted = 0;
  const watchdog = createPublishExecutorWatchdog({
    timeoutMs: 600000,
    sleep() {},
    startThread(value) {
      runner = value;
      return { interrupt() { interrupted += 1; } };
    }
  });
  const guard = watchdog.start(() => { timeoutCount += 1; });

  runner();
  runner();
  assert.equal(timeoutCount, 1);
  assert.equal(guard.timedOut(), true);
  guard.complete();
  assert.equal(interrupted, 1);
});

test("发布入口记录下载、App、gate 和 finish 阶段日志", () => {
  const logs = [];
  const context = {
    config: {
      device: { deviceId: "watchdog-device", deviceToken: "watchdog-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 }
    },
    loadBizScript(modulePath) { return require("../" + modulePath); },
    logger: {
      info(message, details) { logs.push({ message, details }); },
      warn() {},
      error() {}
    },
    uploader: { ackCommand() {} },
    commandControl: { polling: true }
  };
  const handler = createPublishVideoHandler(context, {
    materialManager: {
      beginTask() { return { dir: "/sdcard/20260728", videoPath: "/video.mp4", coverPath: "/cover.jpg" }; },
      download(paths) { return { ...paths, videoBytes: 11, coverBytes: 7, totalBytes: 18, timeoutMs: 20000 }; },
      endTask() {}
    },
    publishLock: { acquire() { return true; }, release() {} },
    executionWatchdog: {
      start() { return { complete() {}, timedOut() { return false; } }; }
    },
    resultReporter: { report() { return { success: true }; } },
    gate: { waitForNext() { return { responseDelayMs: 10, actionWaitMs: 20 }; } },
    steps: {
      open() {}, select() {}, editCover() {}, fill() {}, publish() { return {}; },
      states: {
        galleryReady() { return true; }, coverEditReady() { return true; },
        publishFormReady() { return true; }, publishReviewReady() { return true; }
      }
    }
  });

  const result = handler.handle({
    id: "watchdog-command",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "watchdog-task",
      description: "发布 #一 #二",
      expectedTopicCount: 2,
      videoUrl: "http://host/video.mp4",
      coverUrl: "http://host/cover.jpg"
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  const messages = logs.map((item) => item.message);
  for (const message of [
    "发布执行器启动", "发布素材下载开始", "发布素材下载完成",
    "发布前准备打开App", "发布动作闸口开始", "发布动作闸口完成", "发布执行器结束"
  ]) assert(messages.includes(message), `missing log: ${message}`);
  assert.deepEqual(logs.find((item) => item.message === "发布素材下载完成").details, {
    taskId: "watchdog-task",
    videoBytes: 11,
    coverBytes: 7,
    totalBytes: 18
  });
});

test("发布入口看门狗超时复位轮询并只 ACK 一次 FAILED", () => {
  const acks = [];
  let reportCount = 0;
  const context = {
    config: {
      device: { deviceId: "watchdog-timeout-device", deviceToken: "watchdog-timeout-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 }
    },
    loadBizScript(modulePath) { return require("../" + modulePath); },
    logger: { info() {}, warn() {}, error() {} },
    uploader: {
      ackCommand(id, status, result) { acks.push({ id, status, result }); }
    },
    commandControl: { polling: true }
  };
  const handler = createPublishVideoHandler(context, {
    executionWatchdog: {
      start(onTimeout) {
        onTimeout();
        return { complete() {}, timedOut() { return true; } };
      }
    },
    publishLock: { acquire() { return true; }, release() {} },
    resultReporter: { report() { reportCount += 1; } }
  });

  const result = handler.handle({
    id: "watchdog-timeout-command",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: { taskId: "watchdog-timeout-task", description: "发布 #一", expectedTopicCount: 1 }
  });

  assert.equal(context.commandControl.polling, false);
  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "执行器看门狗超时");
  assert.equal(reportCount, 0);
  assert.deepEqual(acks, [{
    id: "watchdog-timeout-command",
    status: "FAILED",
    result: {
      applied: false,
      commandType: "PUBLISH_VIDEO_TASK",
      status: "FAILED",
      message: "执行器看门狗超时"
    }
  }]);
});
