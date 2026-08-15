const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishVideoPreloader } = require("../app/publish-video-preloader.js");

const modulePaths = [
  "features/publish-video/publish-video-entry.js",
  "domain/material-dir-manager.js",
  "domain/publish-task-lock.js",
  "domain/action-timing-gates.js",
  "domain/material-inspector.js",
  "domain/topic-validator.js",
  "domain/topic-resume.js",
  "domain/publish-watchdog.js",
  "features/publish-video/open-douyin-camera.js",
  "features/publish-video/select-publish-material.js",
  "features/publish-video/edit-cover.js",
  "features/publish-video/fill-publish-text.js",
  "features/publish-video/execute-publish.js",
  "features/publish-video/douyin-publish-ui.js",
  "features/publish-video/channels-publish-ui.js",
  "features/publish-video/channels-verify-popup.js",
  "features/publish-video/channels-publish-flow.js"
];

test("发布预加载使用热更新模块且执行时不回退到基线", () => {
  const overlayPaths = [];
  const baselinePaths = [];
  let executionContext;
  const modules = {};
  for (const modulePath of modulePaths) modules[modulePath] = {};
  modules["features/publish-video/publish-video-entry.js"] = {
    createPublishVideoHandler(context) {
      executionContext = context;
      return { handle() {} };
    }
  };

  const loadBizScript = (modulePath) => {
    overlayPaths.push(modulePath);
    return modules[modulePath];
  };
  const preloader = createPublishVideoPreloader({
    logger: { info() {}, error() {} },
    loadBizScript,
    loadBaselineScript(modulePath) {
      baselinePaths.push(modulePath);
      throw new Error("preloader must not use baseline: " + modulePath);
    }
  });

  assert.deepEqual(preloader.preload(), { ready: true, cached: false, moduleCount: modulePaths.length });
  assert.deepEqual(overlayPaths, modulePaths);
  assert.deepEqual(baselinePaths, []);
  assert.equal(executionContext.forceBaselineBizScripts, false);
  assert.equal(executionContext.loadBizScript, loadBizScript);
});
