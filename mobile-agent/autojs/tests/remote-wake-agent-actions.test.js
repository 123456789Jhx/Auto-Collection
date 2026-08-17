var assert = require("assert");
var commandModule = require("../app/remote-wake-command.js");
var createRemoteWakeScreen = require("../app/remote-wake-screen.js").createRemoteWakeScreen;
var createRemoteWakeRecents = require("../app/remote-wake-recents.js").createRemoteWakeRecents;
var launcherModule = require("../app/remote-wake-launcher.js");

function testCommandParserAcceptsOnlyOpenAgentApp() {
  var command = commandModule.parseRemoteWakeCommand({
    id: "00000000-0000-4000-8000-000000000029",
    commandType: "OPEN_AGENT_APP",
    payload: {
      deviceId: "mi8-a",
      expiresAt: "2026-08-11T10:01:00.000Z",
      ackToken: "short-lived-ack-token"
    }
  }, {
    deviceId: "mi8-a",
    now: function () { return new Date("2026-08-11T10:00:00.000Z"); }
  });

  assert.strictEqual(command.commandType, "OPEN_AGENT_APP");
  assert.strictEqual(command.commandId, "00000000-0000-4000-8000-000000000029");
  assert.strictEqual(command.targetPackage, "com.agri.video.collector");
  assert.strictEqual(command.ackToken, "short-lived-ack-token");
  assert.strictEqual(commandModule.parseRemoteWakeCommand({ commandType: "RESTART_APP" }, { deviceId: "mi8-a" }), null);
  assert.throws(function () {
    commandModule.parseRemoteWakeCommand({
      id: "00000000-0000-4000-8000-000000000029",
      commandType: "OPEN_AGENT_APP",
      payload: { deviceId: "other-device", expiresAt: "2026-08-11T10:01:00.000Z", ackToken: "token" }
    }, { deviceId: "mi8-a", now: function () { return new Date("2026-08-11T10:00:00.000Z"); } });
  }, /REMOTE_WAKE_DEVICE_MISMATCH/);
}

function testScreenWakeAndNoPasswordDismiss() {
  var screenOn = false;
  var locked = true;
  var wakeCalls = 0;
  var swipes = [];
  var screen = createRemoteWakeScreen({
    isScreenOn: function () { return screenOn; },
    isKeyguardLocked: function () { return locked; },
    wakeUp: function () { wakeCalls += 1; screenOn = true; return true; },
    swipe: function (x1, y1, x2, y2) { swipes.push([x1, y1, x2, y2]); locked = false; return true; },
    wait: function () {},
    now: function () { return 0; },
    width: 1080,
    height: 1920
  });

  assert.deepStrictEqual(screen.readState(), { screenOn: false, keyguardLocked: true });
  assert.strictEqual(screen.wake(1000).success, true);
  assert.strictEqual(wakeCalls, 1);
  assert.strictEqual(screen.dismissKeyguard(1000).success, true);
  assert.strictEqual(swipes.length, 1);
  assert(swipes[0][1] > swipes[0][3], "unlock gesture must swipe upward");
}

function testRecentsClearsOnlyLiaoyuanCardWithRelativeSwipe() {
  var findCalls = 0;
  var swipeArgs = null;
  var card = {
    bounds: function () {
      return {
        left: 100,
        width: function () { return 800; },
        centerY: function () { return 900; },
        height: function () { return 1200; }
      };
    }
  };
  var recents = createRemoteWakeRecents({
    openRecents: function () { return true; },
    findLiaoyuanCard: function () { findCalls += 1; return findCalls === 1 ? card : null; },
    swipe: function () { swipeArgs = Array.prototype.slice.call(arguments); return true; },
    wait: function () {},
    width: 1080,
    height: 1920
  });

  var result = recents.clearExistingTask();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cleared, true);
  assert(swipeArgs[0] > swipeArgs[2], "task card must be dismissed to the left");
  assert.strictEqual(recents.targetLabel, "燎原星火");
}

function testLauncherUsesFixedPackageAndRequiresRealUi() {
  var launchedPackage = "";
  var currentPackage = "launcher";
  var uiVisible = false;
  var launcher = launcherModule.createRemoteWakeLauncher({
    launchPackage: function (packageName) { launchedPackage = packageName; currentPackage = packageName; return true; },
    currentPackage: function () { return currentPackage; },
    findUiSignal: function () { return uiVisible; },
    wait: function () {},
    now: function () { return 0; }
  });

  assert.strictEqual(launcher.launch(1000).success, true);
  assert.strictEqual(launchedPackage, "com.agri.video.collector");
  assert.strictEqual(launcher.waitForUiReady(10).success, false);
  uiVisible = true;
  assert.strictEqual(launcher.waitForUiReady(1000).success, true);
  assert.strictEqual(launcherModule.REMOTE_WAKE_TARGET_PACKAGE, "com.agri.video.collector");
}

testCommandParserAcceptsOnlyOpenAgentApp();
testScreenWakeAndNoPasswordDismiss();
testRecentsClearsOnlyLiaoyuanCardWithRelativeSwipe();
testLauncherUsesFixedPackageAndRequiresRealUi();
console.log("remote wake agent action tests passed");
