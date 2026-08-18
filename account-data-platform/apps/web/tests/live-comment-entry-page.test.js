import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("mounts the independent live-comment entry page after video warmup", () => {
  const moduleSource = fs.readFileSync(path.join(webRoot, "src/routes/AccountWarmupModulePage.tsx"), "utf8");
  const videoIndex = moduleSource.indexOf('label: "视频养号"');
  const entryIndex = moduleSource.indexOf('label: "抓取评论词"');

  assert(videoIndex >= 0);
  assert(entryIndex > videoIndex);
  assert(moduleSource.includes("LiveCommentEntryPage"));
});

test("shows inputs, multi-device control, progress and scoped stop actions", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  const clientSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-live-comment-entry.ts"), "utf8");

  for (const text of [
    "目标直播间关键词",
    "直播间人数下限",
    "选择执行设备",
    "开始进入直播间",
    "停止本批任务",
    "执行进度",
    "当前阶段",
    "最后更新",
    "阶段记录"
  ]) {
    assert(pageSource.includes(text), `missing live-comment entry text: ${text}`);
  }
  assert(pageSource.includes('mode="multiple"'));
  assert(pageSource.includes("stageHistory"));
  assert(pageSource.includes("refetchInterval: 2_000"));
  assert(pageSource.includes("commandsQuery.isError"));
  assert(pageSource.includes("maxCount={200}"));
  assert(pageSource.includes("readActiveLiveCommentEntryBatchId"));
  assert(pageSource.includes("writeActiveLiveCommentEntryBatchId"));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_RUN"'));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_STOP"'));
  assert(clientSource.includes('"/admin/mobile-commands"'));
  assert(clientSource.includes('featureKey: "live_comment_entry"'));
});

test("persists a batch before dispatch so timed-out responses remain recoverable", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");

  assert(pageSource.includes("onMutate: (batchId) =>"));
  assert(pageSource.includes("writeActiveLiveCommentEntryBatchId(batchId)"));
  assert(pageSource.includes("startMutation.mutate(crypto.randomUUID())"));
});

test("does not keep a completed batch locked when device metadata is unavailable", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  assert(pageSource.includes("devicesQuery.isFetching && rows.length > 0 && rows.some((row) => !row.deviceCode)"));
});
