function createOcr(config, logger) {
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
    var image = captureScreen();
    var text = recognize(image);
    return {
      image: image,
      text: text
    };
  }

  return {
    recognize: recognize,
    captureAndRecognize: captureAndRecognize
  };
}

module.exports = {
  createOcr: createOcr
};
