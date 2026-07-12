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
const deviceConfigModalSource = fs.readFileSync(path.join(webSrcDir, "routes/DeviceLiveCommentConfigModal.tsx"), "utf8");
const repoRootDir = path.join(currentDir, "../../../..");
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
  assert(/DeviceLiveCommentConfigModal/.test(schedulerSource), "scheduler should mount the shared device config modal");
  assert(/getDeviceTaskConfig/.test(deviceConfigModalSource), "scheduler config modal should load per-device task config");
  assert(/updateDeviceTaskConfig/.test(deviceConfigModalSource), "scheduler config modal should save per-device task config");
  assert(/scheduler-config-modal/.test(deviceConfigModalSource), "scheduler should render a configuration modal");
  assert(/搜索关键词/.test(deviceConfigModalSource), "modal should expose search keyword field");
  assert(/目标直播间名称/.test(deviceConfigModalSource), "modal should expose target room field");
  assert(/直播间评论上限/.test(deviceConfigModalSource), "modal should expose room comment limit");
  assert(/每小时直播评论上限/.test(deviceConfigModalSource), "modal should expose hourly comment limit");
  assert(/目标直播间发送上限/.test(deviceConfigModalSource), "modal should expose target send limit");
  assert(/目标房间发送间隔/.test(deviceConfigModalSource), "modal should expose target interval");
  assert(/评论内容/.test(deviceConfigModalSource), "modal should expose comment content");
  assert(/REFRESH_CONFIG/.test(deviceConfigModalSource), "modal copy should reflect save-triggered phone config refresh");
});

test("任务调度按运行状态阻止直接切换并使用稳定控制幂等键", () => {
  assert(/function taskAssignmentCommandIdempotencyKey/.test(schedulerSource), "scheduler should build assignment command idempotency keys explicitly");
  assert(/state:\$\{stateVersion\}/.test(schedulerSource), "idempotency keys should be stable for the same assignment state version");
  assert(!/crypto\.randomUUID/.test(schedulerSource), "control commands must not depend on secure-context randomUUID support");
  assert(/commandIdempotencyKey:\s*taskAssignmentCommandIdempotencyKey/.test(schedulerSource), "control requests should use the stable key builder");
  assert(/commandType\s*===\s*"START"\s*&&\s*isActiveAssignment/.test(schedulerSource), "START should be rejected locally while an assignment is active");
  assert(/detailStartBlocked/.test(schedulerSource), "detail controls should disable new START actions while a run is active");
  assert(/先停止当前任务并等待结束后/.test(schedulerSource), "operators should see the required stop-then-wait workflow");
});

test("配置页恢复公共模板原有表单口径", () => {
  assert(/<h1>配置<\/h1>/.test(tasksSource), "TasksPage should use the config page title");
  assert(/维护公共任务模板、直播评论机器人话术和高级 JSON；设备单独覆盖在设备运行页处理。/.test(tasksSource), "TasksPage should restore the original config description");
  assert(/直播聊天机器人配置/.test(tasksSource), "modal title should be restored from public template wording");
  assert(/模板配置会作为所有设备默认值/.test(tasksSource), "alert title should restore default-template wording");
  assert(/设备级配置可以覆盖模板/.test(tasksSource), "alert description should restore device override wording");
  assert(/Segmented/.test(tasksSource), "config page should switch between templates and live targets");
  assert(/LiveTargetsPage/.test(tasksSource), "config page should embed live target management without restoring a sidebar route");
});

test("API client exposes live-targets admin operations", () => {
  assert(/getLiveTargets/.test(apiClientSource), "api client should expose getLiveTargets");
  assert(/saveLiveTarget/.test(apiClientSource), "api client should expose saveLiveTarget");
  assert(/saveLiveTargetFeatureConfig/.test(apiClientSource), "api client should expose saveLiveTargetFeatureConfig");
  assert(/saveDeviceLiveTargetBindings/.test(apiClientSource), "api client should expose saveDeviceLiveTargetBindings");
  assert(/\/admin\/live-targets/.test(apiClientSource), "api client should call /admin/live-targets");
});

test("直播目标配置页面管理目标、三阶段组合和默认关闭门禁", () => {
  assert(fs.existsSync(liveTargetsPagePath), "LiveTargetsPage.tsx should exist");
  const source = fs.readFileSync(liveTargetsPagePath, "utf8");
  assert(/目标直播间/.test(source), "page should display target live room wording");
  assert(/直播间别名/.test(source), "page should manage aliases");
  assert(/搜索直播评论/.test(source), "page should manage search live comment config");
  assert(/商品卡组合任务/.test(source), "page should manage the commerce-card workflow");
  assert(/相似度阈值/.test(source), "page should expose similarity threshold");
  assert(/商品卡养号/.test(source), "page should expose the product nurture stage");
  assert(/目标直播评论/.test(source), "page should expose the target comment stage");
  assert(/直播养号2/.test(source), "page should expose the second live nurture stage");
  assert(/executeEnabled/.test(source), "page should keep the realtime execute switch explicit");
  assert(/getCommerceCardFeaturePreview/.test(source), "page should load a server-generated V2 preview");
  assert(/getFeatureRolloutControls/.test(source), "page should show persisted rollout controls");
  assert(/activationReady/.test(source), "stage A should keep unsafe activation disabled");
  assert(/expectedRevision/.test(source), "saves should use optimistic configuration revision checks");
});

test("automation helper scripts cover submit deploy and USB apk install", () => {
  const quickSubmitPath = path.join(repoRootDir, "scripts/quick-submit.ps1");
  const deployPath = path.join(repoRootDir, "scripts/deploy-web-fast.ps1");
  const installPath = path.join(repoRootDir, "scripts/install-apk-usb.ps1");

  assert(fs.existsSync(quickSubmitPath), "quick-submit.ps1 should exist");
  assert(fs.existsSync(deployPath), "deploy-web-fast.ps1 should exist");
  assert(fs.existsSync(installPath), "install-apk-usb.ps1 should exist");

  const quickSubmitSource = fs.readFileSync(quickSubmitPath, "utf8");
  const deploySource = fs.readFileSync(deployPath, "utf8");
  const installSource = fs.readFileSync(installPath, "utf8");

  assert(/git commit/.test(quickSubmitSource), "quick submit should commit staged work");
  assert(/git push/.test(quickSubmitSource), "quick submit should push selected remotes");
  assert(/origin/.test(quickSubmitSource) && /tomato/.test(quickSubmitSource), "quick submit should default to both project remotes");
  assert(/git diff --check/.test(quickSubmitSource), "quick submit should run whitespace conflict checks");
  assert(/GIT_SSH_COMMAND/.test(quickSubmitSource), "quick submit should keep SSH configuration explicit");

  assert(/paramiko/.test(deploySource), "server deploy should use SSH automation");
  assert(/account-data-platform/.test(deploySource), "server deploy should target account-data-platform");
  assert(/docker compose/.test(deploySource), "server deploy should rebuild and restart compose services");
  assert(/build web/.test(deploySource), "server deploy should rebuild only the web service");
  assert(/up -d --no-deps web/.test(deploySource), "server deploy should restart only the web service");
  assert(/\/health/.test(deploySource) && /\/ready/.test(deploySource), "server deploy should verify health endpoints");

  assert(/adb devices/.test(installSource), "USB install should enumerate attached devices");
  assert(/adb uninstall/.test(installSource), "USB install should uninstall the existing package first");
  assert(/adb install/.test(installSource), "USB install should attempt direct adb install");
  assert(/INSTALL_FAILED_USER_RESTRICTED/.test(installSource), "USB install should detect MIUI user restriction");
  assert(/sdcard\/Download/.test(installSource), "USB install should push APK for manual installer fallback");
  assert(/am start/.test(installSource), "USB install should launch the system package installer when restricted");
  assert(/previousErrorActionPreference/.test(installSource), "USB install should preserve caller error handling around adb");
  assert(/\$ErrorActionPreference\s*=\s*"Continue"/.test(installSource), "USB install should capture adb stderr without aborting MIUI fallback");
  assert(/PSNativeCommandUseErrorActionPreference/.test(installSource), "USB install should disable native command promotion while capturing adb output");
});
