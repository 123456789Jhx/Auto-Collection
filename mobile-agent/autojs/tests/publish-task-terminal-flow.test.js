const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/publish-video-entry.js");

test("抖音成功任务在点击返回 Agent 前完成终态上报和资源释放", () => {
  const events = [];
  const context = {
    config: {
      device: { deviceId: "device-terminal", deviceToken: "token-terminal" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      publish: { useFixedWaitPublishFlow: true }
    },
    logger: { info() {}, warn() {}, error() {} },
    uploader: { ackCommand(id, status) { events.push("ack:" + status); } },
    loadBizScript(modulePath) { return require("../" + modulePath); }
  };
  const handler = createPublishVideoHandler(context, {
    fixedWaitFlow: {
      run() {
        events.push("publish_success");
        return { platformContentId: "douyin-terminal" };
      }
    },
    materialManager: {
      beginTask() { events.push("begin"); return { dir: "/task", videoPath: "/task/video.mp4", coverPath: "/task/cover.jpg" }; },
      download(paths) { events.push("download"); return paths; },
      endTask() { events.push("cleanup_material"); }
    },
    publishLock: {
      acquire(meta) { events.push("acquire:" + meta.taskId); return true; },
      release() { events.push("release_lock"); return true; }
    },
    executionWatchdog: {
      start() {
        return {
          complete() { events.push("complete_watchdog"); },
          timedOut() { return false; }
        };
      }
    },
    resultReporter: { report(id, result) { events.push("report:" + result.status); } },
    postPublishCleanup: {
      run(payload, lifecycle) {
        events.push("cleanup_douyin");
        lifecycle.beforeReturnToAgent();
        events.push("open_agent");
        return { completed: true };
      }
    }
  });

  const result = handler.handle({
    id: "command-terminal",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "task-terminal",
      title: "终态测试",
      description: "#测试",
      expectedTopicCount: 1,
      videoUrl: "https://example.test/video.mp4",
      coverUrl: "https://example.test/cover.jpg",
      useFixedWaitPublishFlow: true
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(events, [
    "acquire:task-terminal",
    "begin",
    "download",
    "publish_success",
    "cleanup_douyin",
    "report:SUCCEEDED",
    "ack:DONE",
    "cleanup_material",
    "release_lock",
    "complete_watchdog",
    "open_agent"
  ]);
});
