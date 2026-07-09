import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.join(currentDir, "../src");
const appSource = fs.readFileSync(path.join(webSrcDir, "routes/App.tsx"), "utf8");
const apiClientSource = fs.readFileSync(path.join(webSrcDir, "lib/api-client.ts"), "utf8");
const schedulerSource = fs.readFileSync(path.join(webSrcDir, "routes/TaskSchedulerPage.tsx"), "utf8");
const tasksSource = fs.readFileSync(path.join(webSrcDir, "routes/TasksPage.tsx"), "utf8");
const configCenterPagePath = path.join(webSrcDir, "routes/ConfigCenterPage.tsx");
const liveTargetsPagePath = path.join(webSrcDir, "routes/LiveTargetsPage.tsx");

test("后台导航恢复配置侧边栏并移除配置中心", () => {
  assert(!/ConfigCenterPage/.test(appSource), "App should not import ConfigCenterPage");
  assert(!/configCenter/.test(appSource), "pages should not keep a configCenter route key");
  assert(!/配置中心/.test(appSource), "sidebar should not render config center text");
  assert(/TasksPage/.test(appSource), "App should import and render TasksPage");
  assert(/key:\s*"tasks"/.test(appSource), "sidebar should keep the config route key");
  assert(/label:\s*"配置"/.test(appSource), "sidebar should render config text");
  assert(!/key:\s*"liveTargets"/.test(appSource), "live target config should not stay as a top-level sidebar route");
  assert(!/label:\s*"直播目标配置"/.test(appSource), "live target config should not stay as a top-level sidebar route");
});

test("任务调度内置单台手机直播评论配置弹窗", () => {
  assert(!fs.existsSync(configCenterPagePath), "ConfigCenterPage.tsx should be removed");
  assert(/getDeviceTaskConfig/.test(schedulerSource), "scheduler config modal should load per-device task config");
  assert(/updateDeviceTaskConfig/.test(schedulerSource), "scheduler config modal should save per-device task config");
  assert(/scheduler-config-modal/.test(schedulerSource), "scheduler should render a configuration modal");
  assert(/搜索关键词/.test(schedulerSource), "modal should expose search keyword field");
  assert(/目标直播间名称/.test(schedulerSource), "modal should expose target room field");
  assert(/直播间评论上限/.test(schedulerSource), "modal should expose room comment limit");
  assert(/每小时直播评论上限/.test(schedulerSource), "modal should expose hourly comment limit");
  assert(/目标直播间发送上限/.test(schedulerSource), "modal should expose target send limit");
  assert(/目标房间发送间隔/.test(schedulerSource), "modal should expose target interval");
  assert(/评论内容/.test(schedulerSource), "modal should expose comment content");
  assert(/REFRESH_CONFIG/.test(schedulerSource), "modal copy should reflect save-triggered phone config refresh");
});

test("配置页恢复公共模板原有表单口径", () => {
  assert(/<h1>配置<\/h1>/.test(tasksSource), "TasksPage should use the config page title");
  assert(/维护公共任务模板、直播评论机器人话术和高级 JSON；设备单独覆盖在设备运行页处理。/.test(tasksSource), "TasksPage should restore the original config description");
  assert(/直播聊天机器人配置/.test(tasksSource), "modal title should be restored from public template wording");
  assert(/模板配置会作为所有设备默认值/.test(tasksSource), "alert title should restore default-template wording");
  assert(/设备级配置可以覆盖模板/.test(tasksSource), "alert description should restore device override wording");
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
