var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

/**
 * 覆盖 ensureWritableDir 的可写性判定：
 * AutoJs6 的 files.createWithDirs 在失败时返回 false 而不抛异常，
 * 旧实现只捕获异常，导致恒返回 true，回退到应用私有目录的分支永不执行。
 */

var TARGETS = [
  { label: "main.module.js", file: path.join(__dirname, "../main.module.js") },
  { label: "watchdog.js", file: path.join(__dirname, "../watchdog.js") },
];

function extractFunctionSource(source, name) {
  var marker = "function " + name + "(";
  var start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("function not found: " + name);
  }
  var depth = 0;
  var started = false;
  for (var i = start; i < source.length; i += 1) {
    var ch = source.charAt(i);
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error("function body is not closed: " + name);
}

function buildProbe(target, filesStub) {
  var source = fs.readFileSync(target.file, "utf8");
  var fnSource = extractFunctionSource(source, "ensureWritableDir");
  var context = { files: filesStub };
  return vm.runInNewContext("(" + fnSource + ")", context);
}

function createFilesStub(options) {
  options = options || {};
  var state = { writes: [], removed: [], createCalls: [] };
  return {
    state: state,
    join: function () {
      return Array.prototype.slice.call(arguments).join("/");
    },
    createWithDirs: function (target) {
      state.createCalls.push(target);
      if (options.createThrows) throw new Error("createWithDirs failed");
      if (options.createReturnsFalse) return false;
      if (options.createReturnsTrue) return true;
      return undefined;
    },
    write: function (target, content) {
      if (options.writeThrows) throw new Error("write failed");
      state.writes.push({ path: target, content: content });
    },
    read: function (target) {
      if (options.readThrows) throw new Error("read failed");
      if (options.readMismatch) return "tampered";
      var last = state.writes[state.writes.length - 1];
      return last ? last.content : "";
    },
    remove: function (target) {
      if (options.removeThrows) throw new Error("remove failed");
      state.removed.push(target);
    },
  };
}

TARGETS.forEach(function (target) {
  test(target.label + ": createWithDirs 返回 false 时判定为不可写", function () {
    var files = createFilesStub({ createReturnsFalse: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/storage/emulated/0/燎原星火/datasource"), false);
    assert.strictEqual(files.state.writes.length, 0, "判定不可写后不应继续写入");
  });

  test(target.label + ": createWithDirs 抛异常时判定为不可写", function () {
    var files = createFilesStub({ createThrows: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/storage/emulated/0/燎原星火/datasource"), false);
    assert.strictEqual(files.state.writes.length, 0);
  });

  test(target.label + ": createWithDirs 返回 undefined 且读写一致时判定为可写", function () {
    var files = createFilesStub();
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/tmp/datasource"), true);
    assert.strictEqual(files.state.writes.length, 1);
  });

  test(target.label + ": 创建成功但写入抛异常时判定为不可写", function () {
    var files = createFilesStub({ writeThrows: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/tmp/datasource"), false);
  });

  test(target.label + ": 写入成功但读回不一致时判定为不可写", function () {
    var files = createFilesStub({ readMismatch: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/tmp/datasource"), false);
  });

  test(target.label + ": 读回抛异常时判定为不可写", function () {
    var files = createFilesStub({ readThrows: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/tmp/datasource"), false);
  });

  test(target.label + ": 探测文件在被判定为不可写时也会清理", function () {
    var files = createFilesStub({ readMismatch: true });
    var probe = buildProbe(target, files);
    probe("/tmp/datasource");
    assert.strictEqual(files.state.removed.length, 1, "探测文件必须被清理");
  });

  test(target.label + ": 移除探测文件失败不影响判定结果", function () {
    var files = createFilesStub({ removeThrows: true });
    var probe = buildProbe(target, files);
    assert.strictEqual(probe("/tmp/datasource"), true);
  });

  test(target.label + ": 探测文件路径不与固定名冲突", function () {
    var files = createFilesStub();
    var probe = buildProbe(target, files);
    probe("/tmp/datasource");
    var probePath = files.state.createCalls[0];
    assert.ok(probePath.indexOf(".write-probe-") >= 0, "应使用带随机后缀的探测文件名");
    assert.notStrictEqual(probePath, "/tmp/datasource/.write-test");
  });
});

test("main.module.js 与 watchdog.js 的可写性判定实现保持一致", function () {
  var mainSource = fs.readFileSync(TARGETS[0].file, "utf8");
  var watchdogSource = fs.readFileSync(TARGETS[1].file, "utf8");
  var mainBody = extractFunctionSource(mainSource, "ensureWritableDir").replace(/\s+/g, " ");
  var watchdogBody = extractFunctionSource(watchdogSource, "ensureWritableDir").replace(/\s+/g, " ");
  assert.strictEqual(mainBody.trim(), watchdogBody.trim(), "两处实现必须一致，避免只修一处");
});
