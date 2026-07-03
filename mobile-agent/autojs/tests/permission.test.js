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

testSettingsEnabledServiceDoesNotOpenAccessibilitySettings();

console.log("permission tests passed");
