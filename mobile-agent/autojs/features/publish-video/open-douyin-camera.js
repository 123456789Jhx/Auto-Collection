// 原中文名：打开抖音到相机页.js；职责：导航抖音到相机发布页面。
function createOpenDouyinCameraStep(ui) {
  return function openDouyinCamera() {
    try {
      return ui.openCamera();
    } catch (error) {
      throw new Error("打开抖音到相机页失败：" + String(error));
    }
  };
}

function createFixedWaitPublishFlow(options) {
  options = options || {};
  var logger = options.logger;
  var materialDomain = options.materialDomain;
  var wait = options.wait;

  function enabled(payload, config) {
    var publishConfig = config && (config.publish || config) || {};
    return payload.publishFlowMode === "fixed_wait_mvp" || payload.useFixedWaitPublishFlow === true ||
      publishConfig.publishFlowMode === "fixed_wait_mvp" || publishConfig.useFixedWaitPublishFlow === true;
  }

  function run(steps, payload, materials, fill) {
    var ui = steps && steps.ui;
    var waitMs = Object.prototype.hasOwnProperty.call(payload, "mvpActionWaitMs") ? Number(payload.mvpActionWaitMs) : 15000;
    if (!isFinite(waitMs) || waitMs < 0) waitMs = 15000;
    if (!ui) throw new Error("MVP发布UI动作未预加载");
    function runStep(step, action) {
      logger.info("[MVP] step start", { taskId: payload.taskId, step: step, waitMs: waitMs });
      try {
        var result = action();
        if (result === false) throw new Error("动作返回失败");
        logger.info("[MVP] step done", { taskId: payload.taskId, step: step, waitMs: waitMs, actionResult: result === undefined ? true : result });
        wait(waitMs);
        return result;
      } catch (error) {
        var detail = { taskId: payload.taskId, step: step, waitMs: waitMs, message: String(error && error.message || error) };
        (logger.error || logger.warn).call(logger, "[MVP] step error", detail);
        throw error;
      }
    }
    runStep("open_app", function () { if (!ui.openApp) throw new Error("未找到打开抖音动作"); return ui.openApp(); });
    runStep("click_publish_entry", function () { if (!ui.clickPublishEntry) throw new Error("未找到发布入口动作"); return ui.clickPublishEntry(); });
    runStep("open_album", function () { return ui.openAlbum(); });
    runStep("select_video_material", function () {
      var choice = materialDomain.chooseVideoMaterial(ui.readFirstGalleryItems());
      if (!choice || !choice.valid) { var error = new Error(choice && choice.reason || "未找到可发布视频素材"); error.publishStatus = "MATERIAL_INVALID"; throw error; }
      ui.clickGalleryItem(choice.index);
      return { index: choice.index };
    });
    runStep("click_next", function () { if (!ui.clickNext) throw new Error("未找到下一步动作"); return ui.clickNext(); });
    runStep("fill_publish_text", function () { return fill(); });
    logger.info("[MVP] 封面设置暂跳过", { taskId: payload.taskId, step: "skip_cover", waitMs: waitMs });
    runStep("click_publish", function () { return ui.publish(); });
    var publishSuccessTimeoutMs = Number(payload.publishSuccessTimeoutMs || 180000);
    if (!isFinite(publishSuccessTimeoutMs) || publishSuccessTimeoutMs < 60000) publishSuccessTimeoutMs = 180000;
    if (typeof ui.waitForPublishSuccess !== "function" || !ui.waitForPublishSuccess(publishSuccessTimeoutMs)) {
      var publishError = new Error("发布结果判定超时，等待人工核验");
      publishError.publishStatus = "VERIFY_PENDING";
      throw publishError;
    }
    return ui.readPublishedResult() || {};
  }

  return { enabled: enabled, run: run };
}

module.exports = {
  createOpenDouyinCameraStep: createOpenDouyinCameraStep,
  createFixedWaitPublishFlow: createFixedWaitPublishFlow
};
