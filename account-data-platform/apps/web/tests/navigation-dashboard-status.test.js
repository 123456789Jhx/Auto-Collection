import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.join(currentDir, "../src");
const appSource = fs.readFileSync(path.join(webSrcDir, "routes/App.tsx"), "utf8");
const dashboardSource = fs.readFileSync(path.join(webSrcDir, "routes/DashboardPage.tsx"), "utf8");
const logsSource = fs.readFileSync(path.join(webSrcDir, "routes/LogsPage.tsx"), "utf8");
const schedulerSource = fs.readFileSync(path.join(webSrcDir, "routes/TaskSchedulerPage.tsx"), "utf8");

test("后台导航不再暴露独立直播评论入口", () => {
  assert.strictEqual(/import\s+\{\s*LiveCommentsPage\s*\}/.test(appSource), false, "App should not import the standalone live comments page");
  assert.strictEqual(/liveComments\s*:/.test(appSource), false, "pages should not keep a standalone liveComments route");
  assert.strictEqual(/key:\s*["']liveComments["']/.test(appSource), false, "sidebar should not render a standalone live comments menu item");
});

test("任务调度继续承接直播评论任务控制", () => {
  assert(/type\s+TaskType\s*=\s*["']video["']\s*\|\s*["']live["']\s*\|\s*["']live_comment["']/.test(schedulerSource), "scheduler must keep live_comment as a task type");
  assert(/assignTask\(row,\s*["']live_comment["']\)/.test(schedulerSource), "scheduler row actions must still dispatch live_comment tasks");
  assert(/selectedDeviceState\s*&&\s*assignTask\(selectedDeviceState,\s*["']live_comment["']\)/.test(schedulerSource), "scheduler detail actions must still dispatch live_comment tasks");
});

test("任务调度提供暂停恢复和任务不一致诊断", () => {
  assert(/assignTask\(row,\s*taskTypeForControl\(row\),\s*["']PAUSE["']\)/.test(schedulerSource), "row actions must dispatch PAUSE for the current task");
  assert(/assignTask\(row,\s*taskTypeForControl\(row\),\s*["']RESUME["']\)/.test(schedulerSource), "row actions must dispatch RESUME for the current task");
  assert(/selectedDeviceState\s*&&\s*assignTask\(selectedDeviceState,\s*taskTypeForControl\(selectedDeviceState\),\s*["']PAUSE["']\)/.test(schedulerSource), "detail actions must dispatch PAUSE for the current task");
  assert(/selectedDeviceState\s*&&\s*assignTask\(selectedDeviceState,\s*taskTypeForControl\(selectedDeviceState\),\s*["']RESUME["']\)/.test(schedulerSource), "detail actions must dispatch RESUME for the current task");
  assert(/hasTaskMismatch/.test(schedulerSource), "scheduler must compute assignment versus actual task mismatch");
  assert(/任务不一致/.test(schedulerSource), "scheduler must show task mismatch in user-facing text");
});

test("搜索直播评论和商品卡直播评论是两个独立任务入口", () => {
  assert(/commerce_card_live_comment/.test(schedulerSource), "scheduler must expose commerce card live comment as an independent task type");
  assert(/commerceStartMode:\s*["']product_nurture["']/.test(schedulerSource), "scheduler row actions must expose a product nurture start mode");
  assert(/commerceStartMode:\s*["']target_comment["']/.test(schedulerSource), "scheduler row actions must expose a target comment start mode");
  assert(/commerceCardStartMode/.test(schedulerSource), "scheduler must send the selected commerce-card start mode to the API");
  assert(/商品卡养号/.test(schedulerSource), "scheduler must show a dedicated product nurture button");
  assert(/目标直播间评论（商品卡片养号）/.test(schedulerSource), "scheduler must show a clearly named target live comment button");
  assert(/搜索直播间评论/.test(schedulerSource), "old live_comment label must make the search-room flow explicit");
  assert(/商品卡直播评论/.test(schedulerSource), "new commerce-card flow must have a separate label");
  assert(/commerce_card_live_comment/.test(dashboardSource), "dashboard must recognize commerce-card live comment task status");
  assert(/商品卡直播评论/.test(logsSource), "logs must display commerce-card live comment phases distinctly");
});

test("工作台展示功能状态看板而不是完整技术日志", () => {
  assert(/latestLogAt\?:\s*string\s*\|\s*null/.test(dashboardSource), "dashboard device model should include latest structured log time");
  assert(/latestFileUploadedAt\?:\s*string\s*\|\s*null/.test(dashboardSource), "dashboard device model should include latest full log upload time");
  assert(/功能状态看板/.test(dashboardSource), "dashboard should render a feature status board");
  assert(/设备在线/.test(dashboardSource), "feature board should show device online status");
  assert(/配置同步/.test(dashboardSource), "feature board should show config sync status");
  assert(/采集链路/.test(dashboardSource), "feature board should show collection status");
  assert(/日志同步/.test(dashboardSource), "feature board should show log sync status");
});

test("工作台设备卡片采用有序行式布局", () => {
  assert(/device-run-status-line/.test(dashboardSource), "device card should group current state into a compact status line");
  assert(/device-run-body/.test(dashboardSource), "device card should group progress, feature status and metrics into a body area");
  assert(/device-run-ops/.test(dashboardSource), "device card should keep action buttons in a dedicated operations area");
  assert(/device-feature-list/.test(dashboardSource), "device card should render feature states as an ordered list");
});

test("工作台配置按钮打开表单而不是下发刷新指令", () => {
  assert(/DeviceLiveCommentConfigModal/.test(dashboardSource), "dashboard should reuse the live comment config modal");
  assert(/openDashboardConfig\(item\)/.test(dashboardSource), "device card config action should open the config form");
  assert(!/refreshDeviceConfig\(item\.deviceCode\)/.test(dashboardSource), "card label 配置 must not send REFRESH_CONFIG directly");
  assert(/刷新配置/.test(dashboardSource), "refresh command should keep explicit wording");
});

test("工作台状态控制统一跳转任务调度", () => {
  assert(/DashboardPage onOpenScheduler=\{openScheduler\}/.test(appSource), "App should pass a real scheduler navigation callback to the dashboard");
  assert(/onOpenScheduler:\s*\(\)\s*=>\s*void/.test(dashboardSource), "dashboard should require the scheduler navigation callback");
  assert(/前往任务调度/.test(dashboardSource), "device details should guide operators to task scheduling");
  assert(/<ControlOutlined \/>任务调度/.test(dashboardSource), "device cards should expose the scheduler command");
  assert(!/sendCommand\(/.test(dashboardSource), "dashboard must not keep the generic state-command sender");
  assert(!/commandType:\s*["'](?:START|PAUSE|RESUME|STOP)["']/.test(dashboardSource), "dashboard must not create assignment state commands directly");
  assert(/commandType:\s*["']REFRESH_CONFIG["']/.test(dashboardSource), "dashboard may keep the non-assignment refresh command");
});
