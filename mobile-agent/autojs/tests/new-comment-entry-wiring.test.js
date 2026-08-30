"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var createNewBridge = require("../features/new-comment/command-bridge.js").createNewCommentCommandBridge;
var createOldBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;

var root = path.join(__dirname, "..");
var mainPath = path.join(root, "main.module.js");
var entryPath = path.join(root, "features/new-comment/index.js");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

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

test("隔离接线不得修改旧桥和 uploader", function () {
  assert.equal(
    sha256(path.join(root, "app/account-warmup-command-bridge.js")),
    "dd58357768730b85434aa8fc22816365bd2e8997b70ebcaa94a71ed124246e2e"
  );
  assert.equal(
    sha256(path.join(root, "core/uploader.js")),
    "806e7ef146036984e6e53ef279de7b0dca03fb6bf9506a32ed388167eea889f3"
  );
});
