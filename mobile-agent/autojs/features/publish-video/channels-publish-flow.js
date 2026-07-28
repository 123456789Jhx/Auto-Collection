// 原中文名：视频号发布全流程.js；职责：编排视频号发布流程。
function loadBizModule(context, path) {
  if (context.forceBaselineBizScripts && context.loadBaselineScript) {
    return context.loadBaselineScript(path);
  }
  if (context.loadBizScript) return context.loadBizScript(path);
  if (context.loadBaselineScript) return context.loadBaselineScript(path);
  return require(files.join(context.config.runtime.scriptDir, path));
}

function decideWechatStartupCorrection(state) {
  state = state || {};
  if (!state.foreground) return { action: "LAUNCH", reason: "wechat_not_foreground" };
  if (String(state.bottomTab || "") === "信息") {
    return { action: "KEEP", reason: "information_tab_ready" };
  }
  return { action: "FORCE_RESTART", reason: "information_tab_not_selected" };
}

function correctWechatStartup(ui) {
  var state = ui.inspectStartupState();
  var decision = decideWechatStartupCorrection(state);
  if (decision.action === "LAUNCH") {
    ui.launchWechat();
    state = ui.inspectStartupState();
    decision = decideWechatStartupCorrection(state);
  }
  if (decision.action === "FORCE_RESTART") {
    ui.forceRestartWechat();
    state = ui.inspectStartupState();
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

function topicPending(message) {
  var error = new Error(message);
  error.publishStatus = "TOPIC_PENDING";
  return error;
}

function createWechatChannelsPublishHandler(context, dependencies) {
  dependencies = dependencies || {};
  var logger = context.logger;
  var uploader = context.uploader;
  var materialDomain = loadBizModule(context, "domain/material-inspector.js");
  var topicDomain = loadBizModule(context, "domain/topic-validator.js");
  var popupMarker = loadBizModule(context, "features/publish-video/channels-verify-popup.js");
  var ui = dependencies.ui || loadBizModule(context, "features/publish-video/channels-publish-ui.js")
    .createWechatChannelsPublishUi(context);

  var materialDownloader = dependencies.materialDownloader;
  var resultReporter = dependencies.resultReporter;
  var topicContinuation = dependencies.topicContinuation;
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
    assertNoVerification(stage + "前");
    var result = action();
    assertNoVerification(stage + "后");
    return result;
  }

  function fillAndValidateTopics(payload) {
    performAction("填写描述", function () { ui.fillDescription(payload.description); });
    var requiredTopics = topicDomain.extractTopics(payload.description);
    for (var i = 0; i < requiredTopics.length; i++) {
      (function (topic) {
        performAction("选择话题" + topic, function () { ui.selectTopic(topic); });
      })(requiredTopics[i]);
    }
    return topicDomain.validateTopics(
      payload.description,
      ui.listSelectedTopics(),
      payload.expectedTopicCount
    );
  }

  function reportTopicPending(payload, reason) {
    resultReporter.report(payload.taskId, {
      deviceId: context.config.device.deviceId || "",
      deviceToken: context.config.device.deviceToken || "",
      status: "TOPIC_PENDING",
      error: reason || "视频号话题待补充"
    });
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
    var ackStatus = status === "SUCCEEDED" || status === "TOPIC_PENDING" ||
      status === "CHANNELS_VERIFY_PENDING" ? "DONE" : "FAILED";
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
      waitForNext(gate, "进入发现", ui.states.discoverReady);
      performAction("进入发现", function () { ui.openDiscover(); });
      waitForNext(gate, "进入视频号", ui.states.channelsReady);
      performAction("进入视频号", function () { ui.openChannels(); });
      waitForNext(gate, "打开我的", ui.states.mineReady);
      performAction("打开我的", function () { ui.openMine(); });
      waitForNext(gate, "打开发表视频", ui.states.publishMenuReady);
      performAction("打开发表视频", function () { ui.openPublishVideo(); });
      waitForNext(gate, "选择发布素材", ui.states.albumReady);
      performAction("打开相册", function () { ui.openAlbum(); });
      var materialDecision = materialDomain.chooseVideoMaterial(ui.readFirstGalleryItems());
      if (!materialDecision.valid) throw materialError(materialDecision.reason || "素材未正确上传");
      performAction("选择发布素材", function () { ui.clickGalleryItem(materialDecision.index); });
      performAction("素材下一步", function () { ui.clickNext(); });
      waitForNext(gate, "添加标题", ui.states.titleReady);
      performAction("添加标题", function () { ui.addTitle(); });
      performAction("输入标题", function () { ui.inputTitle(payload.title); });
      performAction("标题对勾", function () { ui.confirmTitle(); });
      performAction("点击标题框外", function () { ui.tapOutsideTitle(); });
      performAction("完成标题", function () { ui.completeTitle(); });
      waitForNext(gate, "等待导出", ui.states.exportComplete);
      var topicResult = fillAndValidateTopics(payload);
      if (!topicResult.valid) {
        if (!topicContinuation) throw topicPending(topicResult.reason || "视频号话题待补充");
        reportTopicPending(payload, topicResult.reason);
        payload.description = topicContinuation.waitForResolvedDescription(payload);
        topicResult = fillAndValidateTopics(payload);
        if (!topicResult.valid) throw topicPending(topicResult.reason || "视频号话题待补充");
      }
      waitForNext(gate, "发表视频", ui.states.publishReady);
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
