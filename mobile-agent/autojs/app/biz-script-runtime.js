var policy = require("./biz-script-policy.js");

function createBizScriptRuntime(options) {
  var deps = options.deps, scriptDir = options.scriptDir;
  var currentDir = options.currentDir;
  var root = currentDir.replace(/\/current\/?$/, "");
  var baseline = null, overlay = null, failedOverlay = null, viewDir = null, declared = {};
  var state = {
    source: "baseline", version: "0.0.0", baselineVersion: "0.0.0",
    hotUpdateAllowed: false, rejectionReason: "", apkBuildId: "",
    baseCompatibilityId: "", sourceSha256: ""
  };

  function cleanup() {
    if (!viewDir) return;
    var owned = viewDir;
    viewDir = null;
    deps.remove(owned);
  }

  try {
    baseline = policy.readBaseline(deps, scriptDir);
    state.version = state.baselineVersion = baseline.version;
    state.apkBuildId = baseline.apkBuildId || "";
    state.baseCompatibilityId = baseline.baseCompatibilityId;
    state.sourceSha256 = baseline.sourceSha256;
    state.hotUpdateAllowed = true;
    if (deps.exists(policy.joinPath(currentDir, "version.json"))) {
      try {
        overlay = policy.validateOverlay(deps, currentDir, baseline);
      } catch (validationError) {
        // Preserve the manifest fingerprint so the next engine can quarantine this exact bad overlay.
        try {
          var raw = JSON.parse(deps.readText(policy.joinPath(currentDir, "version.json")));
          if (raw && policy.validVersion(raw.version) && typeof raw.sourceSha256 === "string" &&
              typeof raw.baseCompatibilityId === "string") failedOverlay = raw;
        } catch (manifestError) {}
        throw validationError;
      }
      if (policy.isRejected(overlay, policy.readRejection(deps, root))) {
        throw new Error("biz scripts package previously failed to load");
      }
      viewDir = policy.joinPath(scriptDir, "biz-scripts", "runtime",
        "view-" + deps.now() + "-" + Math.random().toString(16).slice(2));
      deps.ensureDir(viewDir);
      overlay.files.forEach(function (file) {
        deps.copyFile(policy.joinPath(currentDir, file.path), policy.joinPath(viewDir, file.path));
        declared[file.path] = true;
      });
      policy.verifyFiles(deps, viewDir, overlay.files);
      // Native CommonJS resolves these proxies back to the same APK module cache.
      baseline.baseFiles.forEach(function (file) {
        var target = policy.joinPath(viewDir, file.path);
        deps.ensureDir(target.substring(0, target.lastIndexOf("/")));
        deps.writeText(target, "module.exports = require(" + JSON.stringify(policy.joinPath(scriptDir, file.path)) + ");\n");
      });
      state.source = "overlay";
      state.version = overlay.version;
      state.sourceSha256 = overlay.sourceSha256;
    }
  } catch (error) {
    try { cleanup(); } catch (cleanupError) {}
    if (!failedOverlay) failedOverlay = overlay;
    overlay = null;
    state.rejectionReason = String(error && error.message || error);
  }

  function resolve(path) {
    path = policy.safePath(path);
    if (overlay && /^(features|domain)\//.test(path)) {
      if (!declared[path]) throw new Error("business module is not declared in manifest: " + path);
      return policy.joinPath(viewDir, path);
    }
    return policy.joinPath(scriptDir, path);
  }

  function markFailed(error) {
    var rejected = overlay || failedOverlay;
    if (!rejected) return;
    deps.ensureDir(root);
    deps.writeText(policy.joinPath(root, "rejected.json"), JSON.stringify({
      version: rejected.version, sourceSha256: rejected.sourceSha256,
      baseCompatibilityId: rejected.baseCompatibilityId, message: String(error), failedAt: deps.now()
    }));
  }

  return { resolve: resolve, state: state, baseline: baseline, cleanup: cleanup, markFailed: markFailed };
}

module.exports = { createBizScriptRuntime: createBizScriptRuntime };
