"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var mainPath = path.join(root, "main.module.js");

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
  assert(loadNew >= 0);
  assert(createNew > loadNew);
  assert(installNew > createNew);
  assert(createOld > installNew);
  assert(installOld > createOld);
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
