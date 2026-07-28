function createRemoteScriptConfigHandler(context) {
  var config = context.config;
  var logger = context.logger;
  var uploader = context.uploader;
  var client = context.remoteScriptClient || createRemoteScriptClient(config);
  var storage = context.remoteScriptStorage || createDefaultStorage();
  var activeConfigs = context.remoteScriptConfigs || {};
  context.remoteScriptConfigs = activeConfigs;

  function cacheKey(scriptKey) {
    return "remote_script_config:" + scriptKey;
  }

  function applyConfig(scriptKey, savedConfig) {
    var key = cacheKey(scriptKey);
    var previous = storage.get(key, null);
    if (savedConfig) {
      storage.put(key, savedConfig);
    } else {
      storage.remove(key);
    }
    try {
      if (typeof context.applyRemoteScriptConfig === "function") {
        context.applyRemoteScriptConfig(scriptKey, savedConfig);
      }
      if (savedConfig) {
        activeConfigs[scriptKey] = savedConfig;
      } else {
        delete activeConfigs[scriptKey];
      }
    } catch (error) {
      if (previous) {
        storage.put(key, previous);
      } else {
        storage.remove(key);
      }
      throw error;
    }
  }

  function handle(command) {
    var payload = command && (command.payload || command.payloadJson || {}) || {};
    var scriptKey = String(payload.script_key || "");
    try {
      if (!scriptKey) {
        throw new Error("script_key is required");
      }
      var savedConfig = client.fetchConfig(scriptKey);
      if (savedConfig) {
        validatePulledConfig(savedConfig, payload);
      }
      applyConfig(scriptKey, savedConfig);
      var result = savedConfig ? {
        applied: true,
        commandType: "SCRIPT_CONFIG_UPDATED",
        scriptKey: scriptKey,
        appliedRevision: Number(savedConfig.revision || 0),
        configHash: String(savedConfig.configHash || "")
      } : {
        applied: true,
        commandType: "SCRIPT_CONFIG_UPDATED",
        scriptKey: scriptKey,
        appliedRevision: 0,
        configHash: "",
        removed: true
      };
      logger.info("远程脚本配置已生效", result);
      return uploader.ackCommand(command.id, "DONE", result);
    } catch (error) {
      var failure = {
        applied: false,
        commandType: "SCRIPT_CONFIG_UPDATED",
        scriptKey: scriptKey,
        message: String(error)
      };
      logger.warn("远程脚本配置生效失败", failure);
      return uploader.ackCommand(command.id, "FAILED", failure);
    }
  }

  return {
    handle: handle,
    getCached: function (scriptKey) {
      return storage.get(cacheKey(scriptKey), null);
    }
  };
}

function createDefaultStorage() {
  if (typeof storages !== "undefined" && storages && storages.create) {
    return storages.create("AgriVideoCollectorRemoteScripts");
  }
  var values = {};
  return {
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    put: function (key, value) {
      values[key] = value;
    },
    remove: function (key) {
      delete values[key];
    }
  };
}

function validatePulledConfig(savedConfig, commandPayload) {
  var actualRevision = Number(savedConfig.revision || 0);
  var expectedRevision = Number(commandPayload.revision || 0);
  var actualHash = String(savedConfig.configHash || "");
  var expectedHash = String(commandPayload.config_hash || "");
  if (!savedConfig.configPayload || typeof savedConfig.configPayload !== "object" || savedConfig.configPayload.length) {
    throw new Error("pulled config payload is invalid");
  }
  if (!actualRevision || !actualHash) {
    throw new Error("pulled config revision or hash is missing");
  }
  if (expectedRevision && actualRevision < expectedRevision) {
    throw new Error("pulled config revision is stale");
  }
  if (expectedRevision === actualRevision && expectedHash && expectedHash !== actualHash) {
    throw new Error("pulled config hash does not match command");
  }
}

function createRemoteScriptClient(config) {
  function bytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      var part = value.toString(16);
      hex += part.length === 1 ? "0" + part : part;
    }
    return hex;
  }

  function sha256Hex(value) {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    digest.update(new java.lang.String(value || "").getBytes("UTF-8"));
    return bytesToHex(digest.digest());
  }

  function hmacSha256Hex(secret, value) {
    var mac = javax.crypto.Mac.getInstance("HmacSHA256");
    var key = new javax.crypto.spec.SecretKeySpec(
      new java.lang.String(secret || "").getBytes("UTF-8"),
      "HmacSHA256"
    );
    mac.init(key);
    return bytesToHex(mac.doFinal(new java.lang.String(value || "").getBytes("UTF-8")));
  }

  function headers(url) {
    var token = config.device.deviceToken || "";
    var timestamp = new Date().toISOString();
    var bodyHash = sha256Hex("");
    var uri = android.net.Uri.parse(url);
    var canonical = [
      "GET",
      uri.getEncodedPath() || "/",
      uri.getEncodedQuery() || "",
      timestamp,
      bodyHash
    ].join("\n");
    return {
      "X-Device-Id": config.device.deviceId || "",
      "X-Device-Token": token,
      "X-Timestamp": timestamp,
      "X-Body-SHA256": bodyHash,
      "X-Signature": hmacSha256Hex(token, canonical)
    };
  }

  return {
    fetchConfig: function (scriptKey) {
      var baseUrl = String(config.upload.baseUrl || "").replace(/\/$/, "");
      var url = baseUrl + "/mobile/remote-scripts/configs/" + encodeURIComponent(scriptKey) +
        "?deviceId=" + encodeURIComponent(config.device.deviceId || "");
      var response = http.get(url, {
        timeout: config.upload.timeoutMs,
        headers: headers(url)
      });
      var body = response.body ? response.body.string() : "";
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error("remote script config pull failed: " + response.statusCode + " " + body);
      }
      var parsed = JSON.parse(body || "{}");
      return parsed.data || null;
    }
  };
}

module.exports = {
  createRemoteScriptConfigHandler: createRemoteScriptConfigHandler,
  createRemoteScriptClient: createRemoteScriptClient
};
