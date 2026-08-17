// 原中文名：视频号发布全流程.js；职责：编排视频号发布流程。
function loadBizModule(context, path) {
  var moduleCache = context.publishModuleCache;
  if (moduleCache && Object.prototype.hasOwnProperty.call(moduleCache, path)) {
    return moduleCache[path];
  }
  if (context.allowPublishModuleLoad === false) {
    throw new Error("publish module cache miss: " + path);
  }
  var loadedModule;
  if (context.forceBaselineBizScripts && context.loadBaselineScript) {
    loadedModule = context.loadBaselineScript(path);
  } else if (context.loadBizScript) {
    loadedModule = context.loadBizScript(path);
  } else if (context.loadBaselineScript) {
    loadedModule = context.loadBaselineScript(path);
  } else {
    loadedModule = require(files.join(context.config.runtime.scriptDir, path));
  }
  if (moduleCache) moduleCache[path] = loadedModule;
  return loadedModule;
}

function decideWechatStartupCorrection(state) {
  state = state || {};
  if (!state.foreground) return { action: "LAUNCH", reason: "wechat_not_foreground" };
  if (String(state.bottomTab || "") === "信息") {
    return { action: "KEEP", reason: "information_tab_ready" };
  }
  return { action: "FORCE_RESTART", reason: "information_tab_not_selected" };
}

function dismissKnownWechatInvite(ui) {
  if (ui && typeof ui.dismissVersionUpdateInvite === "function") ui.dismissVersionUpdateInvite();
}

function correctWechatStartup(ui) {
  dismissKnownWechatInvite(ui);
  var state = ui.inspectStartupState();
  var decision = decideWechatStartupCorrection(state);
  if (decision.action === "LAUNCH") {
    ui.launchWechat();
    dismissKnownWechatInvite(ui);
    state = ui.inspectStartupState();
    decision = decideWechatStartupCorrection(state);
  }
  if (decision.action === "FORCE_RESTART") {
    ui.forceRestartWechat();
    dismissKnownWechatInvite(ui);
    state = ui.inspectStartupState();
    decision = decideWechatStartupCorrection(state);
  }
  if (decision.action !== "KEEP" && state.foreground && typeof ui.selectWechatHomeTab === "function") {
    ui.selectWechatHomeTab();
    state = ui.inspectStartupState();
    if (state.foreground) {
      return {
        corrected: true,
        state: { foreground: true, bottomTab: "信息", inferred: true },
        decision: { action: "KEEP", reason: "home_tab_forced_after_restart" }
      };
    }
    decision = decideWechatStartupCorrection(state);
  }
  if (decision.action !== "KEEP") {
    throw new Error("微信启动校正失败：底栏未处于信息");
  }
  return { corrected: true, state: state, decision: decision };
}

function materialError(message) {
  var error = new Error(message);
  error.publishStatus = "MATERIAL_INVALID";
  return error;
}

function createWechatChannelsPublishHandler(context, dependencies) {
  dependencies = dependencies || {};
  var logger = context.logger;
  var uploader = context.uploader;
  var materialDomain = loadBizModule(context, "domain/material-inspector.js");
  var popupMarker = loadBizModule(context, "features/publish-video/channels-verify-popup.js");
  var ui = dependencies.ui || loadBizModule(context, "features/publish-video/channels-publish-ui.js")
    .createWechatChannelsPublishUi(context);

  var materialDownloader = dependencies.materialDownloader;
  var resultReporter = dependencies.resultReporter;
  var currentTaskId = "";
  if (!materialDownloader || !resultReporter) {
    throw new Error("视频号发布必须由共享发布入口创建");
  }

  function gateFor(payload) {
    if (dependencies.gate) return dependencies.gate;
    return loadBizModule(context, "domain/action-timing-gates.js").createActionTimeGate({
      responseDelayMsMin: payload.responseDelayMsMin,
      responseDelayMsMax: payload.responseDelayMsMax,
      actionWaitMsMin: payload.actionWaitMsMin,
      actionWaitMsMax: payload.actionWaitMsMax,
      targetStateTimeoutMs: 45000,
      pollIntervalMs: 500
    });
  }

  function assertNoVerification(stage) {
    var marked = popupMarker.markChannelsVerificationPopup(ui.snapshot(), stage);
    if (marked.detected) throw popupMarker.createChannelsVerificationError(marked);
  }

  function waitForNext(gate, actionName, stateCheck) {
    logger.info("发布动作闸口开始", { taskId: currentTaskId, action: actionName, platform: "WECHAT_CHANNELS" });
    var result = gate.waitForNext(actionName, function () {
      assertNoVerification(actionName);
      return stateCheck();
    });
    logger.info("发布动作闸口完成", {
      taskId: currentTaskId,
      action: actionName,
      platform: "WECHAT_CHANNELS",
      responseDelayMs: Number(result && result.responseDelayMs || 0),
      actionWaitMs: Number(result && result.actionWaitMs || 0)
    });
    return result;
  }

  function performAction(stage, action) {
    dismissKnownWechatInvite(ui);
    assertNoVerification(stage + "前");
    var result = action();
    dismissKnownWechatInvite(ui);
    assertNoVerification(stage + "后");
    return result;
  }

  function performActionThenWait(gate, stage, action, stateCheck) {
    performAction(stage, action);
    return waitForNext(gate, stage, stateCheck);
  }

  function fillDescription(payload) {
    performAction("填写描述", function () { ui.fillDescription(payload.description); });
  }

  function finish(command, payload, status, errorMessage, publishResult, popupFeature) {
    logger.info("发布执行器结束", {
      commandId: command.id || "",
      taskId: payload.taskId || "",
      platform: "WECHAT_CHANNELS",
      status: status,
      error: errorMessage || ""
    });
    var report = {
      deviceId: context.config.device.deviceId || "",
      deviceToken: context.config.device.deviceToken || "",
      status: status
    };
    if (errorMessage) report.error = errorMessage;
    if (publishResult && publishResult.publishedUrl) report.publishedUrl = publishResult.publishedUrl;
    if (publishResult && publishResult.platformContentId) report.platformContentId = publishResult.platformContentId;
    try {
      resultReporter.report(payload.taskId, report);
    } catch (reportError) {
      var reportFailure = "视频号发布结果回传失败：" + String(reportError);
      logger.warn(reportFailure, { taskId: payload.taskId, status: status });
      uploader.ackCommand(command.id, "FAILED", {
        applied: false,
        commandType: "PUBLISH_VIDEO_TASK",
        platform: "WECHAT_CHANNELS",
        status: status,
        message: reportFailure,
        popupFeature: popupFeature || null
      });
      return { status: status, error: errorMessage || "", reportFailed: true, reportError: reportFailure };
    }
    var ackStatus = status === "SUCCEEDED" || status === "CHANNELS_VERIFY_PENDING" ? "DONE" : "FAILED";
    uploader.ackCommand(command.id, ackStatus, {
      applied: status === "SUCCEEDED",
      commandType: "PUBLISH_VIDEO_TASK",
      platform: "WECHAT_CHANNELS",
      status: status,
      message: errorMessage || "",
      popupFeature: popupFeature || null,
      publishedUrl: report.publishedUrl || "",
      platformContentId: report.platformContentId || ""
    });
    return {
      status: status,
      error: errorMessage || "",
      popupFeature: popupFeature || null,
      publishedUrl: report.publishedUrl || "",
      platformContentId: report.platformContentId || ""
    };
  }

  function handle(command) {
    if (!command || command.commandType !== "PUBLISH_VIDEO_TASK") return { handled: false };
    var payload = command.payload || command.payloadJson || {};
    currentTaskId = payload.taskId || "";
    if (!payload.taskId) return finish(command, payload, "MATERIAL_INVALID", "taskId不能为空", null, null);
    var materials;
    try {
      materials = materialDownloader.download(payload);
    } catch (downloadError) {
      return finish(
        command,
        payload,
        "MATERIAL_INVALID",
        String(downloadError && downloadError.message || downloadError || "素材下载失败"),
        null,
        null
      );
    }

    try {
      var gate = gateFor(payload);
      logger.info("发布前准备打开App", { taskId: payload.taskId, platform: "WECHAT_CHANNELS" });
      correctWechatStartup(ui);
      assertNoVerification("启动校正");
      performActionThenWait(gate, "进入发现", function () { ui.openDiscover(); }, ui.states.discoverReady);
      performActionThenWait(gate, "进入视频号", function () { ui.openChannels(); }, ui.states.channelsReady);
      performActionThenWait(gate, "打开我的", function () { ui.openMine(); }, ui.states.mineReady);
      performActionThenWait(gate, "打开发表视频", function () { ui.openPublishVideo(); }, ui.states.publishMenuReady);
      performActionThenWait(gate, "打开相册", function () { ui.openAlbum(); }, ui.states.galleryReady);
      var materialDecision = materialDomain.chooseVideoMaterial(ui.readFirstGalleryItems());
      if (!materialDecision.valid) throw materialError(materialDecision.reason || "素材未正确上传");
      performActionThenWait(gate, "选择发布素材", function () { ui.clickGalleryItem(materialDecision.index); }, ui.states.nextReady);
      performActionThenWait(gate, "素材下一步", function () { ui.clickNext(); }, ui.states.titleReady);
      performActionThenWait(gate, "打开标题输入", function () { ui.addTitle(); }, ui.states.titleInputReady);
      performAction("输入标题", function () { ui.inputTitle(payload.title); });
      performAction("标题对勾", function () { ui.confirmTitle(); });
      performAction("点击标题框外", function () { ui.tapOutsideTitle(); });
      performActionThenWait(gate, "完成标题", function () { ui.completeTitle(); }, ui.states.exportStarted);
      waitForNext(gate, "等待导出完成", ui.states.exportComplete);
      performActionThenWait(gate, "打开封面设置", function () { ui.openCoverSettings(); }, ui.states.coverSourceReady);
      performActionThenWait(gate, "从相册选择封面", function () { ui.chooseCoverFromAlbum(); }, ui.states.coverGalleryReady);
      performAction("选择封面素材", function () { ui.clickCoverGalleryItem(0); });
      performActionThenWait(gate, "完成封面选择", function () { ui.completeCoverSelection(); }, ui.states.coverSourceReady);
      performActionThenWait(gate, "完成封面设置", function () { ui.completeCoverSettings(); }, ui.states.descriptionReady);
      fillDescription(payload);
      performAction("发表视频", function () { ui.publish(); });
      var outcome = ui.waitForPublishOutcome(60000, function () { assertNoVerification("发表结果等待"); });
      if (!outcome || !outcome.success) throw new Error(outcome && outcome.reason || "视频号发表结果判定失败");
      var publishResult = ui.readPublishedResult() || {};
      logger.info("视频号发布任务执行成功", { taskId: payload.taskId });
      return finish(command, payload, "SUCCEEDED", "", publishResult, null);
    } catch (error) {
      var status = error && error.publishStatus || "FAILED";
      var reason = String(error && error.message || error || "视频号发布步骤失败");
      logger.warn("视频号发布任务执行失败", { taskId: payload.taskId, status: status, reason: reason });
      return finish(command, payload, status, reason, null, error && error.popupFeature || null);
    }
  }

  return { handle: handle };
}

module.exports = {
  correctWechatStartup: correctWechatStartup,
  createWechatChannelsPublishHandler: createWechatChannelsPublishHandler,
  decideWechatStartupCorrection: decideWechatStartupCorrection
};
