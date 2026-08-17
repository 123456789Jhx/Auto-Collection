function engineSourceText(engine) {
  try {
    var source = engine && engine.getSource && engine.getSource();
    var sourceFile = source && source.getFile && source.getFile();
    if (sourceFile) {
      var canonicalPath = sourceFile.getCanonicalPath && sourceFile.getCanonicalPath();
      if (canonicalPath) return String(canonicalPath);
      var absolutePath = sourceFile.getAbsolutePath && sourceFile.getAbsolutePath();
      if (absolutePath) return String(absolutePath);
      var path = sourceFile.getPath && sourceFile.getPath();
      if (path) return String(path);
    }
    return source && source.toString ? source.toString() : "";
  } catch (error) {
    return "";
  }
}

function isDestroyed(engine) {
  try {
    if (!engine) return true;
    if (typeof engine.isDestroyed === "function") return !!engine.isDestroyed();
    if (engine.isDestroyed !== undefined) return !!engine.isDestroyed;
  } catch (error) {
    return true;
  }
  return false;
}

function isCurrentEngine(engine, current) {
  if (!engine || !current) return false;
  try {
    return engine === current || (
      engine.id !== undefined &&
      current.id !== undefined &&
      engine.id === current.id
    );
  } catch (error) {
    return false;
  }
}

function isEngineFileSource(sourceText, fileName) {
  var normalized = String(sourceText || "").replace(/\\/g, "/");
  return normalized === fileName || normalized.slice(-(fileName.length + 1)) === "/" + fileName;
}

function isEngineFile(engine, fileName) {
  return !isDestroyed(engine) && isEngineFileSource(engineSourceText(engine), fileName);
}

module.exports = {
  engineSourceText: engineSourceText,
  isCurrentEngine: isCurrentEngine,
  isEngineFileSource: isEngineFileSource,
  isEngineFile: isEngineFile
};
