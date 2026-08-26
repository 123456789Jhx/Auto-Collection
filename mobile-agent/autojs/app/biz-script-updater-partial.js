function joinPath() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\/+/g, "/");
}

function validateCurrentState(deps, currentDir, validateManifest) {
  var versionPath = joinPath(currentDir, "version.json");
  if (!deps.exists(versionPath)) throw new Error("current biz scripts version metadata is missing");
  var metadata = JSON.parse(deps.readText(versionPath));
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(String(metadata.version || "")) || metadata.channel !== "biz-scripts") {
    throw new Error("current biz scripts metadata is invalid");
  }
  var files = validateManifest({ channel: "biz-scripts", version: metadata.version, files: metadata.files }, metadata.version);
  for (var i = 0; i < files.length; i++) {
    var path = joinPath(currentDir, files[i].path);
    if (!deps.exists(path) || deps.sha256File(path).toLowerCase() !== files[i].sha256) {
      throw new Error("current biz scripts integrity mismatch: " + files[i].path);
    }
  }
  return { metadata: metadata, files: files };
}

function fileMap(files) {
  var map = {};
  (files || []).forEach(function (file) { map[file.path] = file.sha256; });
  return map;
}

function assertPartialBase(currentState, manifest, deltaFiles) {
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(String(manifest.baseVersion || "")) ||
    String(currentState.metadata.version) !== String(manifest.baseVersion)) {
    throw new Error("biz scripts baseVersion does not match current");
  }
  var currentMap = fileMap(currentState.files);
  var mergedMap = fileMap(manifest.files);
  var deltaMap = fileMap(deltaFiles);
  var currentPaths = Object.keys(currentMap).sort();
  if (JSON.stringify(currentPaths) !== JSON.stringify(Object.keys(mergedMap).sort())) {
    throw new Error("current biz scripts file inventory is incomplete");
  }
  currentPaths.forEach(function (path) {
    if (!deltaMap[path] && currentMap[path] !== mergedMap[path]) {
      throw new Error("current biz scripts base file mismatch: " + path);
    }
  });
}

module.exports = { assertPartialBase: assertPartialBase, validateCurrentState: validateCurrentState };
