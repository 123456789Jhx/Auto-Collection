const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/publish-video-entry.js");

function createContext(events, errors) {
  return {
    config: { device: { deviceId: "device-mvp", deviceToken: "token-mvp" }, upload: {} },
    loadBizScript(modulePath) { return require("../" + modulePath); },
    logger: {
      info(message, detail) { events.push("log:" + message + ":" + (detail.step || "")); },
      warn(message, detail) { events.push("warn:" + message + ":" + (detail.step || "")); },
      error(message, detail) { errors.push({ message, detail }); }
    },
    uploader: { ackCommand(id, status) { events.push("ack:" + status); } }
  };
}

function createDependencies(events, waits, errors) {
  return {
    materialDownloader: { download() { events.push("download"); return { videoPath: "/tmp/video.mp4", coverPath: "/tmp/cover.jpg" }; } },
    materialDomain: { chooseVideoMaterial() { return { valid: true, index: 1 }; } },
    topicDomain: { validateDescriptionTopics() { return { valid: true }; } },
    topicContinuation: { waitForResolvedDescription() { throw new Error("topic continuation should not run"); } },
    resultReporter: { report(taskId, result) { events.push("report:" + result.status); } },
    publishLock: { acquire() { events.push("lock"); return true; }, release() { events.push("unlock"); } },
    executionWatchdog: { start() { return { timedOut() { return false; }, complete() {} }; } },
    gate: { waitForNext() { throw new Error("gate should not run in fixed wait MVP"); } },
    mvpWait(waitMs) { waits.push(waitMs); },
    postPublishCleanup: { run() { events.push("post_publish_cleanup"); return { completed: true }; } },
    steps: {
      ui: {
        openApp() { events.push("open_app"); },
        clickPublishEntry() { events.push("click_publish_entry"); return true; },
        openAlbum() { events.push("open_album"); },
        readFirstGalleryItems() { events.push("read_gallery"); return [{ durationText: "" }, { durationText: "00:10" }]; },
        clickGalleryItem(index) { events.push("select_video:" + index); },
        clickNext() { events.push("click_next"); return true; },
        publish() { events.push("click_publish"); return true; },
        waitForPublishSuccess() { events.push("wait_publish_success"); return true; },
        readPublishedResult() { events.push("read_result"); return { publishedUrl: "https://douyin.test/video/mvp", platformContentId: "mvp-1" }; }
      },
      fill() { events.push("fill_publish_text"); return true; },
      open() { events.push("formal_open"); },
      select() { events.push("formal_select"); },
      editCover() { events.push("formal_cover"); },
      publish() { events.push("formal_publish"); return {}; },
      states: { galleryReady() { return true; }, coverEditReady() { return true; }, publishFormReady() { return true; }, publishReviewReady() { return true; } }
    }
  };
}

function command(payload) {
  return { id: "command-mvp", commandType: "PUBLISH_VIDEO_TASK", payload: Object.assign({ taskId: "task-mvp", title: "MVP", description: "#话题", expectedTopicCount: 1 }, payload) };
}

test("fixed_wait_mvp 按固定等待动作链执行且不触发闸口", () => {
  const events = [];
  const waits = [];
  const errors = [];
  const handler = createPublishVideoHandler(createContext(events, errors), createDependencies(events, waits, errors));

  const result = handler.handle(command({ publishFlowMode: "fixed_wait_mvp" }));

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(waits, [15000, 15000, 15000, 15000, 15000, 15000, 15000]);
  assert.deepEqual(events.filter((event) => !event.startsWith("log:")), ["lock", "download", "open_app", "click_publish_entry", "open_album", "read_gallery", "select_video:1", "click_next", "fill_publish_text", "click_publish", "wait_publish_success", "read_result", "post_publish_cleanup", "report:SUCCEEDED", "ack:DONE", "unlock"]);
  assert.equal(events.some((event) => event.startsWith("log:[MVP] 封面设置暂跳过:skip_cover")), true);
  assert.equal(errors.length, 0);
});

test("fixed_wait_mvp 支持覆盖等待时间并记录失败步骤", () => {
  const events = [];
  const waits = [];
  const errors = [];
  const dependencies = createDependencies(events, waits, errors);
  dependencies.steps.ui.clickPublishEntry = function () { throw new Error("entry missing"); };
  const handler = createPublishVideoHandler(createContext(events, errors), dependencies);

  const result = handler.handle(command({ useFixedWaitPublishFlow: true, mvpActionWaitMs: 321 }));

  assert.equal(result.status, "FAILED");
  assert.deepEqual(waits, [321]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "[MVP] step error");
  assert.equal(errors[0].detail.step, "click_publish_entry");
  assert.match(result.error, /entry missing/);
});

test("配置开关可启用 fixed_wait_mvp", () => {
  const events = [];
  const waits = [];
  const errors = [];
  const context = createContext(events, errors);
  context.config.publishFlowMode = "fixed_wait_mvp";
  const handler = createPublishVideoHandler(context, createDependencies(events, waits, errors));

  const result = handler.handle(command({ mvpActionWaitMs: 0 }));

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(events.includes("open_app"), true);
  assert.deepEqual(waits, [0, 0, 0, 0, 0, 0, 0]);
});
