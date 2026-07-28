// 原中文名：动作时间闸口.js；职责：控制发布动作的时间节奏。
function normalizeRange(minValue, maxValue, fallback) {
  var min = Number(minValue);
  var max = Number(maxValue);
  if (!isFinite(min) || min < 0) min = fallback;
  if (!isFinite(max) || max < min) max = min;
  return { min: Math.floor(min), max: Math.floor(max) };
}

function randomInteger(range, random) {
  return range.min + Math.floor(random() * (range.max - range.min + 1));
}

function createActionTimeGate(options, dependencies) {
  options = options || {};
  dependencies = dependencies || {};
  var responseRange = normalizeRange(
    options.responseDelayMsMin,
    options.responseDelayMsMax,
    500
  );
  var waitRange = normalizeRange(
    options.actionWaitMsMin,
    options.actionWaitMsMax,
    500
  );
  var timeoutMs = Math.max(1, Number(options.targetStateTimeoutMs || 45000));
  var pollIntervalMs = Math.max(1, Number(options.pollIntervalMs || 500));
  var random = dependencies.random || Math.random;
  var sleepFor = dependencies.sleep || function (value) { sleep(value); };
  var now = dependencies.now || function () { return Date.now(); };

  function waitForNext(actionName, isTargetState) {
    var startedAt = now();
    while (!isTargetState()) {
      if (now() - startedAt >= timeoutMs) {
        throw new Error("等待" + actionName + "目标状态超时");
      }
      sleepFor(pollIntervalMs);
    }

    var responseDelayMs = randomInteger(responseRange, random);
    sleepFor(responseDelayMs);
    var actionWaitMs = randomInteger(waitRange, random);
    sleepFor(actionWaitMs);
    return {
      actionName: actionName,
      responseDelayMs: responseDelayMs,
      actionWaitMs: actionWaitMs
    };
  }

  return { waitForNext: waitForNext };
}

module.exports = {
  createActionTimeGate: createActionTimeGate
};
