import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildAccountWarmupCommands,
  dispatchAccountWarmupCommandsAndSaveVocabulary,
  dispatchAccountWarmupCommands,
  dispatchAccountWarmupStops,
  getSharedVocabularyDeleteError,
  getSharedVocabularyQueryState,
  readActiveAccountWarmupBatchId,
  mapAccountWarmupCommandStatus,
  normalizeCommentLibrary,
  normalizeRelatedTerms,
  resolveSharedVocabularyOption,
  sharedVocabularyInvalidationKey,
  writeActiveAccountWarmupBatchId
} from "../src/lib/account-warmup-form.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizes user-entered related term tags", () => {
  assert.deepEqual(normalizeRelatedTerms([" 当归，三七 ", "何首乌", "当归"]), ["当归", "三七", "何首乌"]);
});

test("normalizes editable comment library tags", () => {
  assert.deepEqual(normalizeCommentLibrary([" 111，666 ", "888", "111", " "]), ["111", "666", "888"]);
});

test("fans one target keyword out to independent device commands", () => {
  const commands = buildAccountWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "药材种植",
    relatedTerms: ["当归", "三七"],
    commentLibrary: ["111", "666", "111"],
    deviceCodes: ["device-a", "device-b"]
  });

  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map((item) => item.deviceId), ["device-a", "device-b"]);
  assert(commands.every((item) => item.commandType === "ACCOUNT_WARMUP_RUN"));
  assert(commands.every((item) => item.payload.featureKey === "target_live_interaction"));
  assert(commands.every((item) => JSON.stringify(item.payload.config.commentLibrary) === JSON.stringify(["111", "666"])));
  assert(commands.every((item) => item.payload.config.maxRounds === 3 && item.payload.config.candidatesPerRound === 4));
});

test("keeps a partially dispatched batch visible and restores it after refresh", async () => {
  const commands = buildAccountWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "药材种植",
    relatedTerms: ["当归"],
    deviceCodes: ["device-a", "device-b"]
  });
  const result = await dispatchAccountWarmupCommands(commands, async (command) => {
    if (command.deviceId === "device-b") throw new Error("offline");
    return { id: command.deviceId };
  });
  assert.equal(result.succeededCount, 1);
  assert.equal(result.failedCount, 1);

  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  writeActiveAccountWarmupBatchId(commands[0].payload.batchId, storage);
  assert.equal(readActiveAccountWarmupBatchId(storage), commands[0].payload.batchId);
});

test("saves normalized shared vocabulary once after any device command succeeds", async () => {
  const commands = buildAccountWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "药材种植",
    relatedTerms: [" 当归，三七 ", "当归"],
    commentLibrary: [" 111 ", "111", "666"],
    deviceCodes: ["device-a", "device-b"]
  });
  const saved = [];

  const result = await dispatchAccountWarmupCommandsAndSaveVocabulary(
    commands,
    async (command) => {
      if (command.deviceId === "device-b") throw new Error("offline");
      return { id: command.deviceId };
    },
    async (payload) => {
      saved.push(payload);
      return [];
    }
  );

  assert.equal(result.succeededCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.vocabularySaveError, undefined);
  assert.deepEqual(saved, [{ relatedTerms: ["当归", "三七"], comments: ["111", "666"] }]);
});

test("does not save shared vocabulary when every device command fails", async () => {
  const commands = buildAccountWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "药材种植",
    relatedTerms: ["当归"],
    commentLibrary: ["111"],
    deviceCodes: ["device-a", "device-b"]
  });
  let saveCount = 0;

  const result = await dispatchAccountWarmupCommandsAndSaveVocabulary(
    commands,
    async () => { throw new Error("offline"); },
    async () => {
      saveCount += 1;
      return [];
    }
  );

  assert.equal(result.succeededCount, 0);
  assert.equal(saveCount, 0);
});

test("reports shared vocabulary save failures without turning task dispatch into a failure", async () => {
  const commands = buildAccountWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "药材种植",
    relatedTerms: ["当归"],
    commentLibrary: ["111"],
    deviceCodes: ["device-a"]
  });

  const result = await dispatchAccountWarmupCommandsAndSaveVocabulary(
    commands,
    async () => ({ id: "run-a" }),
    async () => { throw new Error("vocabulary unavailable"); }
  );

  assert.equal(result.succeededCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.vocabularySaveError?.message, "vocabulary unavailable");
});

test("renders manually synthesized tag options without assuming a persisted entry", () => {
  assert.deepEqual(
    resolveSharedVocabularyOption({ label: "临时手输词", value: "临时手输词" }),
    { label: "临时手输词", entry: null }
  );
  const entry = {
    id: "vocabulary-1",
    kind: "COMMENT",
    value: "这是一条共享评论",
    lastUsedAt: "2026-08-05T00:00:00.000Z"
  };
  assert.deepEqual(
    resolveSharedVocabularyOption({ label: entry.value, value: entry.value, entry }),
    { label: entry.value, entry }
  );
});

test("invalidates every cached search for the deleted vocabulary kind", () => {
  assert.deepEqual(sharedVocabularyInvalidationKey("RELATED_TERM"), ["accountWarmupVocabulary", "RELATED_TERM"]);
  assert.deepEqual(sharedVocabularyInvalidationKey("COMMENT"), ["accountWarmupVocabulary", "COMMENT"]);
});

test("query and deletion failures expose useful text while keeping manual entry enabled", () => {
  assert.deepEqual(getSharedVocabularyQueryState(false), { allowManualInput: true, hint: "" });
  assert.deepEqual(getSharedVocabularyQueryState(true), {
    allowManualInput: true,
    hint: "共享历史加载失败，仍可手动输入"
  });
  assert.equal(getSharedVocabularyDeleteError(new Error("network down")), "共享历史删除失败：network down");
  assert.equal(getSharedVocabularyDeleteError("unknown"), "共享历史删除失败，请稍后重试");
});

test("maps device command lifecycle to operator-facing states", () => {
  assert.equal(mapAccountWarmupCommandStatus({ status: "PENDING" }).label, "等待下发");
  assert.equal(mapAccountWarmupCommandStatus({ status: "FETCHED" }).label, "搜索中");
  assert.equal(mapAccountWarmupCommandStatus({ status: "DONE", resultJson: { status: "TARGET_LIVE_ENTERED" } }).label, "已进入");
  assert.equal(mapAccountWarmupCommandStatus({ status: "FAILED", resultJson: { status: "TARGET_LIVE_NOT_FOUND" } }).label, "未找到");
  assert.equal(mapAccountWarmupCommandStatus({ status: "DONE", resultJson: { status: "STOPPED" } }).label, "已停止");
  assert.equal(mapAccountWarmupCommandStatus({ status: "FETCHED" }, true).label, "停止中");
});

test("keeps successful stop requests pending while exposing failed device ids", async () => {
  const result = await dispatchAccountWarmupStops([
    { id: "run-a", deviceCode: "device-a" },
    { id: "run-b", deviceCode: "device-b" }
  ], async (command) => {
    if (command.id === "run-b") throw new Error("offline");
    return { id: command.id };
  });

  assert.deepEqual(result.succeededIds, ["run-a"]);
  assert.deepEqual(result.failedIds, ["run-b"]);
  assert.equal(result.failedCount, 1);
});

test("mounts target-live interaction under the standalone warmup module", () => {
  const videoSource = fs.readFileSync(path.join(webRoot, "src/routes/PublishVideoModulePage.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(webRoot, "src/routes/App.tsx"), "utf8");
  const modulePath = path.join(webRoot, "src/routes/AccountWarmupModulePage.tsx");
  assert(fs.existsSync(modulePath), "AccountWarmupModulePage.tsx should exist");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/AccountWarmupPage.tsx"), "utf8");
  const vocabularySource = fs.readFileSync(path.join(webRoot, "src/components/account-warmup/SharedVocabularySelect.tsx"), "utf8");
  const apiSource = fs.readFileSync(path.join(webRoot, "src/lib/api-client-account-warmup.ts"), "utf8");

  assert(!videoSource.includes('label: "养号"'));
  assert(appSource.includes('{ key: "accountWarmup"'));
  assert(appSource.indexOf('{ key: "publishVideo"') < appSource.indexOf('{ key: "accountWarmup"'));
  assert(appSource.indexOf('{ key: "accountWarmup"') < appSource.indexOf('{ key: "logs"'));
  assert(moduleSource.includes('label: "目标直播间互动养号"'));
  assert(moduleSource.includes("AccountWarmupPage"));
  for (const text of ["目标直播间互动养号", "目标直播间关键词", "直播间相关名词", "评论词库", "选择执行设备", "开始查找", "停止任务"]) {
    assert(pageSource.includes(text), `missing ${text}`);
  }
  assert(!pageSource.includes(">全部停止<"));
  assert(pageSource.includes("stoppingCommandIds"));
  assert(pageSource.includes('mode="multiple"'));
  assert(pageSource.includes("SharedVocabularySelect"));
  assert(pageSource.includes("readActiveAccountWarmupBatchId"));
  assert(pageSource.includes("writeActiveAccountWarmupBatchId"));
  assert(pageSource.includes("dispatchAccountWarmupCommands"));
  assert(pageSource.includes("dispatchAccountWarmupCommandsAndSaveVocabulary"));
  assert(pageSource.includes("任务已发布，但共享词库保存失败"));
  assert(pageSource.includes('kind="RELATED_TERM"'));
  assert(pageSource.includes('kind="COMMENT"'));
  assert(vocabularySource.includes('mode="tags"'));
  assert(vocabularySource.includes("Popconfirm"));
  assert(vocabularySource.includes("Tooltip"));
  assert(vocabularySource.includes("stopPropagation"));
  assert(vocabularySource.includes("useQueryClient"));
  assert(vocabularySource.includes("invalidateQueries"));
  assert(vocabularySource.includes("resolveSharedVocabularyOption"));
  assert(vocabularySource.includes("getSharedVocabularyQueryState"));
  assert(vocabularySource.includes("getSharedVocabularyDeleteError"));
  assert(vocabularySource.includes("disabled={Boolean(props.disabled) || !queryState.allowManualInput}"));
  assert(vocabularySource.includes('classNames={{ popup: { root: "shared-vocabulary-dropdown" } }}'));
  assert(!vocabularySource.includes("popupClassName"));
  assert(apiSource.includes('request<AccountWarmupVocabularyEntry[]>("/admin/account-warmup/vocabulary"'));
  assert(apiSource.includes('mutate<AccountWarmupVocabularyEntry[]>("/admin/account-warmup/vocabulary"'));
  assert(apiSource.includes('remove<{ ok: true; id: string }>(`/admin/account-warmup/vocabulary/${encodeURIComponent(id)}`)'));
});
