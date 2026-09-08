"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

test("first live random click checks stop between bounded wait slices", function () {
  var source = fs.readFileSync(path.join(__dirname, "../platforms/douyin/adapter.js"), "utf8");
  var start = source.indexOf("function clickFirstLiveByRandomArea");
  var end = source.indexOf("function isLiveRoomVisible", start);
  var body = source.slice(start, end);

  assert.ok(start >= 0 && end > start, "first live random click function must be present");
  assert.match(body, /typeof options\.shouldStop\s*===\s*[\"']function[\"']/);
  assert.match(body, /Math\.min\(100,/);
  assert.match(body, /sleep\(sliceMs\)/);
  assert.match(body, /reason:\s*[\"']STOP_REQUESTED[\"']/);
  assert.match(body, /Math\.floor\(7500\s*\+\s*Math\.random\(\)\s*\*\s*1001\)/);
});
