const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishTaskFinalizer } = require("../domain/publish-task-finalizer.js");

test("成功终态按上报、ACK、资源释放顺序执行且保持幂等", () => {
  const events = [];
  const finalizer = createPublishTaskFinalizer({
    logger: { info(message) { events.push("log:" + message); }, warn() {} },
    device: { deviceId: "device-finalizer", deviceToken: "token-finalizer" },
    resultReporter: {
      report(taskId, result) {
        events.push("report:" + taskId + ":" + result.status);
      }
    },
    uploader: {
      ackCommand(commandId, status) {
        events.push("ack:" + commandId + ":" + status);
      }
    }
  });
  const input = {
    command: { id: "command-finalizer" },
    payload: { taskId: "task-finalizer" },
    status: "SUCCEEDED",
    publishResult: { platformContentId: "douyin-finalizer" },
    releaseResources() { events.push("release_resources"); }
  };

  const first = finalizer.finalize(input);
  const repeated = finalizer.finalize(input);

  assert.equal(first.status, "SUCCEEDED");
  assert.deepEqual(repeated, first);
  assert.deepEqual(events, [
    "report:task-finalizer:SUCCEEDED",
    "ack:command-finalizer:DONE",
    "release_resources",
    "log:发布任务终态收口完成"
  ]);
});

test("结果上报失败仍释放资源并以 FAILED 回执", () => {
  const events = [];
  const finalizer = createPublishTaskFinalizer({
    logger: { info() {}, warn(message) { events.push("warn:" + message); } },
    device: { deviceId: "device-finalizer", deviceToken: "token-finalizer" },
    resultReporter: { report() { events.push("report"); throw new Error("report offline"); } },
    uploader: { ackCommand(id, status) { events.push("ack:" + status); } }
  });

  const result = finalizer.finalize({
    command: { id: "command-report-failed" },
    payload: { taskId: "task-report-failed" },
    status: "SUCCEEDED",
    releaseResources() { events.push("release_resources"); }
  });

  assert.equal(result.reportFailed, true);
  assert.deepEqual(events, [
    "report",
    "warn:发布结果回传失败",
    "ack:FAILED",
    "release_resources"
  ]);
});
