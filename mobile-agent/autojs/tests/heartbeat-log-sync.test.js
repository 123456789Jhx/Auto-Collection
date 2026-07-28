var assert = require("assert");
var createHeartbeatService = require("../app/heartbeat.js").createHeartbeatService;

function createContext() {
  var uploadedLogs = [];
  var uploadedHeartbeats = [];
  return {
    uploadedLogs: uploadedLogs,
    uploadedHeartbeats: uploadedHeartbeats,
    context: {
      config: {
        runtime: {
          idleHeartbeatSeconds: 0
        },
        upload: {
          enabled: true,
          realtimeLogUploadEnabled: true,
          realtimeLogUploadIntervalSeconds: 120
        }
      },
      logger: {
        info: function () {},
        warn: function () {},
        getLogFile: function () {
          return "current.log";
        }
      },
      uploader: {
        uploadHeartbeat: function (payload) {
          uploadedHeartbeats.push(payload);
          return { success: true };
        },
        uploadLogFile: function (filePath) {
          uploadedLogs.push(filePath);
          return { success: true };
        }
      },
      floatyControl: {
        state: {
          paused: false,
          stopRequested: false,
          lastMessage: "运行中"
        }
      },
      counters: {
        currentPhase: "live",
        phaseStartedAt: new Date().toISOString(),
        plannedVideoMinutes: 0,
        plannedLiveMinutes: 15,
        videoElapsedMinutes: 0,
        liveElapsedMinutes: 1,
        liveRemainingMinutes: 14,
        viewedCount: 0,
        liveViewedCount: 1,
        liveRoomEnteredCount: 0,
        liveCandidateCount: 0,
        liveRejectedCount: 0,
        capturedCount: 0
      },
      heartbeat: {},
      taskScheduler: {
        getActiveTaskType: function () {
          return "live";
        }
      }
    }
  };
}

function testHeartbeatAutoUploadsCurrentLogWithThrottle() {
  var fixture = createContext();
  var service = createHeartbeatService(fixture.context);

  service.reportImmediateHeartbeat("live", "running", "第一次心跳");
  service.reportImmediateHeartbeat("live", "running", "第二次心跳");

  assert.strictEqual(fixture.uploadedHeartbeats.length, 2, "heartbeats should still be reported");
  assert.strictEqual(fixture.uploadedLogs.length, 1, "current log should be uploaded once and throttled");
  assert.strictEqual(fixture.uploadedLogs[0], "current.log");
}

function testCommerceCardImmediateHeartbeatUsesLiveSceneType() {
  var fixture = createContext();
  fixture.context.counters.currentPhase = "commerce_card_live_comment";
  fixture.context.taskScheduler.getActiveTaskType = function () {
    return "commerce_card_live_comment";
  };
  var service = createHeartbeatService(fixture.context);

  service.reportImmediateHeartbeat("commerce_card_live_comment", "running", "商品卡直播第 1/3 轮");

  assert.strictEqual(fixture.uploadedHeartbeats.length, 1);
  assert.strictEqual(fixture.uploadedHeartbeats[0].sceneType, "live");
  assert.strictEqual(fixture.uploadedHeartbeats[0].currentTaskType, "commerce_card_live_comment");
}

testHeartbeatAutoUploadsCurrentLogWithThrottle();
testCommerceCardImmediateHeartbeatUsesLiveSceneType();

console.log("heartbeat-log-sync tests passed");
