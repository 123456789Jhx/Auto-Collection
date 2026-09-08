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

test("comment swipe stays inside the approved comment region", function () {
  assert.deepEqual(isolated.commentSwipeCoordinates({ width: 1080, height: 2248 }), {
    startX: 220,
    startY: 1587,
    endX: 220,
    endY: 1962,
    durationMs: 520
  });
});

test("isolated production source uses local layout and never delegates to legacy business", function () {
  var sourcePath = path.join(__dirname, "../features/new-comment/comment-capture.js");
  var source = fs.readFileSync(sourcePath, "utf8");

  assert.match(source, /require\(["']\.\/douyin-layout\.js["']\)/);
  assert.doesNotMatch(source, /account-warmup|domain[\\/]live-comment-capture/);
});
