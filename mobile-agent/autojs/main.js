function getScriptDir() {
  var candidates = [
    "/storage/emulated/0/燎原星火",
    "/sdcard/燎原星火",
    "/storage/emulated/0/Download/燎原星火",
    "/sdcard/Download/燎原星火",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector",
    "/storage/emulated/0/Download/AgriVideoCollector",
    "/sdcard/Download/AgriVideoCollector"
  ];

  function hasRequiredFiles(dir) {
    return dir &&
      files.exists(files.join(dir, "main.module.js")) &&
      files.exists(files.join(dir, "core/accessibility.js"));
  }

  try {
    var cwd = files.cwd();
    if (hasRequiredFiles(cwd)) {
      return cwd;
    }
  } catch (error) {
  }

  try {
    var engine = engines.myEngine();
    var source = engine && engine.getSource && engine.getSource();
    var sourcePath = source && source.toString && source.toString();
    if (sourcePath && sourcePath.indexOf("/") >= 0) {
      var sourceDir = files.dirname(sourcePath);
      if (hasRequiredFiles(sourceDir)) {
        return sourceDir;
      }
    }
  } catch (error2) {
  }

  for (var i = 0; i < candidates.length; i++) {
    if (hasRequiredFiles(candidates[i])) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/燎原星火";
}
var SCRIPT_DIR = getScriptDir();
var createAgentProcessLock = require(files.join(SCRIPT_DIR, "core/agent-process-lock.js")).createAgentProcessLock;
var mainProcessLock = createAgentProcessLock({
  path: files.join(SCRIPT_DIR, ".agent-main.lock"),
  logger: {
    info: function (message) { try { log(message); } catch (error) {} },
    warn: function (message) { try { log(message); } catch (error) {} },
    error: function (message) { try { log(message); } catch (error) {} }
  }
});
if (!mainProcessLock.acquire()) {
  try { toast("Agent主脚本已在运行"); } catch (error) {}
  exit();
}
try {
  events.on("exit", function () { mainProcessLock.release(); });
} catch (error) {
}
var agentEngineIdentity = require(files.join(SCRIPT_DIR, "core/agent-engine-identity.js"));

function hasOtherMainEngine() {
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!agentEngineIdentity.isCurrentEngine(all[i], current) && agentEngineIdentity.isEngineFile(all[i], "main.js")) {
        return true;
      }
    }
  } catch (error) {
  }
  return false;
}

if (hasOtherMainEngine()) {
  try {
    toast("Agent already running");
  } catch (error) {
  }
  exit();
}

require(files.join(SCRIPT_DIR, "main.module.js"));
