function createOcr(config, logger) {
  var permissionManager = null;

  function setPermissionManager(manager) {
    permissionManager = manager || null;
  }

  function ensureCaptureReady(reason) {
    if (!permissionManager || !permissionManager.ensureCapturePermission) {
      return true;
    }
    logger.info("OCR截图前确认截图权限", { reason: reason || "" });
    return permissionManager.ensureCapturePermission();
  }

  function normalizeResult(result) {
    if (!result) {
      return "";
    }

    if (typeof result === "string") {
      return result;
    }

    if (Array.isArray(result)) {
      return result
        .map(function (item) {
          if (typeof item === "string") {
            return item;
          }
          return item.text || item.label || "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (result.text) {
      return result.text;
    }

    if (result.results) {
      return normalizeResult(result.results);
    }

    return "";
  }

  function recognize(image) {
    if (!image) {
      return "";
    }

    for (var i = 0; i < config.runtime.ocrRetryCount; i++) {
      try {
        if (typeof ocr !== "undefined" && ocr.recognize) {
          return normalizeResult(ocr.recognize(image));
        }

        if (typeof paddle !== "undefined" && paddle.ocr) {
          return normalizeResult(paddle.ocr(image));
        }

        if (typeof $ocr !== "undefined" && $ocr.recognize) {
          var deferred = $ocr.recognize(image);
          return normalizeResult(deferred);
        }

        logger.warn("当前运行环境未发现可用 OCR API");
        return "";
      } catch (error) {
        logger.warn("OCR 识别失败，准备重试", {
          attempt: i + 1,
          message: String(error)
        });
        sleep(500);
      }
    }

    return "";
  }

  function captureAndRecognize() {
    if (!ensureCaptureReady("capture_and_recognize")) {
      return {
        image: null,
        text: ""
      };
    }
    var image = captureScreen();
    var text = recognize(image);
    return {
      image: image,
      text: text
    };
  }

  function captureRegions(regionMap) {
    if (!ensureCaptureReady("capture_regions")) {
      return {
        image: null,
        regions: {},
        text: ""
      };
    }
    var image = captureScreen();
    var result = {};
    Object.keys(regionMap || {}).forEach(function (name) {
      var region = regionMap[name];
      try {
        var clip = images.clip(image, region.x, region.y, region.w, region.h);
        result[name] = recognize(clip);
      } catch (error) {
        logger.warn("区域 OCR 失败", {
          region: name,
          message: String(error)
        });
        result[name] = "";
      }
    });
    return {
      image: image,
      regions: result,
      text: Object.keys(result).map(function (key) {
        return result[key];
      }).filter(Boolean).join("\n")
    };
  }

  return {
    recognize: recognize,
    captureAndRecognize: captureAndRecognize,
    captureRegions: captureRegions,
    setPermissionManager: setPermissionManager
  };
}

module.exports = {
  createOcr: createOcr
};
