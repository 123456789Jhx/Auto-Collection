"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var featureRoot = path.join(__dirname, "../features/new-comment");
var requiredFiles = ["runtime.js", "workflow.js", "cleanup.js", "index.js"];

function productionFiles() {
  return fs.readdirSync(featureRoot).filter(function (name) { return /\.js$/.test(name); }).map(function (name) {
    return { name: name, source: fs.readFileSync(path.join(featureRoot, name), "utf8") };
  });
}

test("isolated workflow production modules exist", function () {
  requiredFiles.forEach(function (name) {
    assert.equal(fs.existsSync(path.join(featureRoot, name)), true, name + " must exist");
  });
});

test("new-comment production requires only sibling modules or public core adapters", function () {
  productionFiles().forEach(function (file) {
    assert.doesNotMatch(file.source, /account-warmup|publish-video|domain[\\/]live-comment/,
      file.name + " imports a legacy business module");
    var requires = file.source.matchAll(/require\(["']([^"']+)["']\)/g);
    Array.from(requires).forEach(function (match) {
      assert.match(match[1], /^(\.\/|\.\.\/\.\.\/core\/)/,
        file.name + " imports non-public business code: " + match[1]);
    });
  });
});

test("workflow and runner never call AutoJS gesture, selector or capture globals", function () {
  ["workflow.js", "comment-runner.js"].forEach(function (name) {
    var source = fs.readFileSync(path.join(featureRoot, name), "utf8");
    assert.doesNotMatch(source, /\b(?:click|swipe|text|desc|captureScreen)\s*\(/,
      name + " contains a raw AutoJS call");
  });
});

test("every new-comment source stays synchronous, portable and at most 400 lines", function () {
  productionFiles().forEach(function (file) {
    var lineCount = file.source.replace(/\r\n/g, "\n").split("\n").length;
    assert.ok(lineCount <= 400, file.name + " has " + lineCount + " lines");
    assert.doesNotMatch(file.source, /\basync\b|\bPromise\b/,
      file.name + " is not synchronous ES5");
    assert.doesNotMatch(file.source, /require\(["']node:|\bprocess\.|\bBuffer\b/,
      file.name + " uses a Node-only API");
  });
});
