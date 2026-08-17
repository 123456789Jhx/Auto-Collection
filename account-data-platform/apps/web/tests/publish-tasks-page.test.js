import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const page = fs.readFileSync(path.join(webRoot, "src/routes/PublishTasksPage.tsx"), "utf8");
const client = fs.readFileSync(path.join(webRoot, "src/lib/api-client-publish-tasks.ts"), "utf8");
const modal = fs.readFileSync(path.join(webRoot, "src/routes/PublishTopicsModal.tsx"), "utf8");
const repository = fs.readFileSync(
  path.resolve(webRoot, "../api/src/repositories/publish-dispatch.repository.ts"),
  "utf8"
);
const appRoute = fs.readFileSync(path.join(webRoot, "src/routes/App.tsx"), "utf8");

test("发布任务页提供汇总、表格和话题补发入口", () => {
  const menuItems = appRoute.match(/items=\{\[([\s\S]*?)\]\}/)?.[1] ?? "";
  assert(appRoute.includes('window.location.pathname === "/publish-tasks"'));
  assert(appRoute.includes('page === "publishTasks"'));
  assert(!menuItems.includes('key: "publishTasks"'));
  assert(!menuItems.includes('label: "发布任务"'));
  assert(page.includes("export function PublishTasksContent"));
  assert(page.includes("<PublishTasksContent />"));
  assert(page.includes("今日成功"));
  assert(page.includes("今日未发"));
  assert(page.includes("今日未命中"));
  assert(page.includes("设备忙（待重试）"));
  assert(page.includes("话题待补"));
  assert(page.includes("素材异常"));
  assert(page.includes('record.status === "TOPIC_PENDING"'));
  assert(page.includes("补全话题"));
  assert(page.includes("设备忙，等待重试"));
  assert(page.includes("需人工处理视频号验证"));
  assert(page.includes("failureCodeLabels"));
  assert(page.includes("record.dispatchRetryCount"));
  assert(page.includes("record.nextDispatchAt"));
});

test("发布任务看板展示来源与回写生命周期", () => {
  for (const field of [
    "source",
    "mode",
    "reportMode",
    "reportStatus",
    "reportAttempts",
    "reportLastError",
    "failureCode",
    "dispatchRetryCount",
    "nextDispatchAt",
    "lastDispatchAttemptAt",
    "scheduledAt"
  ]) {
    assert(client.includes(`${field}:`));
    assert(repository.includes(`${field}: publishTasks.${field}`));
  }
  assert(page.includes("接口定时"));
  assert(page.includes("粘贴发布"));
  assert(page.includes("手动测试"));
  assert(page.includes("回写状态"));
  assert(page.includes("reportStatusLabels"));
  assert(page.includes("record.reportLastError"));
});

test("话题补全弹窗按任务要求实时校验话题数量", () => {
  assert(client.includes("expectedTopicCount: number"));
  assert(repository.includes("dashboardExpectedTopicCount"));
  assert(modal.includes("validateTopicDescription"));
  assert(modal.includes("expectedTopicCount"));
  assert(modal.includes("当前话题："));
  assert(modal.includes("topicValidation.reason"));
});
