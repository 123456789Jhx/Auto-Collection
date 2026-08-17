import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const modulePath = path.join(webRoot, "src/routes/PublishVideoModulePage.tsx");
const pagePath = path.join(webRoot, "src/routes/SingleInterfacePublishPage.tsx");
const apiPath = path.join(webRoot, "src/lib/api-client-single-interface-publish.ts");

test("接口发布页签位于粘贴发布和接口定时之间", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  const pasteIndex = source.indexOf('key: "paste-publish"');
  const singleIndex = source.indexOf('key: "single-interface-publish"');
  const scheduleIndex = source.indexOf('key: "publish-schedules"');

  assert(pasteIndex >= 0);
  assert(singleIndex > pasteIndex);
  assert(scheduleIndex > singleIndex);
  assert(source.includes('label: "接口发布"'));
  assert(source.includes("SingleInterfacePublishPage"));
});

test("接口发布客户端只调用项目后端的启动、状态和停止接口", () => {
  assert(fs.existsSync(apiPath), "single interface publish api client should exist");
  const source = fs.readFileSync(apiPath, "utf8");

  assert(source.includes('mutate<SingleInterfacePublishRun>("/admin/single-interface-publish/start", {})'));
  assert(source.includes('request<SingleInterfacePublishRun>("/admin/single-interface-publish/current")'));
  assert(source.includes('mutate<SingleInterfacePublishRun>("/admin/single-interface-publish/stop", {})'));
  assert(!source.includes("wecom.dafengchan.top"));
  assert(!source.includes("Authorization"));
  assert(!source.includes("EXTERNAL_API_ACCESS_TOKEN"));
});

test("接口发布页面显示固定绑定、任务摘要并提供启动停止控制", () => {
  assert(fs.existsSync(pagePath), "SingleInterfacePublishPage.tsx should exist");
  const source = fs.readFileSync(pagePath, "utf8");

  for (const text of ["接口发布", "勤能致富", "23362504586", "启动", "停止", "当前状态", "任务摘要"]) {
    assert(source.includes(text), `missing ${text}`);
  }
  assert(source.includes("useQuery"));
  assert(source.includes("refetchInterval"));
  assert(source.includes("getCurrentSingleInterfacePublish"));
  assert(source.includes("startSingleInterfacePublish"));
  assert(source.includes("stopSingleInterfacePublish"));
  assert(source.includes("queryClient.invalidateQueries"));
});

test("接口发布执行期间禁止重复启动", () => {
  const source = fs.readFileSync(pagePath, "utf8");

  assert(source.includes('const canStart = ["IDLE", "STOPPED", "SUCCEEDED", "FAILED"].includes(status);'));
  assert(source.includes("disabled={changing || !canStart}"));
});
