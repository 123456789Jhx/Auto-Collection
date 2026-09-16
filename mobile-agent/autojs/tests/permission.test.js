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

// 真机主线程同步调用 requestScreenCapture 会冻结事件分发，导致系统授权弹窗
// 点不动。这里锁定「子线程发起 + 主线程轮询等待」的行为。
function testCapturePermissionRunsInWorkerThread() {
  var grantedValues = [true, false];
  grantedValues.forEach(function (grantedValue) {
    var logs = [];
    var requestCount = 0;
    var manager = createPermissionManager({
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
      // 模拟 AutoJS threads.start：同步跑完函数体，代表子线程已执行。
      threads: {
        start: function (runner) {
          runner();
          return { interrupt: function () {} };
        }
      },
      requestScreenCapture: function () {
        requestCount += 1;
        return grantedValue;
      },
      toast: function () {},
      sleep: function () {}
    });

    assert.strictEqual(manager.ensureCapturePermission(), grantedValue,
      "应透传子线程里的授权结果");
    assert.strictEqual(requestCount, 1, "只能发起一次截图权限请求");
    assert(logs.some(function (item) {
      return item.message.indexOf("等待用户在系统弹窗确认") >= 0;
    }), "应留下等待用户确认的诊断日志");
  });
}

function testCapturePermissionTimeoutDoesNotHang() {
  var logs = [];
  var interruptCount = 0;
  var manager = createPermissionManager({
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
    // 子线程永不返回，模拟用户始终没点系统弹窗。
    threads: {
      start: function () {
        return {
          interrupt: function () { interruptCount += 1; }
        };
      }
    },
    requestScreenCapture: function () { return true; },
    toast: function () {},
    sleep: function () {}
  });

  assert.strictEqual(manager.ensureCapturePermission(), false, "用户未处理弹窗时应失败而不是一直卡住");
  assert(logs.some(function (item) {
    return item.message.indexOf("用户未处理系统授权弹窗") >= 0;
  }), "超时应留下明确诊断日志");
}

// MIUI 会拦截「后台弹出界面」，导致后台发起的授权弹窗能显示但点不动。
// 锁定申请截图权限前先把自身 App 拉回前台的行为。
function testCapturePermissionBringsSelfToForeground() {
  var logs = [];
  var launched = [];
  var manager = createPermissionManager({
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
    app: {
      startActivity: function () {},
      launchPackage: function (packageName) { launched.push(packageName); }
    },
    requestScreenCapture: function () { return true; },
    toast: function () {},
    sleep: function () {}
  });

  assert.strictEqual(manager.ensureCapturePermission(), true, "授权成功应返回 true");
  assert.deepStrictEqual(launched, ["com.agri.video.collector"],
    "申请截图权限前应先把自身 App 拉回前台");
  assert(logs.some(function (item) {
    return item.message.indexOf("已拉起自身前台后再申请截图权限") >= 0;
  }), "切前台应留下诊断日志");
}

testSettingsEnabledServiceDoesNotOpenAccessibilitySettings();
testUnknownAccessibilityStateDoesNotOpenAccessibilitySettings();
testCapturePermissionRejectsReentrantRequest();
testCapturePermissionRunsInWorkerThread();
testCapturePermissionTimeoutDoesNotHang();
testCapturePermissionBringsSelfToForeground();

console.log("permission tests passed");
