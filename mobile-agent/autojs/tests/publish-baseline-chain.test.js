const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { createPublishVideoHandler } = require("../features/publish-video/publish-video-entry.js");
const { createWechatChannelsPublishHandler } = require("../features/publish-video/channels-publish-flow.js");

function createBaselineContext(loadedPaths, overlayPaths, modules) {
  return {
    forceBaselineBizScripts: true,
    config: {
      device: { deviceId: "baseline-device", deviceToken: "baseline-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      output: { baseDir: "/runtime", cacheDir: "/runtime/cache" }
    },
    logger: { info() {}, warn() {}, error() {} },
    uploader: { ackCommand() {} },
    loadBizScript(modulePath) {
      overlayPaths.push(modulePath);
      throw new Error("overlay loader must not be called: " + modulePath);
    },
    loadBaselineScript(modulePath) {
      loadedPaths.push(modulePath);
      if (!modules[modulePath]) throw new Error("missing baseline stub: " + modulePath);
      return modules[modulePath];
    }
  };
}

test("douyin publish chain uses only baseline modules", () => {
  const loadedPaths = [];
  const overlayPaths = [];
  const modules = {
    "domain/material-dir-manager.js": {
      createPublishMaterialManager() {
        return {
          beginTask() { return { dir: "/runtime/task" }; },
          download() { return { videoPath: "/runtime/task/video.mp4", coverPath: "/runtime/task/cover.jpg" }; },
          endTask() {}
        };
      }
    },
    "domain/publish-task-lock.js": {
      createPublishTaskLock() { return { acquire() { return true; }, release() {} }; }
    },
    "domain/publish-task-finalizer.js": require("../domain/publish-task-finalizer.js"),
    "domain/publish-watchdog.js": {
      createPublishExecutorWatchdog() {
        return { start() { return { timedOut() { return false; }, complete() {} }; } };
      }
    },
    "domain/topic-validator.js": { validateDescriptionTopics() { return { valid: true }; } },
    "domain/topic-resume.js": { createTopicContinuation() { return { waitForResolvedDescription() { return "#a #b #c #d #e"; } }; } },
    "domain/action-timing-gates.js": {
      createActionTimeGate() { return { waitForNext(name, check) { assert.equal(check(), true, name); return {}; } }; }
    },
    "domain/material-inspector.js": { chooseVideoMaterial() {} },
    "features/publish-video/douyin-publish-ui.js": {
      createDouyinPublishUi() {
        return {
          states: {
            galleryReady() { return true; },
            coverEditReady() { return true; },
            publishFormReady() { return true; },
            publishReviewReady() { return true; }
          }
        };
      }
    },
    "features/publish-video/open-douyin-camera.js": { createOpenDouyinCameraStep() { return function () {}; } },
    "features/publish-video/select-publish-material.js": { createSelectPublishMaterialStep() { return function () {}; } },
    "features/publish-video/edit-cover.js": { createEditCoverStep() { return function () {}; } },
    "features/publish-video/fill-publish-text.js": { createFillPublishTextStep() { return function () {}; } },
    "features/publish-video/execute-publish.js": {
      createExecutePublishStep() { return function () { return { platformContentId: "baseline-1" }; }; }
    },
    "features/publish-video/douyin-post-publish-cleanup.js": require("../features/publish-video/douyin-post-publish-cleanup.js")
  };
  const handler = createPublishVideoHandler(createBaselineContext(loadedPaths, overlayPaths, modules), {
    resultReporter: { report() { return { success: true }; } }
  });
  const result = handler.handle({
    id: "baseline-command",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: { taskId: "baseline-task", description: "#a #b #c #d #e", expectedTopicCount: 5 }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(overlayPaths, []);
  assert.deepEqual(new Set(loadedPaths), new Set(Object.keys(modules)));
});

test("cached publish handler handles a command without runtime module loads", () => {
  const loadedPaths = [];
  const overlayPaths = [];
  const modules = {
    "domain/material-dir-manager.js": {
      createPublishMaterialManager() {
        return {
          beginTask() { return { dir: "/runtime/task" }; },
          download() { return { videoPath: "/runtime/task/video.mp4", coverPath: "/runtime/task/cover.jpg" }; },
          endTask() {}
        };
      }
    },
    "domain/publish-task-lock.js": {
      createPublishTaskLock() { return { acquire() { return true; }, release() {} }; }
    },
    "domain/publish-task-finalizer.js": require("../domain/publish-task-finalizer.js"),
    "domain/publish-watchdog.js": {
      createPublishExecutorWatchdog() {
        return { start() { return { timedOut() { return false; }, complete() {} }; } };
      }
    },
    "domain/topic-validator.js": { validateDescriptionTopics() { return { valid: true }; } },
    "domain/topic-resume.js": { createTopicContinuation() { return { waitForResolvedDescription() { return "#a #b #c #d #e"; } }; } },
    "domain/action-timing-gates.js": {
      createActionTimeGate() { return { waitForNext(name, check) { assert.equal(check(), true, name); return {}; } }; }
    },
    "domain/material-inspector.js": { chooseVideoMaterial() {} },
    "features/publish-video/douyin-publish-ui.js": {
      createDouyinPublishUi() {
        return {
          states: {
            galleryReady() { return true; },
            coverEditReady() { return true; },
            publishFormReady() { return true; },
            publishReviewReady() { return true; }
          }
        };
      }
    },
    "features/publish-video/open-douyin-camera.js": { createOpenDouyinCameraStep() { return function () {}; } },
    "features/publish-video/select-publish-material.js": { createSelectPublishMaterialStep() { return function () {}; } },
    "features/publish-video/edit-cover.js": { createEditCoverStep() { return function () {}; } },
    "features/publish-video/fill-publish-text.js": { createFillPublishTextStep() { return function () {}; } },
    "features/publish-video/execute-publish.js": {
      createExecutePublishStep() { return function () { return { platformContentId: "cached-1" }; }; }
    },
    "features/publish-video/douyin-post-publish-cleanup.js": require("../features/publish-video/douyin-post-publish-cleanup.js")
  };
  const context = createBaselineContext(loadedPaths, overlayPaths, modules);
  context.publishModuleCache = modules;
  context.allowPublishModuleLoad = false;
  const handler = createPublishVideoHandler(context, {
    resultReporter: { report() { return { success: true }; } }
  });

  const result = handler.handle({
    id: "cached-command",
    commandType: "PUBLISH_VIDEO_TASK",
    payload: { taskId: "cached-task", description: "#a #b #c #d #e", expectedTopicCount: 5 }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(loadedPaths, []);
  assert.deepEqual(overlayPaths, []);
});

test("wechat publish dependencies use only baseline modules", () => {
  const loadedPaths = [];
  const overlayPaths = [];
  const modules = {
    "domain/material-inspector.js": {},
    "domain/topic-validator.js": {},
    "features/publish-video/channels-verify-popup.js": {},
    "features/publish-video/channels-publish-ui.js": { createWechatChannelsPublishUi() { return {}; } }
  };

  createWechatChannelsPublishHandler(createBaselineContext(loadedPaths, overlayPaths, modules), {
    materialDownloader: {},
    resultReporter: {},
    topicContinuation: {}
  });

  assert.deepEqual(overlayPaths, []);
  assert.deepEqual(new Set(loadedPaths), new Set(Object.keys(modules)));
});

test("publish handler cache miss never falls back to a runtime loader", () => {
  let loaderCalls = 0;
  const context = {
    publishModuleCache: {},
    allowPublishModuleLoad: false,
    config: {
      device: { deviceId: "cache-device", deviceToken: "cache-token" },
      upload: { baseUrl: "http://localhost:3012", timeoutMs: 5000 },
      output: { baseDir: "/runtime", cacheDir: "/runtime/cache" }
    },
    logger: { info() {}, warn() {}, error() {} },
    uploader: { ackCommand() {} },
    loadBaselineScript() {
      loaderCalls += 1;
      throw new Error("runtime loader must not be called");
    }
  };

  assert.throws(
    () => createPublishVideoHandler(context),
    /publish module cache miss: domain\/material-dir-manager\.js/
  );
  assert.equal(loaderCalls, 0);
});

test("module loaders emit start finish and elapsed logs", () => {
  const source = fs.readFileSync(path.join(__dirname, "../main.module.js"), "utf8");

  assert.match(source, /biz_module_load_start/);
  assert.match(source, /biz_module_load_finish/);
  assert.match(source, /loadBizScript/);
  assert.match(source, /loadBaselineScript/);
  assert.match(source, /elapsedMs/);
});

console.log("publish baseline chain tests passed");
