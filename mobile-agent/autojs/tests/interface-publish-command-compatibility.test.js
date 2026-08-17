const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/publish-video-entry.js");

function harness(runPublish) {
  const reports = [];
  const acknowledgements = [];
  const events = [];
  const context = {
    config: {
      device: { deviceId: "interface-device", deviceToken: "interface-device-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      publish: { useFixedWaitPublishFlow: true }
    },
    logger: { info() {}, warn() {}, error() {} },
    uploader: {
      ackCommand(id, status, result) {
        acknowledgements.push({ id, status, result });
        events.push("ack:" + status);
      }
    },
    loadBizScript(modulePath) { return require("../" + modulePath); }
  };
  const handler = createPublishVideoHandler(context, {
    fixedWaitFlow: { run: runPublish },
    steps: {},
    materialManager: {
      beginTask() { return { dir: "/interface/task" }; },
      download() {
        events.push("download");
        return { videoPath: "/interface/task/video.mp4", coverPath: "/interface/task/cover.jpg" };
      },
      endTask() { events.push("cleanup-material"); }
    },
    publishLock: {
      acquire() { events.push("lock"); return true; },
      release() { events.push("unlock"); }
    },
    executionWatchdog: {
      start() { return { complete() { events.push("watchdog-complete"); }, timedOut() { return false; } }; }
    },
    resultReporter: {
      report(taskId, result) {
        reports.push({ taskId, result });
        events.push("report:" + result.status);
      }
    },
    postPublishCleanup: {
      run(_payload, lifecycle) {
        lifecycle.beforeReturnToAgent();
        events.push("return-agent");
        return { completed: true };
      }
    }
  });
  return { handler, reports, acknowledgements, events };
}

function interfaceCommand(id) {
  return {
    id,
    commandType: "PUBLISH_VIDEO_TASK",
    payload: {
      taskId: "interface-publish-task",
      interfaceRunId: "run-1",
      slotExecutionId: "slot-1",
      externalTaskId: "external-1",
      platform: "DOUYIN",
      title: "接口素材",
      description: "#接口发布",
      expectedTopicCount: 1,
      videoUrl: "https://media.example.test/video.mp4",
      coverUrl: "https://media.example.test/cover.jpg",
      useFixedWaitPublishFlow: true
    }
  };
}

test("接口任务复用成熟 PUBLISH_VIDEO_TASK 并在返回 Agent 前完成结果收口", () => {
  const state = harness(() => {
    state.events.push("publish-action");
    return {
      publishedUrl: "https://douyin.example.test/video/interface-1",
      platformContentId: "douyin-interface-1"
    };
  });

  const result = state.handler.handle(interfaceCommand("command-interface-success"));

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(state.reports, [{
    taskId: "interface-publish-task",
    result: {
      deviceId: "interface-device",
      deviceToken: "interface-device-token",
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/video/interface-1",
      platformContentId: "douyin-interface-1"
    }
  }]);
  assert.equal(state.acknowledgements.length, 1);
  assert.equal(state.acknowledgements[0].status, "DONE");
  assert(state.events.indexOf("report:SUCCEEDED") < state.events.indexOf("ack:DONE"));
  assert(state.events.indexOf("ack:DONE") < state.events.indexOf("return-agent"));
});

test("动作副作用后结果不明继续回报 RESULT_UNKNOWN 且不伪装为失败重试", () => {
  const state = harness(() => {
    const error = new Error("发布按钮点击后页面无明确结果");
    error.publishStatus = "RESULT_UNKNOWN";
    throw error;
  });

  const result = state.handler.handle(interfaceCommand("command-interface-unknown"));

  assert.equal(result.status, "RESULT_UNKNOWN");
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].result.status, "RESULT_UNKNOWN");
  assert.equal(state.acknowledgements.length, 1);
  assert.equal(state.acknowledgements[0].status, "FAILED");
  assert(!state.events.includes("return-agent"));
});

test("手机端只向项目后端结果路由回报，不包含外部领取或 PATCH 地址", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../features/publish-video/publish-video-entry.js"),
    "utf8"
  );
  assert(source.includes('"/mobile/publish-tasks/"'));
  assert(!source.includes("/api/v1/external/publish-tasks"));
  assert(!source.includes("wecom.dafengchan.top"));
});
