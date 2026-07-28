import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const page = fs.readFileSync(path.join(webRoot, "src/routes/PublishTasksPage.tsx"), "utf8");
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
  assert(page.includes('record.status === "TOPIC_PENDING"'));
  assert(page.includes("补全话题"));
});
