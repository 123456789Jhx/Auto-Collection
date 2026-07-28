const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/发布视频-入口.js");

function context(events) {
  return {
    config: {
      device: { deviceId: "n5b-device", deviceToken: "n5b-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 }
    },
    loadBizScript(path) { return require("../" + path); },
    logger: { info() {}, warn() {} },
    uploader: {
      ackCommand(_id, status) { events.push("ack:" + status); }
    }
  };
}

function steps(events, fill) {
  return {
    open() { events.push("open"); },
    select() {},
    editCover() {},
    fill,
    publish() { events.push("publish"); return {}; },
    states: {
      galleryReady() { return true; },
      coverEditReady() { return true; },
      publishFormReady() { return true; },
      publishReviewReady() { return true; }
    }
  };
}

function validPayload(taskId) {
  return {
    taskId,
    title: "春耕",
    description: "发布 #春耕 #农技",
    expectedTopicCount: 2,
    videoUrl: "https://example.test/video.mp4"
  };
}

test("流程中话题待补时轮询修正描述并在当前流程继续发布", () => {
  const events = [];
  const reports = [];
  let fillCount = 0;
  const handler = createPublishVideoHandler(context(events), {
    materialDownloader: { download() { return { videoPath: "/video.mp4", coverPath: "" }; } },
    resultReporter: {
      report(_taskId, result) { reports.push(result); return { success: true }; }
    },
    gate: { waitForNext(_name, predicate) { assert.equal(predicate(), true); } },
    steps: steps(events, (payload) => {
      fillCount += 1;
      events.push("fill:" + payload.description);
      if (fillCount === 1) {
        const error = new Error("界面未选中话题：农技");
        error.publishStatus = "TOPIC_PENDING";
        throw error;
      }
    }),
    topicContinuation: {
      waitForResolvedDescription() { events.push("poll"); return "修正 #春耕 #农技"; }
    }
  });

  const result = handler.handle({
    id: "n5b-command-resolved",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: validPayload("n5b-task-resolved")
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(reports.map((item) => item.status), ["TOPIC_PENDING", "SUCCEEDED"]);
  assert.equal(events.includes("fill:修正 #春耕 #农技"), true);
  assert.equal(events.includes("publish"), true);
});

test("收到命令时话题预检失败不下载不开 app 并释放锁", () => {
  const events = [];
  const handler = createPublishVideoHandler(context(events), {
    publishLock: {
      acquire() { events.push("acquire"); return true; },
      release() { events.push("release"); }
    },
    materialDownloader: { download() { events.push("download"); return {}; } },
    resultReporter: { report() { events.push("report"); return { success: true }; } },
    steps: steps(events, () => {})
  });
  const payload = validPayload("n5b-task-precheck");
  payload.description = "只有 #一 #二 #三 #四";
  payload.expectedTopicCount = 5;

  const result = handler.handle({
    id: "n5b-command-precheck",
    commandType: "PUBLISH_VIDEO_TASK",
    payload
  });

  assert.equal(result.status, "TOPIC_PENDING");
  assert.equal(result.error, "应有5个#，实际4个");
  assert.deepEqual(events, ["acquire", "report", "ack:DONE", "release"]);
});

test("流程中话题补全超时按失败上报并清理素材释放锁", () => {
  const events = [];
  const handler = createPublishVideoHandler(context(events), {
    materialManager: {
      beginTask() { return { dir: "/topic", videoPath: "/topic/video.mp4", coverPath: "" }; },
      download(paths) { return paths; },
      endTask() { events.push("cleanup"); }
    },
    publishLock: {
      acquire() { return true; },
      release() { events.push("release"); }
    },
    resultReporter: { report(_id, result) { events.push("report:" + result.status); return {}; } },
    gate: { waitForNext(_name, predicate) { assert.equal(predicate(), true); } },
    steps: steps(events, () => {
      const error = new Error("界面未选中话题");
      error.publishStatus = "TOPIC_PENDING";
      throw error;
    }),
    topicContinuation: { waitForResolvedDescription() { throw new Error("话题补全超时"); } }
  });

  const result = handler.handle({
    id: "n5b-command-timeout",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: validPayload("n5b-task-timeout")
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "话题补全超时");
  assert.deepEqual(events.slice(-2), ["cleanup", "release"]);
  assert.equal(events.includes("report:TOPIC_PENDING"), true);
  assert.equal(events.includes("report:FAILED"), true);
});
