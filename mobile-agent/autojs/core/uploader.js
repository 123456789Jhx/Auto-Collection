function createUploader(config, logger, storage) {
  function upload(candidate) {
    if (!config.upload.enabled) {
      return {
        enabled: false,
        success: false,
        message: "upload disabled"
      };
    }

    try {
      var response = http.postJson(config.upload.url, candidate, {
        timeout: config.upload.timeoutMs
      });
      var statusCode = response.statusCode;
      var body = response.body ? response.body.string() : "";
      var success = statusCode >= 200 && statusCode < 300;
      logger.info("候选记录上传完成", {
        success: success,
        statusCode: statusCode,
        body: body
      });
      return {
        enabled: true,
        success: success,
        statusCode: statusCode,
        body: body
      };
    } catch (error) {
      logger.warn("候选记录上传失败", { message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function retryCached() {
    if (!config.upload.enabled || !config.upload.retryCachedOnStart) {
      return;
    }

    var filesToUpload = storage.listCachedCandidates();
    filesToUpload.forEach(function (filePath) {
      try {
        var candidate = storage.readJson(filePath);
        var result = upload(candidate);
        if (result.success) {
          storage.markUploaded(filePath);
          logger.info("缓存候选记录补传成功", { filePath: filePath });
        }
      } catch (error) {
        logger.warn("缓存候选记录补传失败", {
          filePath: filePath,
          message: String(error)
        });
      }
    });
  }

  return {
    upload: upload,
    retryCached: retryCached
  };
}

module.exports = {
  createUploader: createUploader
};
