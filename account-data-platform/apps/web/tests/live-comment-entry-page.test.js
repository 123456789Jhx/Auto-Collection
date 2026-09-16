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
  const formSource = fs.readFileSync(path.join(webRoot, "src/lib/live-comment-entry-form.ts"), "utf8");
  const batchSource = fs.readFileSync(path.join(webRoot, "src/lib/live-comment-entry-batch.ts"), "utf8");
  const setupSource = fs.readFileSync(path.join(webRoot, "src/components/live-comment-entry/LiveCommentTaskSetup.tsx"), "utf8");
  const visibleSource = `${pageSource}\n${setupSource}\n${progressSource}`;

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
  assert(setupSource.includes('mode="multiple"'));
  assert(progressSource.includes("stageHistory"));
  assert(pageSource.includes("refetchInterval: 2_000"));
  assert(pageSource.includes("loadError={commandsQuery.isError}"));
  assert(setupSource.includes("maxCount={200}"));
  assert(pageSource.includes("readActiveLiveCommentEntryBatchId"));
  assert(pageSource.includes("writeActiveLiveCommentEntryBatchId"));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_RUN"'));
  assert(clientSource.includes('commandType: "ACCOUNT_WARMUP_STOP"'));
  assert(clientSource.includes('"/admin/mobile-commands"'));
  assert(pageSource.includes('featureKey === "isolated_live_comment_entry"'));
  assert(!pageSource.includes('featureKey === "live_comment_entry"'));
  for (const source of [clientSource, formSource, batchSource]) {
    assert(source.includes('featureKey: "isolated_live_comment_entry"'));
    assert(!source.includes('featureKey: "live_comment_entry"'));
  }
});

test("mounts room-scoped candidate import inside device details without a main-page batch table", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  const candidateSource = fs.readFileSync(path.join(webRoot, "src/components/live-comment-entry/LiveCommentCandidates.tsx"), "utf8");
  const profileSource = fs.readFileSync(path.join(webRoot, "src/components/live-comment-entry/LiveRoomProfilePanel.tsx"), "utf8");
  const clientSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-live-comment-entry.ts"), "utf8");

  assert(!pageSource.includes("<LiveCommentCandidates"));
  assert(profileSource.includes("<LiveCommentCandidates"));
  assert(profileSource.includes('label: "评论入库"'));
  assert(candidateSource.includes("scopeLiveCommentCandidates"));
  assert(candidateSource.includes("getLiveCommentCandidates"));
  for (const text of [
    "当前直播间候选评论",
    "全选待入库",
    "取消全选",
    "抓取中",
    "已入库",
    "确认入库",
    "清洗后入库",
    "filteredCount",
    "duplicateCount"
  ]) {
    assert(candidateSource.includes(text), `missing candidate workflow text: ${text}`);
  }
  assert(candidateSource.includes("useState<string[]>([])"));
  assert(candidateSource.includes("confirmLiveCommentCandidates"));
  assert(clientSource.includes('"/admin/live-comment-candidates"'));
  assert(clientSource.includes('"/admin/live-comment-candidates/confirm"'));
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

test("opens device details with persisted room profile controls", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/LiveCommentEntryPage.tsx"), "utf8");
  const progressSource = fs.readFileSync(path.join(webRoot, "src/components/account-warmup/LiveCommentEntryProgress.tsx"), "utf8");
  const drawerSource = fs.readFileSync(path.join(webRoot, "src/components/live-comment-entry/LiveCommentDeviceDrawer.tsx"), "utf8");
  const profileSource = fs.readFileSync(path.join(webRoot, "src/components/live-comment-entry/LiveRoomProfilePanel.tsx"), "utf8");
  const clientSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-live-comment-entry.ts"), "utf8");

  assert(pageSource.includes("LiveCommentDeviceDrawer"));
  assert(progressSource.includes("查看详情"));
  assert(drawerSource.includes("deviceId"));
  assert(drawerSource.includes("roomKey"));
  assert(drawerSource.includes("batchId"));
  assert(profileSource.includes("解析用户画像"));
  assert(profileSource.includes("已解析"));
  assert(profileSource.includes("导出 Markdown"));
  assert(profileSource.includes("解析中"));
  assert(clientSource.includes("/admin/live-room-captures"));
  assert(clientSource.includes("/profile"));
  assert(clientSource.includes("/markdown"));
});
