import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("发布设置保存不等待宽泛配置刷新", () => {
  const source = read("apps/web/src/routes/RemoteScriptsPage.tsx");
  assert(source.includes("remoteScriptConfigsKey"));
  assert(source.includes("exact: true"));
  assert(source.includes("void refreshList()"));
  assert(!source.includes('queryKey: ["remoteScriptConfigs"]'));
  assert(source.includes("paste-publish"));
});

test("管理端请求有统一超时提示", () => {
  const source = read("apps/web/src/lib/api-client.ts");
  assert(source.includes("fetchWithTimeout"));
  assert(source.includes("new AbortController()"));
  assert(source.includes("API_REQUEST_TIMEOUT"));
  assert(source.includes("如刚刚执行了保存，请刷新列表确认"));
});

test("直接素材配置默认值完整且不会携带外部字段", () => {
  const source = read("apps/web/src/routes/RemoteScriptConfigModal.tsx");
  for (const field of [
    "responseDelayMsMin",
    "responseDelayMsMax",
    "actionWaitMsMin",
    "actionWaitMsMax",
    "expectedTopicCount",
    "requireCover",
    "topicResolveTimeoutMinutes",
    "downloadDir"
  ]) assert(source.includes(field), `missing ${field}`);
  assert(source.includes("directMaterialExternalFields"));
  assert(source.includes('hiddenFieldKeys={selectedScriptKey === "publish_video"'));
});

test("后端更新跳过无变化写入并异步通知设备", () => {
  const service = read("apps/api/src/services/remote-script.service.ts");
  const repository = read("apps/api/src/repositories/remote-script.repository.ts");
  assert(service.includes("const unchanged"));
  assert(service.includes("notificationQueued: false"));
  assert(service.includes("queueConfigUpdateNotification"));
  assert(service.includes("notification_failed"));
  assert(repository.includes('query.sourceMode === "direct_material"'));
  assert(repository.includes('query.sourceMode === "external_pull"'));
});
