"use strict";

var contract = require("./contract.js");
var defaultLayout = require("./douyin-layout.js");

function createScreenActions(deps, layout) {
  deps = deps || {};
  layout = layout || defaultLayout;

  function finiteNumber(value, fallback) {
    return typeof value === "number" && isFinite(value) ? value : fallback;
  }

  function checkStop() {
    if (typeof deps.shouldStop !== "function") {
      return null;
    }
    try {
      return deps.shouldStop() ? contract.stopped() : null;
    } catch (error) {
      return contract.failure(contract.REASON.STOP_CHECK_FAILED, "stop check failed");
    }
  }

  function callDependency(names, args, missingMessage) {
    var index;
    for (index = 0; index < names.length; index += 1) {
      if (typeof deps[names[index]] === "function") {
        try {
          return contract.success(deps[names[index]].apply(deps, args || []));
        } catch (error) {
          return contract.failure(contract.REASON.DRIVER_ERROR, missingMessage + " failed");
        }
      }
    }
    return contract.failure(contract.REASON.DEPENDENCY_MISSING, missingMessage + " missing");
  }

  function now() {
    if (typeof deps.now !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "time source missing");
    }
    try {
      var value = deps.now();
      if (typeof value !== "number" || !isFinite(value)) {
        return contract.failure(contract.REASON.TIME_SOURCE_ERROR, "time source returned invalid value");
      }
      return contract.success(value);
    } catch (error) {
      return contract.failure(contract.REASON.TIME_SOURCE_ERROR, "time source failed");
    }
  }

  function sleepFor(durationMs) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    if (typeof deps.sleep !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "sleep dependency missing");
    }
    try {
      if (deps.sleep(durationMs) === false) {
        return contract.failure(contract.REASON.SLEEP_ERROR, "sleep returned false");
      }
    } catch (error) {
      return contract.failure(contract.REASON.SLEEP_ERROR, "sleep failed");
    }
    stopped = checkStop();
    return stopped || contract.success(durationMs);
  }

  function waitForNode(selector, timeoutMs) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var defaults = layout.WAIT_OPTIONS || {};
    var defaultTimeout = finiteNumber(defaults.timeoutMs, 5000);
    var timeout = Math.max(0, Math.floor(finiteNumber(timeoutMs, defaultTimeout)));
    var pollInterval = Math.max(1, Math.floor(finiteNumber(defaults.pollIntervalMs, 200)));
    var maxAttempts = Math.max(1, Math.floor(timeout / pollInterval) + 1);
    var start = now();
    if (!start.success) {
      return start;
    }
    var attempt;
    for (attempt = 0; attempt < maxAttempts; attempt += 1) {
      stopped = checkStop();
      if (stopped) {
        return stopped;
      }
      var found = callDependency(["findNode", "lookupNode", "find"], [selector], "node lookup");
      stopped = checkStop();
      if (stopped) {
        return stopped;
      }
      if (!found.success) {
        return contract.failure(contract.REASON.NODE_LOOKUP_FAILED, found.message);
      }
      if (found.value) {
        return contract.success(found.value);
      }
      if (attempt + 1 >= maxAttempts) {
        break;
      }
      var current = now();
      if (!current.success) {
        return current;
      }
      var elapsed = Math.max(0, current.value - start.value);
      if (elapsed >= timeout) {
        break;
      }
      var slept = sleepFor(Math.min(pollInterval, timeout - elapsed));
      if (!slept.success) {
        return slept;
      }
    }
    return contract.failure(contract.REASON.NODE_TIMEOUT, "node wait timed out");
  }

  function readNodeValue(node, key) {
    var candidate = node && node[key];
    try {
      candidate = typeof candidate === "function" ? candidate.call(node) : candidate;
      if (candidate === null || typeof candidate === "undefined") {
        return contract.success("");
      }
      return contract.success(String(candidate));
    } catch (error) {
      return contract.failure(contract.REASON.NODE_READ_FAILED, "node " + key + " read failed");
    }
  }

  function readText(selector, timeoutMs) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var found = waitForNode(selector, timeoutMs);
    if (!found.success) {
      return found;
    }
    var text = readNodeValue(found.value, "text");
    if (text.success && text.value.trim()) {
      return contract.success(text.value);
    }
    var desc = readNodeValue(found.value, "desc");
    if (desc.success && desc.value.trim()) {
      return contract.success(desc.value);
    }
    if (!text.success) {
      return text;
    }
    if (!desc.success) {
      return desc;
    }
    return contract.failure(contract.REASON.NODE_TEXT_UNAVAILABLE, "node has no text or description");
  }

  function readScreenSize(snapshot) {
    var source;
    if (snapshot && typeof snapshot.width === "number" && typeof snapshot.height === "number") {
      source = { width: snapshot.width, height: snapshot.height };
    } else {
      try {
        source = typeof deps.screenSize === "function" ? deps.screenSize() : deps.screenSize;
      } catch (error) {
        return contract.failure(contract.REASON.SCREEN_CAPTURE_FAILED, "screen size read failed");
      }
    }
    return contract.success(layout.normalizeScreenSize(source));
  }

  function resolveRegions(regions, screenSize) {
    var requested = regions;
    if (typeof requested === "undefined" || requested === null) {
      return contract.success(layout.getCaptureRegions(screenSize));
    }
    if (!Array.isArray(requested)) {
      requested = [requested];
    }
    var resolved = [];
    var index;
    for (index = 0; index < requested.length; index += 1) {
      var region = layout.resolveRegion(requested[index], screenSize);
      if (!region) {
        return contract.failure(contract.REASON.OCR_FAILED, "unknown capture region");
      }
      resolved.push(region);
    }
    return contract.success(resolved);
  }

  function recycleImage(image) {
    try {
      if (typeof deps.recycleImage === "function") {
        deps.recycleImage(image);
      } else if (image && typeof image.recycle === "function") {
        image.recycle();
      }
      return contract.success();
    } catch (error) {
      return contract.failure(contract.REASON.IMAGE_RECYCLE_FAILED, "image recycle failed");
    }
  }

  function processRegions(image, snapshot, regions) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var size = readScreenSize(snapshot);
    if (!size.success) {
      return size;
    }
    var captureRegions = resolveRegions(regions, size.value);
    if (!captureRegions.success) {
      return captureRegions;
    }
    if (typeof deps.ocr !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "ocr dependency missing");
    }
    var values = [];
    var index;
    for (index = 0; index < captureRegions.value.length; index += 1) {
      stopped = checkStop();
      if (stopped) {
        return stopped;
      }
      var raw = deps.ocr(image, captureRegions.value[index]);
      stopped = checkStop();
      if (stopped) {
        return stopped;
      }
      var parsed = typeof deps.parseOcr === "function"
        ? deps.parseOcr(raw, captureRegions.value[index])
        : raw;
      stopped = checkStop();
      if (stopped) {
        return stopped;
      }
      values.push({
        name: captureRegions.value[index].name,
        region: captureRegions.value[index],
        value: parsed
      });
    }
    return contract.success(values);
  }

  function captureRegions(regions) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var captured = callDependency(["captureScreen", "takeScreenshot"], [], "screen capture");
    if (!captured.success) {
      return contract.failure(contract.REASON.SCREEN_CAPTURE_FAILED, captured.message);
    }
    var snapshot = captured.value;
    var image = snapshot && Object.prototype.hasOwnProperty.call(snapshot, "image")
      ? snapshot.image
      : snapshot;
    stopped = checkStop();
    if (!image) {
      return stopped || contract.failure(
        contract.REASON.SCREEN_CAPTURE_FAILED,
        "screen capture returned no image"
      );
    }
    var result;
    var recycleResult;
    try {
      result = stopped || processRegions(image, snapshot, regions);
    } catch (error) {
      result = contract.failure(contract.REASON.OCR_FAILED, "ocr processing failed");
    } finally {
      recycleResult = recycleImage(image);
    }
    if (!recycleResult.success && result.success) {
      return recycleResult;
    }
    return result;
  }

  function diagnosticValue(names) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var index;
    for (index = 0; index < names.length; index += 1) {
      if (typeof deps[names[index]] === "function") {
        try {
          var value = deps[names[index]]();
          stopped = checkStop();
          return stopped || contract.success(value);
        } catch (error) {
          return contract.failure(
            contract.REASON.VERIFICATION_CHECK_FAILED,
            "verification diagnostics failed"
          );
        }
      }
    }
    return contract.success(null);
  }

  function riskDetected(risk) {
    if (risk === true) {
      return true;
    }
    if (!risk || typeof risk !== "object") {
      return false;
    }
    return risk.detected === true || risk.verification === true ||
      risk.reason === contract.REASON.PLATFORM_VERIFICATION;
  }

  function detectPlatformVerification() {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var riskCall = callDependency(
      ["detectRisk", "detectPlatformRisk", "detectVerification"],
      [layout.SELECTOR_DESCRIPTIONS.platformVerification],
      "platform verification detector"
    );
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    if (!riskCall.success) {
      return contract.failure(contract.REASON.VERIFICATION_CHECK_FAILED, riskCall.message);
    }
    var pageStructure = diagnosticValue(["getPageStructure", "readPageStructure"]);
    if (!pageStructure.success) {
      return pageStructure;
    }
    var actionTrace = diagnosticValue(["getActionTrace", "readActionTrace"]);
    if (!actionTrace.success) {
      return actionTrace;
    }
    var details = {
      risk: riskCall.value,
      pageStructure: pageStructure.value,
      actionTrace: actionTrace.value
    };
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    if (riskDetected(riskCall.value)) {
      return contract.failure(
        contract.REASON.PLATFORM_VERIFICATION,
        "platform verification detected",
        details
      );
    }
    details.detected = false;
    return contract.success(details);
  }

  return {
    waitForNode: waitForNode,
    readText: readText,
    captureRegions: captureRegions,
    detectPlatformVerification: detectPlatformVerification
  };
}

module.exports = {
  createScreenActions: createScreenActions
};
