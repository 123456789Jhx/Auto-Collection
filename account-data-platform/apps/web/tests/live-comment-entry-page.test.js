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
  const progressSource = fs.readFileSync(path.join(webRoot, "src/components/account-warmup/LiveCommentEntryProgress.tsx"), "utf8");
  const clientSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-live-comment-entry.ts"), "utf8");
  const visibleSource = `${pageSource}\n${progressSource}`;

  for (const text of [
    "目标直播间关键词",
    "直播间人数下限",
    "选择执行设备",
    "开始抓取评论",
    "停止本批任务",
    "执行进度",
    "当前阶段",
    "最后更新",
    "阶段记录"
  ]) {
    assert(visibleSource.includes(text), `missing live-comment entry text: ${text}`);
  }
  assert(pageSource.includes('mode="multiple"'));
  assert(progressSource.includes("stageHistory"));
  assert(pageSource.includes("refetchInterval: 2_000"));
  assert(pageSource.includes("loadError={commandsQuery.isError}"));
  assert(pageSource.includes("maxCount={200}"));
  assert(pageSource.includes("readActiveLiveCommentEntryBatchId"));
  assert(pageSource.includes("writeActiveLiveCommentEntryBatchId"));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_RUN"'));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_STOP"'));
  assert(clientSource.includes('"/admin/mobile-commands"'));
  assert(clientSource.includes('featureKey: "live_comment_entry"'));
});

test("shows merged candidates with manual selection and explicit vocabulary upload", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  const candidateSource = fs.readFileSync(path.join(webRoot, "src/components/account-warmup/LiveCommentCandidates.tsx"), "utf8");
  const helperSource = fs.readFileSync(path.join(webRoot, "src/lib/live-comment-entry-candidates.ts"), "utf8");
  const clientSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-live-comment-entry.ts"), "utf8");

  assert(pageSource.includes("collectLiveCommentCandidates(rows)"));
  assert(pageSource.includes("isLiveCommentEntryBatchFinished"));
  for (const text of [
    "本批候选评论",
    "默认不选择",
    "全选可入库评论",
    "将所选评论加入评论词库",
    "用户名 / 来源设备 / 页",
    "批次抓取完成",
    "所选评论入库完成",
    "重试失败的"
  ]) {
    assert(candidateSource.includes(text), `missing candidate workflow text: ${text}`);
  }
  assert(candidateSource.includes("useState<string[]>([])"));
  assert(candidateSource.includes("onConfirm={uploadSelected}"));
  assert(helperSource.includes("Promise.allSettled"));
  assert(clientSource.includes('"/admin/account-warmup/vocabulary"'));
  assert(clientSource.includes("relatedTerms: []"));
});

test("persists a batch before dispatch so timed-out responses remain recoverable", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");

  assert(pageSource.includes("onMutate: (input) =>"));
  assert(pageSource.includes("writeActiveLiveCommentEntryBatchId(input.batch.batchId)"));
  assert(pageSource.includes("writeLiveCommentEntryBatchPlan(input.batch)"));
  assert(pageSource.includes("initialActiveBatchId"));
  assert(pageSource.includes("getRestoredLiveCommentEntryWarningIds"));
});

test("keeps per-device dispatch failures and retries only missing commands in the original batch", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  const progressSource = fs.readFileSync(path.join(webRoot, "src/components/account-warmup/LiveCommentEntryProgress.tsx"), "utf8");

  assert(pageSource.includes("readLiveCommentEntryBatchPlan"));
  assert(pageSource.includes("findUndispatchedLiveCommentEntryDevices"));
  assert(pageSource.includes("await commandsQuery.refetch()"));
  assert(pageSource.includes("deviceTotal={deviceTotal}"));
  assert(progressSource.includes("使用原批次重试"));
  assert(progressSource.includes("failure.message"));
});

test("does not keep a completed batch locked when device metadata is unavailable", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  assert(pageSource.includes("devicesQuery.isFetching && rows.length > 0 && rows.some((row) => !row.deviceCode)"));
});

test("keeps base-online devices selectable when the inner Agent is offline", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  assert(pageSource.includes('device.effectiveStatus !== "offline" || device.baseReachable === true'));
});
