"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var legacy = require("../domain/live-comment-capture.js");
var isolated = require("../features/new-comment/comment-capture.js");

test("isolated capture exports the legacy bounded swipe constant", function () {
  assert.equal(isolated.COMMENT_SWIPE_COUNT, 5);
});

test("OCR parsing keeps line bodies without usernames or continuation", function () {
  var rawText = [
    "  -* 中药材 ： 主播，回关下 ",
    "我俩你学习学习",
    "12345",
    "欢迎来到直播间",
    "幸福安康 来了",
    "破局而立:关注你了",
    "燕麦@野想：地黄今年多少钱一斤",
    "说点什么",
    new Array(86).join("用") + "：" + new Array(212).join("评")
  ].join("\n");

  assert.deepEqual(isolated.parseCommentLines(rawText), ["主播，回关下", "关注你了", "地黄今年多少钱一斤", "评".repeat(211)].map(function (body) { return { commentText: body }; }));
  assert.deepEqual(isolated.parseCommentLines(null), legacy.parseCommentLines(null));
});

test("OCR parsing accepts punctuation separators and rejects special-symbol bodies", function () {
  var rawText = [
    "甲，四川宜宾没有。",
    "乙。怎么买？",
    "丙！好的！谢谢。",
    "丁？可以发物流吗（冷链）？",
    "主播.二号：正文保留，逗号、句号。问号？感叹号！",
    "燕麦@野想，地黄今年多少钱一斤？",
    "辛：",
    "分行正文，完整保留。",
    "壬：",
    "特殊|正文",
    "戊：pyi|",
    "己：异常_内容",
    "庚：欢迎👏",
    "没有分隔符的用户名"
  ].join("\n");

  assert.deepEqual(isolated.parseCommentLines(rawText), [
    "四川宜宾没有。",
    "怎么买？",
    "好的！谢谢。",
    "可以发物流吗（冷链）？",
    "正文保留，逗号、句号。问号？感叹号！",
    "地黄今年多少钱一斤？",
    "分行正文，完整保留。"
  ].map(function (body) { return { commentText: body }; }));
});

test("near-white OCR lines bypass username extraction and symbol filtering", function () {
  assert.deepEqual(isolated.parseFilteredCommentLines([
    "  地黄今年多少钱一斤？  ",
    "",
    "不能喝水。",
    "残留用户名：正文保留完整",
    "白色符号|也保留"
  ].join("\n")), [
    { commentText: "地黄今年多少钱一斤？" },
    { commentText: "不能喝水。" },
    { commentText: "残留用户名：正文保留完整" },
    { commentText: "白色符号|也保留" }
  ]);
});

test("page flattening, normalization, identities and scoped candidates stay equivalent", function () {
  var scope = { batchId: "batch-1", deviceId: "device-7", roomKey: "room-A" };
  var pages = [
    { pageIndex: 0, comments: [
      { userName: "甲", commentText: "今年行情怎么样" },
      { userName: "乙", commentText: "独立评论" }
    ] },
    { pageIndex: 1, comments: [
      { userName: "丙", commentText: "今年 行情怎么样" },
      { userName: "丁", commentText: "  " }
    ] }
  ];
  var flat = legacy.flattenPages(pages).map(function (item) { delete item.userName; return item; });

  assert.deepEqual(isolated.flattenPages(pages), flat);
  [" A b\tC ", "今年 行情怎么样", null].forEach(function (value) {
    assert.equal(isolated.normalizedCommentKey(value), legacy.normalizedCommentKey(value));
  });
  flat.forEach(function (comment) {
    assert.equal(isolated.commentIdentity(scope, comment), legacy.commentIdentity(scope, comment));
  });
  var isolatedCandidates = isolated.buildCandidates(pages, scope);
  isolatedCandidates.forEach(function (candidate) {
    candidate.sources.forEach(function (source) {
      delete source.deviceId;
      delete source.roomKey;
    });
  });
  assert.equal(isolatedCandidates.length, 3);
  assert.equal(JSON.stringify(isolatedCandidates).includes("userName"), false);
  var isolatedScoped = isolated.attachScope(flat, scope);
  isolatedScoped.forEach(function (candidate) {
    candidate.sources.forEach(function (source) {
      delete source.deviceId;
      delete source.roomKey;
    });
  });
  assert.equal(JSON.stringify(isolatedScoped).includes("userName"), false);
  assert.equal(isolatedScoped.length, 3);
  assert.match(isolated.buildCandidates(pages, scope)[0].commentId, /^lc_[0-9a-f]{8}_0$/);
});

test("comment OCR stays bounded while live-room geometry remains legacy-equivalent", function () {
  [
    { width: 1080, height: 2400 },
    { width: 1080, height: 2248 },
    { width: 720, height: 1280 },
    { width: 1, height: 1 },
    {}
  ].forEach(function (size) {
    var region = isolated.commentOcrRegion(size);
    assert.ok(region.x >= 0 && region.y >= 0 && region.w > 0 && region.h > 0);
    if (size.width) assert.ok(region.x + region.w <= size.width);
    if (size.height) assert.ok(region.y + region.h <= size.height);
    assert.deepEqual(isolated.commentOcrRegions(size), { commentArea: region });
    assert.deepEqual(isolated.liveRoomSwipeCoordinates(size), legacy.liveRoomSwipeCoordinates(size));
  });
});

test("comment OCR uses the new rectangle with scaled endpoints", function () {
  [
    [{ width: 1080, height: 2248 }, { x: 12, y: 1556, w: 763, h: 327 }],
    [{ width: 720, height: 1600 }, { x: 8, y: 1107, w: 509, h: 233 }],
    [{ width: 540, height: 1124 }, { x: 6, y: 778, w: 382, h: 164 }]
  ].forEach(function (entry) {
    assert.deepEqual(isolated.commentOcrRegion(entry[0]), entry[1]);
  });
});

test("comment swipe randomizes the endpoint and both control coordinates once", function () {
  var requested = [];
  var result = isolated.commentSwipeCoordinates({ width: 1080, height: 2248 }, function (min, max) {
    requested.push([min, max]);
    return min;
  });
  assert.deepEqual(result, {
    startX: 279, startY: 1607, endX: 245, endY: 1880,
    controlPoint: { x: 282, y: 1690 }, startHoldMs: 120, durationMs: 520
  });
  assert.deepEqual(requested, [[245, 338], [20, 60], [1690, 1790]]);
});

test("random quadratic paths stay inside the OCR rectangle and never turn upward", function () {
  [{ width: 1080, height: 2248 }, { width: 720, height: 1600 },
    { width: 1440, height: 3200 }].forEach(function (size) {
    for (var combination = 0; combination < 8; combination += 1) {
      var draw = 0;
      var coordinates = isolated.commentSwipeCoordinates(size, function (min, max) {
        return combination & (1 << draw++) ? max : min;
      });
      assert.equal(draw, 3);
      var start = { x: coordinates.startX, y: coordinates.startY };
      var end = { x: coordinates.endX, y: coordinates.endY };
      var control = coordinates.controlPoint;
      var region = isolated.commentOcrRegion(size);
      assert.ok(control.y > start.y && control.y < end.y);
      assert.ok(control.x - start.x > (end.x - start.x) * (control.y - start.y) / (end.y - start.y));
      var previousY = start.y;
      for (var step = 0; step <= 40; step += 1) {
        var t = step / 40, u = 1 - t;
        var x = u * u * start.x + 2 * u * t * control.x + t * t * end.x;
        var y = u * u * start.y + 2 * u * t * control.y + t * t * end.y;
        assert.ok(x >= region.x && x < region.x + region.w);
        assert.ok(y >= region.y && y < region.y + region.h);
        assert.ok(y >= previousY);
        previousY = y;
      }
    }
  });
});

test("isolated production source uses local layout and never delegates to legacy business", function () {
  var sourcePath = path.join(__dirname, "../features/new-comment/comment-capture.js");
  var source = fs.readFileSync(sourcePath, "utf8");

  assert.match(source, /require\(["']\.\/douyin-layout\.js["']\)/);
  assert.doesNotMatch(source, /account-warmup|domain[\\/]live-comment-capture/);
});
