"auto";

function getScriptDir() {
  var candidates = [
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector",
    "/storage/emulated/0/Download/AgriVideoCollector",
    "/sdcard/Download/AgriVideoCollector"
  ];

  try {
    var cwd = files.cwd();
    if (cwd && files.exists(files.join(cwd, "main.module.js"))) {
      return cwd;
    }
  } catch (error) {
  }

  try {
    var engine = engines.myEngine();
    var source = engine && engine.getSource && engine.getSource();
    var sourcePath = source && source.toString && source.toString();
    if (sourcePath && sourcePath.indexOf("/") >= 0) {
      return files.dirname(sourcePath);
    }
  } catch (error2) {
  }

  for (var i = 0; i < candidates.length; i++) {
    if (files.exists(files.join(candidates[i], "main.module.js"))) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/AgriVideoCollector";
}

var SCRIPT_DIR = getScriptDir();

function engineSourceText(engine) {
  try {
    var source = engine && engine.getSource && engine.getSource();
    return source && source.toString ? source.toString() : "";
  } catch (error) {
    return "";
  }
}

function isCurrentEngine(engine, current) {
  if (!engine || !current) {
    return false;
  }
  try {
    if (engine === current) {
      return true;
    }
    if (engine.id !== undefined && current.id !== undefined && engine.id === current.id) {
      return true;
    }
  } catch (error) {
  }
  return false;
}

function isMainEngine(engine) {
  var sourceText = engineSourceText(engine);
  return sourceText.indexOf("/main.js") >= 0 || sourceText.indexOf("\\main.js") >= 0;
}

function hasOtherMainEngine() {
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!isCurrentEngine(all[i], current) && isMainEngine(all[i])) {
        return true;
      }
    }
  } catch (error) {
  }
  return false;
}

if (hasOtherMainEngine()) {
  log("Agri collector main is already running, skip duplicate start.");
  toast("Agri collector is already running");
  exit();
} else {
  require(files.join(SCRIPT_DIR, "main.module.js"));
}
