"ui";

importClass(android.content.Intent);
importClass(android.net.Uri);
importClass(android.os.Build);
importClass(android.provider.Settings);

var TEXT = {
  title: "\u519c\u4e1a\u91c7\u96c6\u52a9\u624b",
  accessibility: "\u65e0\u969c\u788d",
  overlay: "\u60ac\u6d6e\u7a97",
  mainScript: "\u91c7\u96c6\u811a\u672c",
  watchdog: "\u5b88\u62a4\u811a\u672c",
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
  startMain: "\u542f\u52a8\u91c7\u96c6\u811a\u672c",
  stopMain: "\u505c\u6b62\u91c7\u96c6\u811a\u672c",
  startWatchdog: "\u542f\u52a8\u5b88\u62a4\u811a\u672c",
  stopAll: "\u5173\u95ed\u5168\u90e8\u811a\u672c",
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
  permissionMissing: "\u8bf7\u5148\u6253\u5f00\u7f3a\u5931\u7684\u6743\u9650"
};

function getScriptDir() {
  var candidates = [
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector",
    "/storage/emulated/0/Download/AgriVideoCollector",
    "/sdcard/Download/AgriVideoCollector"
  ];

  try {
    var cwd = files.cwd();
    if (cwd && files.exists(files.join(cwd, "project.json"))) {
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
    if (files.exists(files.join(candidates[i], "project.json"))) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/AgriVideoCollector";
}

var SCRIPT_DIR = getScriptDir();
var WATCHDOG_PATH = files.join(SCRIPT_DIR, "watchdog.js");
var MAIN_PATH = files.join(SCRIPT_DIR, "main.js");
var CONFIG_PATH = files.join(SCRIPT_DIR, "config.js");

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

function statusText(value) {
  return value ? TEXT.enabled : TEXT.disabled;
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
  var accessibilityEnabled = !!auto.service;
  var overlayEnabled = canDrawOverlays();
  var watchdogRunning = isRunning("watchdog.js");
  var mainRunning = isRunning("main.js");

  ui.run(function () {
    ui.version.setText(appInfo.version || "-");
    ui.deviceId.setText(deviceInfo.deviceId || "-");
    ui.backend.setText(uploadInfo.baseUrl || uploadInfo.url || "-");
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

function checkPermissions() {
  var accessibilityEnabled = !!auto.service;
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

ui.layout(
  <vertical bg="#f6f8fb" padding="22">
    <text id="title" text="Agri Collector" textSize="24sp" textStyle="bold" textColor="#202124" gravity="center" />

    <vertical bg="#ffffff" marginTop="18" padding="16">
      <horizontal>
        <text id="accessibilityLabel" text="Accessibility" w="90" textColor="#5f6368" />
        <text id="accessibilityStatus" text="-" textStyle="bold" />
      </horizontal>
      <horizontal marginTop="8">
        <text id="overlayLabel" text="Overlay" w="90" textColor="#5f6368" />
        <text id="overlayStatus" text="-" textStyle="bold" />
      </horizontal>
      <horizontal marginTop="8">
        <text id="mainScriptLabel" text="Main" w="90" textColor="#5f6368" />
        <text id="mainStatus" text="-" textStyle="bold" />
      </horizontal>
      <horizontal marginTop="8">
        <text id="watchdogLabel" text="Watchdog" w="90" textColor="#5f6368" />
        <text id="watchdogStatus" text="-" textStyle="bold" />
      </horizontal>
    </vertical>

    <button id="checkPermission" text="Check Permissions" marginTop="18" h="52" />
    <button id="openAccessibility" text="Open Accessibility" marginTop="10" h="52" />
    <button id="openOverlay" text="Open Overlay" marginTop="10" h="52" />
    <button id="startMain" text="Start Main" marginTop="18" h="56" />
    <button id="stopMain" text="Stop Main" marginTop="10" h="52" />

    <horizontal marginTop="10">
      <button id="startWatchdog" text="Start Watchdog" w="0" layout_weight="1" h="48" />
      <button id="stopAll" text="Stop All" w="0" layout_weight="1" h="48" marginLeft="8" />
    </horizontal>

    <button id="refresh" text="Refresh" marginTop="10" h="48" />

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
ui.accessibilityLabel.setText(TEXT.accessibility);
ui.overlayLabel.setText(TEXT.overlay);
ui.mainScriptLabel.setText(TEXT.mainScript);
ui.watchdogLabel.setText(TEXT.watchdog);
ui.checkPermission.setText(TEXT.checkPermission);
ui.openAccessibility.setText(TEXT.openAccessibility);
ui.openOverlay.setText(TEXT.openOverlay);
ui.startMain.setText(TEXT.startMain);
ui.stopMain.setText(TEXT.stopMain);
ui.startWatchdog.setText(TEXT.startWatchdog);
ui.stopAll.setText(TEXT.stopAll);
ui.refresh.setText(TEXT.refresh);
ui.versionLabel.setText(TEXT.version);
ui.deviceLabel.setText(TEXT.device);
ui.backendLabel.setText(TEXT.backend);
ui.scriptDirLabel.setText(TEXT.scriptDir);

ui.checkPermission.click(function () {
  checkPermissions();
});

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

ui.startMain.click(function () {
  startScript(MAIN_PATH, TEXT.mainScript);
});

ui.stopMain.click(function () {
  var mainCount = stopEngines("main.js");
  toast(TEXT.stoppedCountPrefix + mainCount + TEXT.stoppedCountSuffix);
  refreshStatusDelayed();
});

ui.startWatchdog.click(function () {
  startScript(WATCHDOG_PATH, TEXT.watchdog);
});

ui.stopAll.click(function () {
  var watchdogCount = stopEngines("watchdog.js");
  var mainCount = stopEngines("main.js");
  toast(TEXT.stoppedCountPrefix + (watchdogCount + mainCount) + TEXT.stoppedCountSuffix);
  refreshStatusDelayed();
});

ui.refresh.click(function () {
  refreshStatus();
  toast(TEXT.refreshed);
});

refreshStatus();
setInterval(refreshStatus, 3000);
