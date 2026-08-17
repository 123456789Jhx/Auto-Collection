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

  function selectEngine() {
    var autoJsOcr = typeof ocr !== "undefined" ? ocr : null;
    var paddleOcr = typeof paddle !== "undefined" ? paddle : null;
    var dollarOcr = typeof $ocr !== "undefined" ? $ocr : null;

    if (autoJsOcr && typeof autoJsOcr.recognizeText === "function") {
      return {
        name: "autojs6_mlkit",
        recognize: function (image) {
          return autoJsOcr.recognizeText(image, { mode: "mlkit" });
        }
      };
    }

    if (autoJsOcr && typeof autoJsOcr.recognize === "function") {
      return {
        name: "legacy_ocr",
        recognize: function (image) {
          return autoJsOcr.recognize(image);
        }
      };
    }

    if (paddleOcr && typeof paddleOcr.ocr === "function") {
      return {
        name: "paddle",
        recognize: function (image) {
          return paddleOcr.ocr(image);
        }
      };
    }

    if (dollarOcr && typeof dollarOcr.recognize === "function") {
      return {
        name: "$ocr",
        recognize: function (image) {
          return dollarOcr.recognize(image);
        }
      };
    }

    return null;
  }

  var loggedEngineName = "";

  function recordSelectedEngine(engine) {
    if (loggedEngineName === engine.name) {
      return;
    }
    loggedEngineName = engine.name;
    logger.info("OCR engine selected", {
      engine: engine.name
    });
  }

  function recognize(image) {
    if (!image) {
      return "";
    }

    var engine = selectEngine();
    if (!engine) {
      logger.warn("OCR API unavailable");
      return "";
    }

    recordSelectedEngine(engine);

    for (var i = 0; i < config.runtime.ocrRetryCount; i++) {
      try {
        return normalizeResult(engine.recognize(image));
      } catch (error) {
        logger.warn("OCR recognition failed", {
          engine: engine.name,
          attempt: i + 1,
          message: String(error)
        });
        if (i + 1 < config.runtime.ocrRetryCount) {
          sleep(500);
        }
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
