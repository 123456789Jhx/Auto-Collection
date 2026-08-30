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

test("OCR parsing stays field-for-field equivalent for noise, wraps and limits", function () {
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

  assert.deepEqual(isolated.parseCommentLines(rawText), legacy.parseCommentLines(rawText));
  assert.deepEqual(isolated.parseCommentLines(null), legacy.parseCommentLines(null));
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
  var flat = legacy.flattenPages(pages);

  assert.deepEqual(isolated.flattenPages(pages), flat);
  [" A b\tC ", "今年 行情怎么样", null].forEach(function (value) {
    assert.equal(isolated.normalizedCommentKey(value), legacy.normalizedCommentKey(value));
  });
  flat.forEach(function (comment) {
    assert.equal(isolated.commentIdentity(scope, comment), legacy.commentIdentity(scope, comment));
  });
  var isolatedCandidates = isolated.buildCandidates(pages, scope);
  var legacyCandidates = legacy.buildCandidates(pages, scope);
  isolatedCandidates.forEach(function (candidate) {
    candidate.sources.forEach(function (source) {
      delete source.deviceId;
      delete source.roomKey;
    });
  });
  assert.deepEqual(isolatedCandidates, legacyCandidates);
  var isolatedScoped = isolated.attachScope(flat, scope);
  isolatedScoped.forEach(function (candidate) {
    candidate.sources.forEach(function (source) {
      delete source.deviceId;
      delete source.roomKey;
    });
  });
  assert.deepEqual(isolatedScoped, legacy.attachScope(flat, scope));
  assert.match(isolated.buildCandidates(pages, scope)[0].commentId, /^lc_[0-9a-f]{8}$/);
});

test("comment and live-room geometry stays equivalent at fixed screen sizes", function () {
  [
    { width: 1080, height: 2400 },
    { width: 1080, height: 2248 },
    { width: 720, height: 1280 },
    { width: 1, height: 1 },
    {}
  ].forEach(function (size) {
    assert.deepEqual(isolated.commentOcrRegion(size), legacy.commentOcrRegion(size));
    assert.deepEqual(isolated.commentOcrRegions(size), legacy.commentOcrRegions(size));
    assert.deepEqual(isolated.commentSwipeCoordinates(size), legacy.commentSwipeCoordinates(size));
    assert.deepEqual(isolated.liveRoomSwipeCoordinates(size), legacy.liveRoomSwipeCoordinates(size));
  });
});

test("isolated production source uses local layout and never delegates to legacy business", function () {
  var sourcePath = path.join(__dirname, "../features/new-comment/comment-capture.js");
  var source = fs.readFileSync(sourcePath, "utf8");

  assert.match(source, /require\(["']\.\/douyin-layout\.js["']\)/);
  assert.doesNotMatch(source, /account-warmup|domain[\\/]live-comment-capture/);
});
