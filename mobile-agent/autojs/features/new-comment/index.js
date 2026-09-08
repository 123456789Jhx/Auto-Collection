"use strict";

var runtimeModule = require("./runtime.js");
var workflowModule = require("./workflow.js");
var cleanupModule = require("../publish-video/douyin-post-publish-cleanup.js");

function assign(target, source) {
  Object.keys(source || {}).forEach(function (key) { target[key] = source[key]; });
  return target;
}

function createIsolatedLiveCommentEntryTask(context, options) {
  context = context || {};
  options = options || {};
  var createRuntime = options.createRuntime || runtimeModule.createIsolatedRuntime;
  var createWorkflow = options.createWorkflow || workflowModule.createIsolatedLiveCommentWorkflow;
  var finalCleanup = options.finalCleanup || options.cleanup ||
    cleanupModule.createDouyinPostPublishCleanup({
      logger: options.logger || context.logger,
      cooldownMs: 0,
      isPublishing: function () { return false; }
    });

  function run(payload, control) {
    control = control || {};
    var runtimeOptions = assign(assign({}, options.runtimeOptions || options), { control: control });
    var runtime = createRuntime(context, runtimeOptions);
    var workflowOptions = assign({}, options.workflowOptions || {});
    ["commentRunner", "commentRunnerModule", "commentCapture", "reportStage", "deviceId"].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(options, key)) workflowOptions[key] = options[key];
    });
    workflowOptions.logger = options.logger || context.logger || {};
    workflowOptions.context = context;
    workflowOptions.runtime = runtime;
    workflowOptions.finalCleanup = finalCleanup;
    workflowOptions.continueAfterCapture = true;
    return createWorkflow(workflowOptions).run(payload || {}, control);
  }

  return { run: run, cleanup: finalCleanup };
}

module.exports = { createIsolatedLiveCommentEntryTask: createIsolatedLiveCommentEntryTask };
