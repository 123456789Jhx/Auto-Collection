import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "bun:test";
import {
  buildRuntimeLogSearchText,
  classifyPublishLogMilestones,
  matchesPublishTaskId,
  matchesTroubleshootingKeywords,
  parseTroubleshootingKeywords,
  summarizePublishMilestones
} from "../src/lib/publish-video-log-troubleshooting";

const webRoot = path.resolve(import.meta.dir, "..");
const routePath = path.join(webRoot, "src/routes/PublishVideoLogTroubleshootingPage.tsx");
const helperPath = path.join(webRoot, "src/lib/publish-video-log-troubleshooting.ts");

describe("publish video log troubleshooting helpers", () => {
  test("matches publish task id from context and nested payload", () => {
    assert.equal(matchesPublishTaskId({
      id: "log-1",
      message: "发布动作闸口开始",
      contextJson: { taskId: "ce47eff6-af78" }
    }, "ce47eff6"), true);
    assert.equal(matchesPublishTaskId({
      id: "log-2",
      message: "发布动作闸口开始",
      contextJson: { payload: { taskId: "nested-task-id" } }
    }, "nested-task"), true);
    assert.equal(matchesPublishTaskId({
      id: "log-3",
      message: "发布动作闸口开始",
      contextJson: { payload: { taskId: "other-task" } }
    }, "missing-task"), false);
  });

  test("parses manual keywords and matches message stop reason and context", () => {
    const keywords = parseTroubleshootingKeywords("发布素材下载完成，gate timeout\npublish module preload ready");
    assert.deepEqual(keywords, ["发布素材下载完成", "gate timeout", "publish module preload ready"]);
    assert.equal(matchesTroubleshootingKeywords({
      id: "log-1",
      message: "普通事件",
      stopReason: "等待选择发布素材目标状态超时",
      contextJson: { action: "选择发布素材" }
    }, ["选择发布素材"]), true);
    assert(buildRuntimeLogSearchText({ id: "log-2", message: "发布素材下载完成", contextJson: { videoBytes: 29946075 } }).includes("29946075"));
  });

  test("classifies publish preload download and gate milestones", () => {
    assert.deepEqual(classifyPublishLogMilestones({ id: "a", message: "publish module preload ready" }), ["preload"]);
    assert.deepEqual(classifyPublishLogMilestones({ id: "b", message: "发布素材下载完成", contextJson: { videoBytes: 29946075 } }), ["materialDownload"]);
    assert.deepEqual(classifyPublishLogMilestones({ id: "c", message: "发布动作闸口开始", contextJson: { action: "选择发布素材" } }), ["gateStart"]);
    assert.deepEqual(classifyPublishLogMilestones({ id: "d", message: "发布动作闸口完成", contextJson: { action: "选择发布素材" } }), ["gateDone"]);
    assert.deepEqual(classifyPublishLogMilestones({ id: "e", message: "等待选择发布素材目标状态超时" }), ["gateTimeout"]);
  });

  test("does not classify material download from URL-only context", () => {
    assert.deepEqual(classifyPublishLogMilestones({
      id: "url-only",
      message: "发布前准备打开App",
      contextJson: {
        videoUrl: "https://cdn.example.com/video.mp4",
        coverUrl: "https://cdn.example.com/cover.jpg"
      }
    }), []);
  });

  test("summarizes milestone discovery with first and last timestamps", () => {
    const summary = summarizePublishMilestones([
      { id: "1", createdAt: "2026-07-30T04:10:00.000Z", message: "发布动作闸口开始" },
      { id: "2", createdAt: "2026-07-30T04:10:45.000Z", level: "ERROR", message: "等待选择发布素材目标状态超时" }
    ]);
    const gateStart = summary.find((item) => item.key === "gateStart");
    const gateTimeout = summary.find((item) => item.key === "gateTimeout");
    assert.equal(gateStart?.matched, true);
    assert.equal(gateStart?.count, 1);
    assert.equal(gateTimeout?.latestLevel, "ERROR");
  });
});

test("publish log troubleshooting component stays lightweight and reuses runtime logs", () => {
  assert(fs.existsSync(routePath), "PublishVideoLogTroubleshootingPage.tsx should exist");
  const source = fs.readFileSync(routePath, "utf8");

  assert(source.includes("getLogs"));
  assert(source.includes("getLogDeviceSummary"));
  assert(source.includes("troubleshootingPageSize = 100"));
  assert(source.includes("maxTroubleshootingLogPages = 5"));
  const helperSource = fs.readFileSync(helperPath, "utf8");
  for (const label of ["后台同步/预加载", "素材下载", "选择素材闸口开始", "选择素材闸口完成", "选择素材闸口超时"]) {
    assert(helperSource.includes(label), `missing ${label}`);
  }
  for (const keyword of ["publish module preload ready", "发布素材下载完成", "发布动作闸口开始", "等待选择发布素材目标状态超时"]) {
    assert(helperSource.includes(keyword), `missing preset ${keyword}`);
  }
  assert(!source.includes("LogsPage"));
  assert(!source.includes("createMobileCommand"));
});
