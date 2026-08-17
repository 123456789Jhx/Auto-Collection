function createLiveSessionRunner(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var interactionRunner = options.interactionRunner || { run: function () { return { status: "INTERACTION_RUNNER_MISSING" }; } };
  var now = options.now || function () { return new Date().getTime(); };
  var wait = options.wait || function () {};
  var waitRandom = options.waitRandom || function (min) { return min; };
  var isLiveRoom = options.isLiveRoom || function () { return false; };
  var nextLive = options.nextLive || function () { return false; };
  var dismissTransientPopup = options.dismissTransientPopup || function () { return false; };

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function durationMs(minutes) {
    return Math.floor(Number(minutes) || 0) * 60 * 1000;
  }

  function dismissPopup() {
    try {
      return dismissTransientPopup() === true;
    } catch (error) {
      logger.warn("养号直播临时弹窗处理失败", { message: String(error) });
      return false;
    }
  }

  function switchLive(reason, completedLiveCount) {
    var delayMs = 0;
    if (reason === "LIVE_ENDED") {
      delayMs = waitRandom(2345, 5432);
      logger.warn("直播已下播，等待后切换下一直播间", { delayMs: delayMs, completedLiveCount: completedLiveCount });
    } else if (reason === "RELATED_TERM_NOT_MATCHED") {
      logger.info("新直播间未通过相关名词校验，继续切换", { completedLiveCount: completedLiveCount });
    } else {
      logger.info("单直播时长结束，切换下一直播间", { completedLiveCount: completedLiveCount });
    }
    if (!nextLive()) return { success: false, delayMs: delayMs };
    return { success: true, delayMs: delayMs };
  }

  function run(payload, control, sessionControl) {
    payload = payload || {};
    sessionControl = sessionControl || {};
    var singleLiveMs = durationMs(payload.singleLiveDurationMinutes);
    var totalWarmupMs = durationMs(payload.totalWarmupDurationMinutes);
    if (!singleLiveMs || !totalWarmupMs) return { status: "WARMUP_DURATION_INVALID" };

    var startedAt = now();
    var liveStartedAt = startedAt;
    var completedLiveCount = 0;
    var lastInteraction = null;
    var validationRequired = false;
    while (true) {
      if (stopped(control)) return { status: "STOPPED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
      dismissPopup();
      if (!isLiveRoom()) {
        if (now() - startedAt >= totalWarmupMs) return { status: "COMPLETED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction, reason: "TOTAL_DURATION_REACHED" };
        var endedSwitch = switchLive("LIVE_ENDED", completedLiveCount);
        if (!endedSwitch.success) return { status: "NEXT_LIVE_FAILED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
        liveStartedAt = now();
        validationRequired = true;
        continue;
      }

      if (validationRequired && typeof sessionControl.validateCurrentLive === "function") {
        var validation = sessionControl.validateCurrentLive() || {};
        if (stopped(control)) return { status: "STOPPED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
        if (now() - startedAt >= totalWarmupMs) {
          return { status: "COMPLETED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction, reason: "TOTAL_DURATION_REACHED" };
        }
        if (!validation.matched) {
          var rejectedSwitch = switchLive("RELATED_TERM_NOT_MATCHED", completedLiveCount);
          if (!rejectedSwitch.success) return { status: "NEXT_LIVE_FAILED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
          liveStartedAt = now();
          validationRequired = true;
          continue;
        }
        liveStartedAt = now();
      }
      validationRequired = false;

      var interaction = interactionRunner.run(payload, control);
      if (interaction.status !== "COMPLETED") {
        if (!isLiveRoom()) {
          if (now() - startedAt >= totalWarmupMs) return { status: "COMPLETED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction, reason: "TOTAL_DURATION_REACHED" };
          var interruptedSwitch = switchLive("LIVE_ENDED", completedLiveCount);
          if (!interruptedSwitch.success) return { status: "NEXT_LIVE_FAILED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
          liveStartedAt = now();
          validationRequired = true;
          continue;
        }
        return { status: interaction.status, completedLiveCount: completedLiveCount, lastInteraction: lastInteraction, interaction: interaction };
      }
      completedLiveCount += 1;
      lastInteraction = interaction;
      logger.info("单直播互动完成", { completedLiveCount: completedLiveCount });

      while (now() - liveStartedAt < singleLiveMs && now() - startedAt < totalWarmupMs) {
        if (stopped(control)) return { status: "STOPPED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
        dismissPopup();
        if (!isLiveRoom()) break;
        var singleRemainingMs = singleLiveMs - (now() - liveStartedAt);
        var totalRemainingMs = totalWarmupMs - (now() - startedAt);
        wait(Math.max(1, Math.min(1000, singleRemainingMs, totalRemainingMs)));
      }

      if (now() - startedAt >= totalWarmupMs) {
        return { status: "COMPLETED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction, reason: "TOTAL_DURATION_REACHED" };
      }
      var switchResult = switchLive(isLiveRoom() ? "SINGLE_DURATION_REACHED" : "LIVE_ENDED", completedLiveCount);
      if (!switchResult.success) return { status: "NEXT_LIVE_FAILED", completedLiveCount: completedLiveCount, lastInteraction: lastInteraction };
      liveStartedAt = now();
      validationRequired = true;
    }
  }

  return { run: run };
}

module.exports = {
  createLiveSessionRunner: createLiveSessionRunner
};
