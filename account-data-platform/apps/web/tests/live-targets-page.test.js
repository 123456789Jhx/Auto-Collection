import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.join(currentDir, "../src");
const appSource = fs.readFileSync(path.join(webSrcDir, "routes/App.tsx"), "utf8");
const apiClientSource = fs.readFileSync(path.join(webSrcDir, "lib/api-client.ts"), "utf8");
const configCenterPagePath = path.join(webSrcDir, "routes/ConfigCenterPage.tsx");
const liveTargetsPagePath = path.join(webSrcDir, "routes/LiveTargetsPage.tsx");

test("后台导航收敛到配置中心", () => {
  assert(/ConfigCenterPage/.test(appSource), "App should import and render ConfigCenterPage");
  assert(/configCenter/.test(appSource), "pages should include a configCenter route key");
  assert(/配置中心/.test(appSource), "sidebar should render config center text");
  assert(!/key:\s*"liveTargets"/.test(appSource), "live target config should not stay as a top-level sidebar route");
  assert(!/label:\s*"直播目标配置"/.test(appSource), "live target config should be inside config center instead of sidebar");
});

test("配置中心按手机维护直播评论和商品卡配置", () => {
  assert(fs.existsSync(configCenterPagePath), "ConfigCenterPage.tsx should exist");
  const source = fs.readFileSync(configCenterPagePath, "utf8");
  assert(/getDevices/.test(source), "config center should load device list");
  assert(/getDeviceTaskConfig/.test(source), "config center should load per-device task config");
  assert(/updateDeviceTaskConfig/.test(source), "config center should save per-device task config");
  assert(/按手机配置/.test(source), "config center should use per-phone configuration wording");
  assert(/目标直播间名称/.test(source), "config center should edit target live room name per phone");
  assert(/搜索直播评论/.test(source), "config center should expose search live comment settings");
  assert(/商品卡直播评论/.test(source), "config center should expose commerce-card live comment settings");
  assert(/商品卡搜索关键词/.test(source), "config center should edit commerce-card search keywords");
  assert(!/LiveTargetsPage/.test(source), "config center should not use the old public live target page as the main UI");
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
