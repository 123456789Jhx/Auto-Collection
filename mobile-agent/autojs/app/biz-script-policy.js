function joinPath() {
  return Array.prototype.slice.call(arguments).join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function validVersion(value) {
  return typeof value === "string" && /^[0-9]+(?:\.[0-9]+)*$/.test(value) &&
    value.split(".").every(function (part) { return Number(part) <= 9007199254740991; });
}

function compareVersions(left, right) {
  var a = String(left).split("."), b = String(right).split(".");
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    var difference = Number(a[i] || 0) - Number(b[i] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function safePath(path) {
  if (typeof path !== "string" || !/^[A-Za-z0-9._/-]+\.js$/.test(path) ||
      path.charAt(0) === "/" || path.indexOf("\\") >= 0 ||
      path.split("/").some(function (part) { return !part || part === "." || part === ".."; })) {
    throw new Error("unsafe script path: " + path);
  }
  return path;
}

function fileList(input, business) {
  if (Object.prototype.toString.call(input) !== "[object Array]" || !input.length) {
    throw new Error("script manifest files are required");
  }
  var seen = {};
  return input.map(function (item) {
    var path = safePath(item && item.path);
    var allowed = business ? /^(features|domain)\//.test(path) :
      /^(app|core|platforms|utils)\//.test(path) || (path.indexOf("/") < 0 && path !== "config.js");
    if (!allowed) throw new Error("script path outside declared layer: " + path);
    if (seen[path]) throw new Error("duplicate script path: " + path);
    if (!/^[0-9a-f]{64}$/.test(String(item.sha256 || ""))) throw new Error("invalid script sha256: " + path);
    seen[path] = true;
    return { path: path, sha256: item.sha256 };
  });
}

function inventoryText(files) {
  return files.map(function (file) { return file.path + ":" + file.sha256; }).sort().join("\n");
}

function validateMetadata(metadata, deps) {
  if (!metadata || metadata.schemaVersion !== 2 || metadata.channel !== "biz-scripts") {
    throw new Error("unsupported biz scripts manifest schema");
  }
  if (!validVersion(metadata.version)) throw new Error("invalid biz scripts manifest version");
  if (!/^[0-9a-f]{64}$/.test(String(metadata.baseCompatibilityId || ""))) {
    throw new Error("missing biz scripts base compatibility id");
  }
  var files = fileList(metadata.files, true);
  if (deps.sha256Text(inventoryText(files)) !== metadata.sourceSha256) {
    throw new Error("biz scripts inventory sha256 mismatch");
  }
  return files;
}

function verifyFiles(deps, root, files) {
  files.forEach(function (file) {
    var path = joinPath(root, file.path);
    if (!deps.exists(path) || deps.sha256File(path).toLowerCase() !== file.sha256) {
      throw new Error("biz scripts file integrity mismatch: " + file.path);
    }
  });
}

function readBaseline(deps, scriptDir) {
  var path = joinPath(scriptDir, "biz-script-baseline.json");
  if (!deps.exists(path)) throw new Error("APK business baseline metadata is missing");
  var baseline = JSON.parse(deps.readText(path));
  baseline.files = validateMetadata(baseline, deps);
  baseline.baseFiles = fileList(baseline.baseFiles, false);
  if (deps.sha256Text("autojs-biz-v2\n" + inventoryText(baseline.baseFiles)) !== baseline.baseCompatibilityId) {
    throw new Error("APK base compatibility inventory mismatch");
  }
  verifyFiles(deps, scriptDir, baseline.files);
  verifyFiles(deps, scriptDir, baseline.baseFiles);
  return baseline;
}

function assertCompatible(metadata, baseline, deps) {
  if (!baseline) throw new Error("APK business baseline is unavailable; hot update disabled");
  var files = validateMetadata(metadata, deps);
  if (metadata.baseCompatibilityId !== baseline.baseCompatibilityId) {
    throw new Error("biz scripts APK base compatibility mismatch");
  }
  if (compareVersions(metadata.version, baseline.version) <= 0) {
    throw new Error("biz scripts version is not newer than APK baseline");
  }
  return files;
}

function validateOverlay(deps, root, baseline) {
  var metadata = JSON.parse(deps.readText(joinPath(root, "version.json")));
  metadata.files = assertCompatible(metadata, baseline, deps);
  verifyFiles(deps, root, metadata.files);
  return metadata;
}

function readRejection(deps, root) {
  try { return JSON.parse(deps.readText(joinPath(root, "rejected.json"))); } catch (error) { return null; }
}

function isRejected(metadata, rejection) {
  return !!rejection && metadata.version === rejection.version &&
    metadata.sourceSha256 === rejection.sourceSha256 && metadata.baseCompatibilityId === rejection.baseCompatibilityId;
}

module.exports = {
  joinPath: joinPath, validVersion: validVersion, compareVersions: compareVersions,
  safePath: safePath, readBaseline: readBaseline, assertCompatible: assertCompatible,
  validateOverlay: validateOverlay, verifyFiles: verifyFiles, inventoryText: inventoryText,
  readRejection: readRejection, isRejected: isRejected
};
