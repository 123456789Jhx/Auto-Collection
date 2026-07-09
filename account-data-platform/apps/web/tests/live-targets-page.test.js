import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.join(currentDir, "../src");
const appSource = fs.readFileSync(path.join(webSrcDir, "routes/App.tsx"), "utf8");
const apiClientSource = fs.readFileSync(path.join(webSrcDir, "lib/api-client.ts"), "utf8");
const liveTargetsPagePath = path.join(webSrcDir, "routes/LiveTargetsPage.tsx");

test("后台导航暴露直播目标配置页面", () => {
  assert(/LiveTargetsPage/.test(appSource), "App should import and render LiveTargetsPage");
  assert(/liveTargets/.test(appSource), "pages should include a liveTargets route key");
  assert(/直播目标配置/.test(appSource), "sidebar should render live target config text");
});

test("API client exposes live-targets admin operations", () => {
  assert(/getLiveTargets/.test(apiClientSource), "api client should expose getLiveTargets");
  assert(/saveLiveTarget/.test(apiClientSource), "api client should expose saveLiveTarget");
  assert(/saveLiveTargetFeatureConfig/.test(apiClientSource), "api client should expose saveLiveTargetFeatureConfig");
  assert(/saveDeviceLiveTargetBindings/.test(apiClientSource), "api client should expose saveDeviceLiveTargetBindings");
  assert(/\/admin\/live-targets/.test(apiClientSource), "api client should call /admin/live-targets");
});

test("直播目标配置页面管理目标名、别名和两类功能配置", () => {
  assert(fs.existsSync(liveTargetsPagePath), "LiveTargetsPage.tsx should exist");
  const source = fs.readFileSync(liveTargetsPagePath, "utf8");
  assert(/目标直播间/.test(source), "page should display target live room wording");
  assert(/直播间别名/.test(source), "page should manage aliases");
  assert(/搜索直播评论/.test(source), "page should manage search live comment config");
  assert(/商品卡直播评论/.test(source), "page should manage commerce-card live comment config");
  assert(/相似度阈值/.test(source), "page should expose similarity threshold");
});
