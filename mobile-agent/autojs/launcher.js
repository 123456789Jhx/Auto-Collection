"ui";

importClass(android.content.Intent);
importClass(android.net.Uri);
importClass(android.os.Build);
importClass(android.provider.Settings);

var TEXT = {
  title: "\u71ce\u539f\u661f\u706b\u6d4b\u8bd5",
  accessibility: "\u65e0\u969c\u788d",
  overlay: "\u60ac\u6d6e\u7a97",
  agentProgram: "Agent \u4e3b\u7a0b\u5e8f",
  businessTask: "\u4e1a\u52a1\u4efb\u52a1",
  baseConnection: "\u5e95\u5ea7\u8fde\u63a5",
  baseLastSuccess: "\u6700\u8fd1\u6210\u529f\u4e0a\u62a5",
  agentHeartbeat: "Agent \u5fc3\u8df3",
  baseOnline: "\u5e95\u5ea7\u8fde\u63a5\u6b63\u5e38",
  baseReconnecting: "\u6b63\u5728\u8fde\u63a5\u7ba1\u7406\u540e\u53f0",
  baseOffline: "\u5e95\u5ea7\u8fde\u63a5\u5f02\u5e38",
  agentConnected: "\u5df2\u8fde\u63a5",
  agentDisconnected: "\u672a\u8fde\u63a5",
  businessUnknown: "\u672a\u77e5",
  businessIdle: "\u5f85\u547d",
  businessRunning: "\u8fd0\u884c\u4e2d",
  businessPaused: "\u5df2\u6682\u505c",
  businessCompleted: "\u5df2\u5b8c\u6210",
  businessError: "\u5f02\u5e38",
  noSuccessfulReport: "\u6682\u65e0",
  networkTimeout: "\u7f51\u7edc\u8d85\u65f6",
  identityFailed: "\u8eab\u4efd\u6821\u9a8c\u5931\u8d25",
  backendFailed: "\u540e\u53f0\u5f02\u5e38",
  networkFailed: "\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38",
  unknownFailed: "\u672a\u77e5\u9519\u8bef",
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
var agentEngineIdentity = require(files.join(SCRIPT_DIR, "core/agent-engine-identity.js"));
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

function findEngines(fileName) {
  var result = [];
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!agentEngineIdentity.isCurrentEngine(all[i], current) && agentEngineIdentity.isEngineFile(all[i], fileName)) {
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

function stopDuplicateLaunchers() {
  var count = stopEngines("launcher.js");
  if (count > 0) {
    try {
      console.log("launcher stopped duplicate instances: " + count);
    } catch (error) {
    }
  }
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

function readConnectionStore(name) {
  try {
    var store = storages.create(name);
    return {
      startedAt: Number(store.get("startedAt", 0) || 0),
      lastAttemptAt: Number(store.get("lastAttemptAt", 0) || 0),
      lastSuccessAt: Number(store.get("lastSuccessAt", 0) || 0),
      lastFailureAt: Number(store.get("lastFailureAt", 0) || 0),
      lastResult: String(store.get("lastResult", "") || ""),
      lastStatus: String(store.get("lastStatus", "") || ""),
      lastMessage: String(store.get("lastMessage", "") || ""),
      currentTaskType: String(store.get("currentTaskType", "") || ""),
      httpStatus: Number(store.get("httpStatus", 0) || 0),
      failureKind: String(store.get("failureKind", "") || ""),
      errorType: String(store.get("errorType", "") || ""),
      offlineThresholdSeconds: Number(store.get("offlineThresholdSeconds", 15) || 15)
    };
  } catch (error) {
    return {};
  }
}

function formatStatusTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString() : TEXT.noSuccessfulReport;
}

function readableFailure(kind) {
  if (kind === "timeout") return TEXT.networkTimeout;
  if (kind === "identity") return TEXT.identityFailed;
  if (kind === "backend" || kind === "http") return TEXT.backendFailed;
  if (kind === "network") return TEXT.networkFailed;
  return TEXT.unknownFailed;
}

function baseConnectionView(state) {
  var now = Date.now();
  var thresholdSeconds = Math.max(15, Math.min(150, Number(state.offlineThresholdSeconds || 15)));
  var referenceAt = Math.max(state.lastSuccessAt || 0, state.startedAt || now);
  var elapsedSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
  if (state.lastSuccessAt >= (state.startedAt || 0) && elapsedSeconds <= 6) {
    return { text: TEXT.baseOnline, color: "#137333", reason: "" };
  }
  if (elapsedSeconds < thresholdSeconds) {
    return {
      text: TEXT.baseReconnecting + "\uff08\u5df2\u7b49\u5f85 " + elapsedSeconds + " \u79d2\uff09",
      color: "#b06000",
      reason: state.lastResult === "failure" ? readableFailure(state.failureKind) : ""
    };
  }
  return {
    text: TEXT.baseOffline + "\uff08\u5df2\u8d85\u8fc7\u8bbe\u5907\u8bbe\u7f6e\u7684 " + thresholdSeconds + " \u79d2\uff09",
    color: "#b3261e",
    reason: state.lastResult === "failure" ? readableFailure(state.failureKind) : TEXT.networkTimeout
  };
}

function agentHeartbeatView(state, mainRunning) {
  var connected = mainRunning && state.lastSuccessAt && Date.now() - state.lastSuccessAt <= 65000;
  return {
    connected: connected,
    text: connected ? TEXT.agentConnected : TEXT.agentDisconnected,
    color: connected ? "#137333" : "#5f6368"
  };
}

function businessTaskView(agentConnected, agentState) {
  if (!agentConnected) return { text: TEXT.businessUnknown, color: "#5f6368" };
  if (!agentState.currentTaskType) return { text: TEXT.businessIdle, color: "#5f6368" };
  var status = String(agentState.lastStatus || "idle").toLowerCase();
  if (status === "running") return { text: TEXT.businessRunning, color: "#137333" };
  if (status === "paused") return { text: TEXT.businessPaused, color: "#b06000" };
  if (status === "completed" || status === "success") return { text: TEXT.businessCompleted, color: "#137333" };
  if (status === "error" || status === "failed") return { text: TEXT.businessError, color: "#b3261e" };
  return { text: TEXT.businessIdle, color: "#5f6368" };
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
  var baseConnection = readConnectionStore("AgriVideoCollectorBaseConnection");
  var agentConnection = readConnectionStore("AgriVideoCollectorAgentConnection");
  var baseView = baseConnectionView(baseConnection);
  var agentView = agentHeartbeatView(agentConnection, mainRunning);
  var businessView = businessTaskView(agentView.connected, agentConnection);

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
    ui.mainStatus.setText(businessView.text);
    ui.mainStatus.setTextColor(colors.parseColor(businessView.color));
    ui.baseConnectionStatus.setText(baseView.text);
    ui.baseConnectionStatus.setTextColor(colors.parseColor(baseView.color));
    ui.baseLastSuccess.setText(formatStatusTime(baseConnection.lastSuccessAt));
    ui.agentHeartbeatStatus.setText(agentView.text);
    ui.agentHeartbeatStatus.setTextColor(colors.parseColor(agentView.color));
    var detailParts = [];
    if (baseView.reason) detailParts.push(baseView.reason);
    if (baseConnection.httpStatus) detailParts.push("HTTP " + baseConnection.httpStatus);
    if (baseConnection.errorType) detailParts.push(baseConnection.errorType);
    if (baseConnection.lastAttemptAt) detailParts.push("最近尝试 " + formatStatusTime(baseConnection.lastAttemptAt));
    ui.baseConnectionDetail.setText(detailParts.join(" · "));
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
        startScript(MAIN_PATH, TEXT.agentProgram);
      }
    });
  }
  setMessage(TEXT.managedStart);
}

function stopAllScripts() {
  var watchdogCount = stopEngines("watchdog.js");
  var mainCount = stopEngines("main.js");
  try {
    storages.create("AgriVideoCollectorWatchdog").remove("lastBeat");
  } catch (error) {
  }
  toast(TEXT.stoppedCountPrefix + (watchdogCount + mainCount) + TEXT.stoppedCountSuffix);
  setMessage("\u5df2\u505c\u6b62\u8fd0\u884c");
  refreshStatusDelayed();
}

stopDuplicateLaunchers();

ui.layout(
  <scroll>
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
        <text id="baseConnectionLabel" text="底座连接" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="baseConnectionStatus" text="-" textStyle="bold" textSize="16sp" />
      </horizontal>
      <horizontal marginTop="6" gravity="center_vertical">
        <text id="baseLastSuccessLabel" text="最近成功上报" w="150" textColor="#5f6368" textSize="14sp" />
        <text id="baseLastSuccess" text="-" textColor="#202124" textSize="14sp" />
      </horizontal>
      <text id="baseConnectionDetail" text="" textColor="#6b7280" textSize="11sp" marginTop="4" />
      <horizontal marginTop="10" gravity="center_vertical">
        <text id="agentHeartbeatLabel" text="Agent 心跳" w="150" textColor="#5f6368" textSize="16sp" />
        <text id="agentHeartbeatStatus" text="-" textStyle="bold" textSize="16sp" />
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
  </scroll>
);

ui.title.setText(TEXT.title);
ui.helpText.setText(TEXT.helpText);
ui.accessibilityLabel.setText(TEXT.accessibility);
ui.overlayLabel.setText(TEXT.overlay);
ui.mainScriptLabel.setText(TEXT.businessTask);
ui.baseConnectionLabel.setText(TEXT.baseConnection);
ui.baseLastSuccessLabel.setText(TEXT.baseLastSuccess);
ui.agentHeartbeatLabel.setText(TEXT.agentHeartbeat);
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
