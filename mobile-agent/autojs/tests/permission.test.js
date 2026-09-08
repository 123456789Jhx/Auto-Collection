var assert = require("assert");
var createPermissionManager = require("../core/permission.js").createPermissionManager;

function createLogger(logs) {
  return {
    info: function (message, payload) {
      logs.push({ level: "INFO", message: message, payload: payload });
    },
    warn: function (message, payload) {
      logs.push({ level: "WARN", message: message, payload: payload });
    },
    error: function (message, payload) {
      logs.push({ level: "ERROR", message: message, payload: payload });
    }
  };
}

function testSettingsEnabledServiceDoesNotOpenAccessibilitySettings() {
  var logs = [];
  var startedActivities = [];
  var manager = createPermissionManager({
    runtime: {
      scriptDir: "."
    },
    output: {
      baseDir: "/tmp/base",
      cacheDir: "/tmp/cache"
    },
    task: {}
  }, createLogger(logs), {
    accessibility: {
      setContext: function () {},
      detectAccessibility: function () {
        return {
          enabled: false,
          source: "settings",
          packageName: "com.agri.video.collector",
          enabledServices: "com.agri.video.collector/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher"
        };
      }
    },
    files: {
      exists: function () { return true; },
      createWithDirs: function () {},
      remove: function () {}
    },
    app: {
      startActivity: function (intent) {
        startedActivities.push(intent);
      }
    },
    toast: function () {},
    sleep: function () {}
  });

  var result = manager.ensureAll();

  assert.strictEqual(result, false, "service not bound yet should keep startup blocked");
  assert.strictEqual(startedActivities.length, 0, "settings-backed enabled service must not reopen accessibility settings");
  assert.strictEqual(logs.some(function (item) {
    return item.message.indexOf("暂不可用") >= 0 || item.message.indexOf("绑定暂不可用") >= 0;
  }), true, "diagnostic log should explain the service binding race");
}

function testUnknownAccessibilityStateDoesNotOpenAccessibilitySettings() {
  var logs = [];
  var startedActivities = [];
  var detectCount = 0;
  var manager = createPermissionManager({
    runtime: {
      scriptDir: "."
    },
    output: {
      baseDir: "/tmp/base",
      cacheDir: "/tmp/cache"
    },
    task: {}
  }, createLogger(logs), {
    accessibility: {
      setContext: function () {},
      detectAccessibility: function () {
        detectCount += 1;
        return {
          enabled: false,
          source: "context_unavailable",
          packageName: "",
          enabledServices: ""
        };
      }
    },
    files: {
      exists: function () { return true; },
      createWithDirs: function () {},
      remove: function () {}
    },
    app: {
      startActivity: function (intent) {
        startedActivities.push(intent);
      }
    },
    toast: function () {},
    sleep: function () {}
  });

  var result = manager.ensureAll();

  assert.strictEqual(result, false, "unknown accessibility state should block startup");
  assert.strictEqual(startedActivities.length, 0, "unknown accessibility state must not open system settings");
  assert(detectCount > 1, "unknown accessibility state should be rechecked before failing");
  assert.strictEqual(logs.some(function (item) {
    return item.message.indexOf("状态无法确认") >= 0;
  }), true, "diagnostic log should explain the unknown accessibility state");
}

function testCapturePermissionRejectsReentrantRequest() {
  var logs = [];
  var requestCount = 0;
  var nestedResult = null;
  var manager;
  manager = createPermissionManager({
    runtime: { scriptDir: "." },
    output: { baseDir: "/tmp/base", cacheDir: "/tmp/cache" },
    task: {}
  }, createLogger(logs), {
    accessibility: {
      setContext: function () {},
      detectAccessibility: function () { return { enabled: true, source: "test" }; }
    },
    files: {
      exists: function () { return true; },
      createWithDirs: function () {},
      remove: function () {}
    },
    app: { startActivity: function () {} },
    requestScreenCapture: function () {
      requestCount += 1;
      nestedResult = manager.ensureCapturePermission();
      return true;
    },
    toast: function () {},
    sleep: function () {}
  });

  assert.strictEqual(manager.ensureCapturePermission(), true);
  assert.strictEqual(requestCount, 1, "重入期间不得再次调用 requestScreenCapture");
  assert.strictEqual(nestedResult, false, "重入调用应直接拒绝并等待外层请求完成");
  assert.strictEqual(logs.some(function (item) {
    return item.message.indexOf("截图权限请求进行中") >= 0;
  }), true, "重入应留下明确诊断日志");
}

testSettingsEnabledServiceDoesNotOpenAccessibilitySettings();
testUnknownAccessibilityStateDoesNotOpenAccessibilitySettings();
testCapturePermissionRejectsReentrantRequest();

console.log("permission tests passed");
