"ui";

importClass(android.content.Intent);
importClass(android.net.Uri);
importClass(android.os.Build);
importClass(android.provider.Settings);

var TEXT = {
  title: "\u71ce\u539f\u661f\u706b\u6d4b\u8bd5",
  accessibility: "\u65e0\u969c\u788d",
  overlay: "\u60ac\u6d6e\u7a97",
  mainScript: "\u91c7\u96c6\u811a\u672c",
  watchdog: "\u5b88\u62a4\u811a\u672c",
  ready: "\u53ef\u4ee5\u4f7f\u7528",
  needSetup: "\u9700\u8981\u6388\u6743",
  serviceRunning: "\u6b63\u5728\u8fd0\u884c",
  serviceStopped: "\u672a\u542f\u52a8",
  oneTapStart: "\u4e00\u952e\u542f\u52a8",
  oneTapStop: "\u505c\u6b62\u8fd0\u884c",
  helpText: "\u65e5\u5e38\u4f7f\u7528\u53ea\u9700\u70b9\u201c\u4e00\u952e\u542f\u52a8\u201d\u3002\u82e5\u63d0\u793a\u9700\u8981\u6388\u6743\uff0c\u518d\u70b9\u4e0b\u9762\u4e24\u4e2a\u8bbe\u7f6e\u6309\u94ae\u3002",
  version: "\u7248\u672c",
  device: "\u8bbe\u5907",
  backend: "\u540e\u53f0",
  scriptDir: "\u811a\u672c\u76ee\u5f55",
  enabled: "\u5df2\u5f00\u542f",
  disabled: "\u672a\u5f00\u542f",
  running: "\u8fd0\u884c\u4e2d",
  stopped: "\u672a\u8fd0\u884c",
  openAccessibility: "\u6253\u5f00\u65e0\u969c\u788d\u8bbe\u7f6e",
  openOverlay: "\u6253\u5f00\u60ac\u6d6e\u7a97\u8bbe\u7f6e",
  checkPermission: "\u68c0\u67e5\u6743\u9650",
  refresh: "\u5237\u65b0\u72b6\u6001",
  recentMessage: "\u6700\u8fd1\u72b6\u6001",
  cannotOpenSettings: "\u65e0\u6cd5\u6253\u5f00\u8bbe\u7f6e\u9875",
  noOverlayNeeded: "\u5f53\u524d\u7cfb\u7edf\u65e0\u9700\u5355\u72ec\u6388\u6743\u60ac\u6d6e\u7a97",
  missingScript: "\u627e\u4e0d\u5230",
  started: "\u5df2\u542f\u52a8",
  startFailed: "\u542f\u52a8\u5931\u8d25",
  stoppedCountPrefix: "\u5df2\u505c\u6b62 ",
  stoppedCountSuffix: " \u4e2a\u811a\u672c",
  refreshed: "\u72b6\u6001\u5df2\u5237\u65b0",
  permissionOk: "\u6743\u9650\u68c0\u67e5\u5b8c\u6210",
  permissionMissing: "\u8bf7\u5148\u6253\u5f00\u7f3a\u5931\u7684\u6743\u9650",
  managedStart: "\u5df2\u81ea\u52a8\u6258\u7ba1\u542f\u52a8"
};

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
      files.exists(files.join(dir, "project.json")) &&
      files.exists(files.join(dir, "launcher.js")) &&
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
var WATCHDOG_PATH = files.join(SCRIPT_DIR, "watchdog.js");
var MAIN_PATH = files.join(SCRIPT_DIR, "main.js");
var CONFIG_PATH = files.join(SCRIPT_DIR, "config.js");
var accessibility = require(files.join(SCRIPT_DIR, "core/accessibility.js"));
if (accessibility.setContext) {
  accessibility.setContext(context);
}

function loadConfig() {
  try {
    return require(CONFIG_PATH);
  } catch (error) {
    return {};
  }
}

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

function isEngineFile(engine, fileName) {
  var sourceText = engineSourceText(engine);
  return sourceText.indexOf("/" + fileName) >= 0 || sourceText.indexOf("\\" + fileName) >= 0;
}

function findEngines(fileName) {
  var result = [];
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!isCurrentEngine(all[i], current) && isEngineFile(all[i], fileName)) {
        result.push(all[i]);
      }
    }
  } catch (error) {
  }
  return result;
}

function isRunning(fileName) {
  return findEngines(fileName).length > 0;
}

function stopEngines(fileName) {
  var list = findEngines(fileName);
  for (var i = 0; i < list.length; i++) {
    try {
      list[i].forceStop();
    } catch (error) {
    }
  }
  return list.length;
}

function canDrawOverlays() {
  try {
    if (typeof floaty !== "undefined" && floaty.checkPermission) {
      return !!floaty.checkPermission();
    }
  } catch (error) {
  }
  try {
    if (Build.VERSION.SDK_INT >= 23) {
      return Settings.canDrawOverlays(context);
    }
    return true;
  } catch (error2) {
    return false;
  }
}

function isAccessibilityEnabled() {
  return accessibility.isAccessibilityEnabled();
}

function statusText(value) {
  return value ? TEXT.enabled : TEXT.disabled;
}

function backendStatusText(uploadInfo) {
  if (!uploadInfo || uploadInfo.enabled === false) {
    return TEXT.disabled;
  }
  return TEXT.enabled;
}

function setMessage(message) {
  ui.run(function () {
    ui.message.setText(String(message || ""));
  });
}

function startScript(path, label) {
  if (!files.exists(path)) {
    toast(TEXT.missingScript + label);
    setMessage(TEXT.missingScript + ": " + path);
    refreshStatus();
    return false;
  }
  try {
    engines.execScriptFile(path);
    toast(label + TEXT.started);
    setMessage(label + TEXT.started);
    refreshStatusDelayed();
    return true;
  } catch (error) {
    toast(label + TEXT.startFailed);
    setMessage(label + TEXT.startFailed + ": " + error);
    return false;
  }
}

function openIntent(intent) {
  try {
    app.startActivity(intent);
  } catch (error) {
    toast(TEXT.cannotOpenSettings);
    setMessage(TEXT.cannotOpenSettings + ": " + error);
  }
}

function refreshStatusDelayed() {
  threads.start(function () {
    sleep(800);
    refreshStatus();
  });
}

function refreshStatus() {
  var config = loadConfig();
  var appInfo = config.app || {};
  var deviceInfo = config.device || {};
  var uploadInfo = config.upload || {};
  var accessibilityEnabled = isAccessibilityEnabled();
  var overlayEnabled = canDrawOverlays();
  var watchdogRunning = isRunning("watchdog.js");
  var mainRunning = isRunning("main.js");

  ui.run(function () {
    var ready = accessibilityEnabled && overlayEnabled;
    var running = watchdogRunning || mainRunning;
    ui.serviceStatus.setText(running ? TEXT.serviceRunning : TEXT.serviceStopped);
    ui.serviceStatus.setTextColor(colors.parseColor(running ? "#137333" : "#5f6368"));
    ui.readyStatus.setText(ready ? TEXT.ready : TEXT.needSetup);
    ui.readyStatus.setTextColor(colors.parseColor(ready ? "#137333" : "#b3261e"));
    ui.version.setText(appInfo.version || "-");
    ui.deviceId.setText(readRuntimeDeviceId() || deviceInfo.deviceId || "-");
    ui.backend.setText(backendStatusText(uploadInfo));
    ui.scriptDirValue.setText(SCRIPT_DIR);
    ui.accessibilityStatus.setText(statusText(accessibilityEnabled));
    ui.accessibilityStatus.setTextColor(colors.parseColor(accessibilityEnabled ? "#137333" : "#b3261e"));
    ui.overlayStatus.setText(statusText(overlayEnabled));
    ui.overlayStatus.setTextColor(colors.parseColor(overlayEnabled ? "#137333" : "#b3261e"));
    ui.watchdogStatus.setText(watchdogRunning ? TEXT.running : TEXT.stopped);
    ui.watchdogStatus.setTextColor(colors.parseColor(watchdogRunning ? "#137333" : "#5f6368"));
    ui.mainStatus.setText(mainRunning ? TEXT.running : TEXT.stopped);
    ui.mainStatus.setTextColor(colors.parseColor(mainRunning ? "#137333" : "#5f6368"));
  });
}

function readRuntimeDeviceId() {
  try {
    return storages.create("AgriVideoCollectorDevice").get("deviceId", "");
  } catch (error) {
    return "";
  }
}

function checkPermissions() {
  var accessibilityEnabled = isAccessibilityEnabled();
  var overlayEnabled = canDrawOverlays();
  refreshStatus();
  if (accessibilityEnabled && overlayEnabled) {
    toast(TEXT.permissionOk);
    setMessage(TEXT.permissionOk);
  } else {
    toast(TEXT.permissionMissing);
    setMessage(TEXT.permissionMissing);
  }
}

function ensureManagedRuntime() {
  var accessibilityEnabled = isAccessibilityEnabled();
  var overlayEnabled = canDrawOverlays();
  if (!accessibilityEnabled || !overlayEnabled) {
    return;
  }
  if (!isRunning("watchdog.js")) {
    startScript(WATCHDOG_PATH, TEXT.watchdog);
  }
  if (!isRunning("main.js")) {
    threads.start(function () {
      sleep(1200);
      if (!isRunning("main.js")) {
        startScript(MAIN_PATH, TEXT.mainScript);
      }
    });
  }
  setMessage(TEXT.managedStart);
}

function stopAllScripts() {
  var watchdogCount = stopEngines("watchdog.js");
  var mainCount = stopEngines("main.js");
  toast(TEXT.stoppedCountPrefix + (watchdogCount + mainCount) + TEXT.stoppedCountSuffix);
  setMessage("\u5df2\u505c\u6b62\u8fd0\u884c");
  refreshStatusDelayed();
}

ui.layout(
  <vertical bg="#f6f8fb" padding="24">
    <text id="title" text="燎原星火" textSize="30sp" textStyle="bold" textColor="#202124" gravity="center" />
    <text id="helpText" text="" textSize="16sp" textColor="#5f6368" gravity="center" marginTop="12" />

    <vertical bg="#ffffff" marginTop="22" padding="20">
      <horizontal gravity="center_vertical">
        <text text="运行状态" w="150" textColor="#5f6368" textSize="18sp" />
        <text id="serviceStatus" text="-" textStyle="bold" textSize="20sp" />
      </horizontal>
      <horizontal marginTop="14" gravity="center_vertical">
        <text text="授权状态" w="150" textColor="#5f6368" textSize="18sp" />
        <text id="readyStatus" text="-" textStyle="bold" textSize="20sp" />
      </horizontal>
      <horizontal marginTop="14" gravity="center_vertical">
        <text id="accessibilityLabel" text="无障碍" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="accessibilityStatus" text="-" textStyle="bold" textSize="16sp" />
      </horizontal>
      <horizontal marginTop="10" gravity="center_vertical">
        <text id="overlayLabel" text="悬浮窗" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="overlayStatus" text="-" textStyle="bold" textSize="16sp" />
      </horizontal>
      <horizontal marginTop="10" gravity="center_vertical">
        <text id="mainScriptLabel" text="采集脚本" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="mainStatus" text="-" textStyle="bold" textSize="16sp" />
      </horizontal>
      <horizontal marginTop="10" gravity="center_vertical">
        <text id="watchdogLabel" text="守护脚本" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="watchdogStatus" text="-" textStyle="bold" textSize="16sp" />
      </horizontal>
    </vertical>

    <horizontal marginTop="24">
      <button id="oneTapStart" text="一键启动" w="0" layout_weight="1" h="72" textSize="22sp" />
      <button id="oneTapStop" text="停止运行" w="0" layout_weight="1" h="72" textSize="22sp" marginLeft="10" />
    </horizontal>

    <horizontal marginTop="14">
      <button id="openAccessibility" text="打开无障碍设置" w="0" layout_weight="1" h="62" textSize="16sp" />
      <button id="openOverlay" text="打开悬浮窗设置" w="0" layout_weight="1" h="62" textSize="16sp" marginLeft="10" />
    </horizontal>

    <vertical bg="#ffffff" marginTop="16" padding="12">
      <horizontal>
        <text id="versionLabel" text="Version" w="76" textColor="#5f6368" textSize="12sp" />
        <text id="version" text="-" textColor="#202124" textSize="12sp" />
      </horizontal>
      <horizontal marginTop="4">
        <text id="deviceLabel" text="Device" w="76" textColor="#5f6368" textSize="12sp" />
        <text id="deviceId" text="-" textColor="#202124" textSize="12sp" />
      </horizontal>
      <horizontal marginTop="4">
        <text id="backendLabel" text="Backend" w="76" textColor="#5f6368" textSize="12sp" />
        <text id="backend" text="-" textColor="#202124" textSize="12sp" />
      </horizontal>
      <horizontal marginTop="4">
        <text id="scriptDirLabel" text="Dir" w="76" textColor="#5f6368" textSize="12sp" />
        <text id="scriptDirValue" text="-" textColor="#202124" textSize="10sp" />
      </horizontal>
      <text id="message" text="" textSize="11sp" textColor="#5f6368" marginTop="6" />
    </vertical>
  </vertical>
);

ui.title.setText(TEXT.title);
ui.helpText.setText(TEXT.helpText);
ui.accessibilityLabel.setText(TEXT.accessibility);
ui.overlayLabel.setText(TEXT.overlay);
ui.mainScriptLabel.setText(TEXT.mainScript);
ui.watchdogLabel.setText(TEXT.watchdog);
ui.openAccessibility.setText(TEXT.openAccessibility);
ui.openOverlay.setText(TEXT.openOverlay);
ui.oneTapStart.setText(TEXT.oneTapStart);
ui.oneTapStop.setText(TEXT.oneTapStop);
ui.versionLabel.setText(TEXT.version);
ui.deviceLabel.setText(TEXT.device);
ui.backendLabel.setText(TEXT.backend);
ui.scriptDirLabel.setText(TEXT.scriptDir);

ui.openAccessibility.click(function () {
  openIntent(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
});

ui.openOverlay.click(function () {
  if (Build.VERSION.SDK_INT >= 23) {
    openIntent(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + context.getPackageName())));
  } else {
    toast(TEXT.noOverlayNeeded);
  }
});

ui.oneTapStart.click(function () {
  ensureManagedRuntime();
});
ui.oneTapStop.click(function () {
  stopAllScripts();
});

refreshStatus();
setInterval(refreshStatus, 3000);
