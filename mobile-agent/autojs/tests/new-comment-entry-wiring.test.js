"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var createNewBridge = require("../features/new-comment/command-bridge.js").createNewCommentCommandBridge;
var createOldBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;

var root = path.join(__dirname, "..");
var mainPath = path.join(root, "main.module.js");
var entryPath = path.join(root, "features/new-comment/index.js");

test("主入口先安装隔离评论桥，再安装旧养号桥", function () {
  var source = fs.readFileSync(mainPath, "utf8");
  var loadNew = source.indexOf('localRequire("features/new-comment/command-bridge.js")');
  var createNew = source.indexOf("createNewCommentCommandBridge(context)");
  var installNew = source.indexOf("context.newCommentCommandBridge.install()");
  var createOld = source.indexOf("createAccountWarmupCommandBridge(context)");
  var installOld = source.indexOf("context.accountWarmupCommandBridge.install()");
  var preserveMetadata = source.indexOf("context.newCommentCommandBridge.installPollMetadataPreserver()");
  assert(loadNew >= 0);
  assert(createNew > loadNew);
  assert(installNew > createNew);
  assert(createOld > installNew);
  assert(installOld > createOld);
  assert(preserveMetadata > installOld);
});

test("隔离评论任务默认复用视频养号退出清理器", function () {
  var source = fs.readFileSync(entryPath, "utf8");
  assert.match(source, /douyin-post-publish-cleanup\.js/);
  assert.match(source, /createDouyinPostPublishCleanup/);
});

test("隔离评论任务将日志器传给工作流", function () {
  var received = null;
  var logger = { info: function () {} };
  var entry = require("../features/new-comment/index.js").createIsolatedLiveCommentEntryTask({}, {
    logger: logger,
    createRuntime: function () { return {}; },
    createWorkflow: function (options) {
      received = options.logger;
      return { run: function () { return { status: "STOPPED" }; } };
    },
    finalCleanup: { run: function () { return { completed: true }; } }
  });
  entry.run({}, { shouldStop: function () { return true; } });
  assert.strictEqual(received, logger);
});

test("真实新旧桥组合只恢复同一次底层轮询元数据且隔离命令仍先消费", function () {
  var legacyFirst = { id: "legacy-first", commandType: "ACCOUNT_WARMUP_RUN", payload: {
    featureKey: "video_warmup", batchId: "batch-legacy-first", config: { targetKeyword: "药材种植" }
  } };
  var first = [legacyFirst, { id: "isolated-run", commandType: "ACCOUNT_WARMUP_RUN", payload: {
    featureKey: "isolated_live_comment_entry", batchId: "batch-combined",
    config: { targetKeyword: "药材种植", minViewerCount: 0 }
  } }, { id: "status-first", commandType: "STATUS", payload: {} }];
  first.deviceRecoveryRequestSucceeded = true;
  var polls = [first, [{ id: "status-second", commandType: "STATUS", payload: {} }]];
  var pollIndex = 0;
  var threads = [];
  var acknowledgements = [];
  var newTaskCreates = 0;
  var context = {
    config: { device: { deviceId: "device-combined" } },
    uploader: {
      pollCommands: function () { return polls[pollIndex++]; },
      ackCommand: function (id, status, result) { acknowledgements.push({ id: id, status: status, result: result }); }
    },
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    startThread: function (runner) { threads.push(runner); return { interrupt: function () {} }; },
    loadBizScript: function (modulePath) {
      if (modulePath === "features/new-comment/index.js") return {
        createIsolatedLiveCommentEntryTask: function () {
          newTaskCreates += 1;
          return { run: function () { return { status: "LIVE_COMMENT_ENTRY_CAPTURED" }; },
            cleanup: { run: function () { return { completed: true }; } } };
        }
      };
      if (modulePath.indexOf("douyin-post-publish-cleanup") >= 0) return {
        createDouyinPostPublishCleanup: function () { return { run: function () { return { completed: true }; } }; }
      };
      return { createAccountWarmupRegistry: function () { return {
        create: function () { throw new Error("isolated command leaked into old bridge"); }
      }; } };
    }
  };
  var newBridge = createNewBridge(context);
  newBridge.install();
  context.accountWarmupCommandBridge = createOldBridge(context);
  context.accountWarmupCommandBridge.install();
  assert.equal(newBridge.installPollMetadataPreserver(), true);
  assert.equal(newBridge.installPollMetadataPreserver(), false);

  var firstOutput = context.uploader.pollCommands();
  assert.deepEqual(firstOutput.slice(), [first[2]]);
  assert.equal(firstOutput.deviceRecoveryRequestSucceeded, true);
  assert.equal(newTaskCreates, 1);
  assert.equal(threads.length, 1);
  assert.equal(acknowledgements[0].id, legacyFirst.id);
  assert.equal(acknowledgements[0].result.status, "ACCOUNT_WARMUP_BUSY");
  var secondOutput = context.uploader.pollCommands();
  assert.equal(Object.prototype.hasOwnProperty.call(secondOutput, "deviceRecoveryRequestSucceeded"), false);
});

test("养号桥拒绝已下线评论入口且 uploader 不再暴露直播间租约能力", function () {
  var acknowledgements = [];
  var workers = [];
  var bridge = createOldBridge({
    uploader: {
      pollCommands: function () { return []; },
      ackCommand: function (id, status, result) {
        acknowledgements.push({ id: id, status: status, result: result });
        return { success: true };
      }
    },
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function (modulePath) { return require(path.join(root, modulePath)); },
    startThread: function (worker) { workers.push(worker); return { interrupt: function () {} }; }
  });
  bridge.install();
  bridge.intercept([{ id: "retired-entry", commandType: "ACCOUNT_WARMUP_RUN", payload: {
    featureKey: "live_comment_entry", batchId: "batch-retired", config: {}
  } }]);
  assert.equal(workers.length, 1);
  workers[0]();
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].id, "retired-entry");
  assert.equal(acknowledgements[0].status, "FAILED");
  assert.match(acknowledgements[0].result.message, /unsupported account warmup feature: live_comment_entry/);
  assert.equal(bridge.getActive(), null);
  var uploaderSource = fs.readFileSync(path.join(root, "core/uploader.js"), "utf8");
  assert.equal(uploaderSource.includes("claimLiveRoom: claimLiveRoom"), false);
  assert.equal(uploaderSource.includes("releaseLiveRoom: releaseLiveRoom"), false);
});
