function createPublishVideoPreloader(context) {
  var modulePaths = [
    "features/publish-video/publish-video-entry.js",
    "domain/material-dir-manager.js",
    "domain/publish-task-lock.js",
    "domain/publish-task-finalizer.js",
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
    "features/publish-video/douyin-post-publish-cleanup.js",
    "features/publish-video/douyin-publish-ui.js",
    "features/publish-video/channels-publish-ui.js",
    "features/publish-video/channels-verify-popup.js",
    "features/publish-video/channels-publish-flow.js"
  ];
  var logger = context.logger;
  var moduleCache = context.publishModuleCache || {};
  var publishVideoHandler = null;
  context.publishModuleCache = moduleCache;

  function hasCachedModule(modulePath) {
    return Object.prototype.hasOwnProperty.call(moduleCache, modulePath);
  }

  function loadModule(modulePath) {
    if (hasCachedModule(modulePath)) {
      return moduleCache[modulePath];
    }
    if (context.loadBizScript) {
      moduleCache[modulePath] = context.loadBizScript(modulePath);
      return moduleCache[modulePath];
    }
    if (context.loadBaselineScript) {
      moduleCache[modulePath] = context.loadBaselineScript(modulePath);
      return moduleCache[modulePath];
    }
    moduleCache[modulePath] = require("../" + modulePath);
    return moduleCache[modulePath];
  }

  function preloadSource() {
    if (context.loadBizScript) return "biz-scripts";
    if (context.loadBaselineScript) return "baseline";
    return "local";
  }

  function createExecutionContext() {
    var publishContext = {};
    Object.keys(context).forEach(function (key) {
      publishContext[key] = context[key];
    });
    publishContext.forceBaselineBizScripts = false;
    publishContext.publishModuleCache = moduleCache;
    publishContext.allowPublishModuleLoad = true;
    return publishContext;
  }

  function preload() {
    if (publishVideoHandler) {
      return { ready: true, cached: true, moduleCount: modulePaths.length };
    }
    var startedAt = Date.now();
    var publishContext = createExecutionContext();
    for (var index = 0; index < modulePaths.length; index += 1) {
      var modulePath = modulePaths[index];
      var moduleStartedAt = Date.now();
      var source = preloadSource();
      logger.info("publish module preload start", { modulePath: modulePath, source: source });
      try {
        loadModule(modulePath);
        logger.info("publish module preload finish", {
          modulePath: modulePath,
          source: source,
          elapsedMs: Date.now() - moduleStartedAt,
          success: true
        });
      } catch (error) {
        logger.error("publish module preload finish", {
          modulePath: modulePath,
          elapsedMs: Date.now() - moduleStartedAt,
          success: false,
          message: String(error)
        });
        throw error;
      }
    }
    publishVideoHandler = moduleCache["features/publish-video/publish-video-entry.js"]
      .createPublishVideoHandler(publishContext);
    publishContext.allowPublishModuleLoad = false;
    logger.info("publish module preload ready", {
      moduleCount: modulePaths.length,
      elapsedMs: Date.now() - startedAt
    });
    return { ready: true, cached: false, moduleCount: modulePaths.length };
  }

  function getHandler() {
    return publishVideoHandler;
  }

  return {
    preload: preload,
    getHandler: getHandler
  };
}

module.exports = {
  createPublishVideoPreloader: createPublishVideoPreloader
};
