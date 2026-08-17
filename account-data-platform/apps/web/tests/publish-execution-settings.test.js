import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";
import {
  publishTimingPayloadToMilliseconds,
  publishTimingPayloadToSeconds,
  publishTimingSchemaForUi,
  validatePublishTimingSeconds
} from "../src/lib/publish-execution-timing";

const webRoot = path.resolve(import.meta.dir, "..");
const routesDir = path.join(webRoot, "src/routes");
const remoteScriptsPath = path.join(routesDir, "RemoteScriptsPage.tsx");
const modalPath = path.join(routesDir, "RemoteScriptConfigModal.tsx");
const settingsPath = path.join(routesDir, "PublishExecutionSettingsPage.tsx");

test("发布设置仅使用直接素材配置并隐藏设备绑定操作", () => {
  const remoteScripts = fs.readFileSync(remoteScriptsPath, "utf8");
  const modal = fs.readFileSync(modalPath, "utf8");
  const settings = fs.readFileSync(settingsPath, "utf8");

  assert(remoteScripts.includes("publishSourceMode?: PublishSourceMode"));
  assert(remoteScripts.includes("hideBindingAction?: boolean"));
  assert(remoteScripts.includes("defaultPublishSourceMode?: PublishSourceMode"));
  assert(remoteScripts.includes('config.configPayload.sourceMode === "direct_material" ? "direct_material" : "external_pull"'));
  assert(remoteScripts.includes('hideAdvancedJson={publishSourceMode === "direct_material"}'));
  assert(remoteScripts.includes("检测到多个默认发布执行配置，请保留一个默认配置。"));
  assert(modal.includes("lockedPublishSourceMode?: PublishSourceMode"));
  assert(modal.includes("hideAdvancedJson?: boolean"));
  assert(settings.includes('title="发布设置"'));
  assert(settings.includes('publishSourceMode="direct_material"'));
  assert(settings.includes('defaultPublishSourceMode="direct_material"'));
  assert(settings.includes("hideBindingAction"));
  assert(modal.includes("publishTimingPayloadToSeconds"));
  assert(modal.includes("publishTimingPayloadToMilliseconds"));
  assert(modal.includes("JSON 高级编辑（时间字段保持毫秒）"));
});

test("发布设置时间闸口在表单秒与 payload 毫秒之间稳定转换", () => {
  const payload = {
    responseDelayMsMin: 700,
    responseDelayMsMax: 1200,
    actionWaitMsMin: 900,
    actionWaitMsMax: 1500,
    expectedTopicCount: 5
  };
  const formPayload = publishTimingPayloadToSeconds("publish_video", payload);

  assert.deepEqual(formPayload, {
    ...payload,
    responseDelayMsMin: 0.7,
    responseDelayMsMax: 1.2,
    actionWaitMsMin: 0.9,
    actionWaitMsMax: 1.5
  });
  assert.deepEqual(publishTimingPayloadToMilliseconds("publish_video", formPayload), payload);
  assert.deepEqual(publishTimingPayloadToMilliseconds("other_script", { responseDelayMsMin: 0.8 }), {
    responseDelayMsMin: 0.8
  });
});

test("发布设置时间闸口支持小数秒并阻断负数和反向区间", () => {
  assert.deepEqual(publishTimingPayloadToMilliseconds("publish_video", {
    responseDelayMsMin: 0.8,
    responseDelayMsMax: 1.5,
    actionWaitMsMin: 0.1,
    actionWaitMsMax: 0.5
  }), {
    responseDelayMsMin: 800,
    responseDelayMsMax: 1500,
    actionWaitMsMin: 100,
    actionWaitMsMax: 500
  });
  assert.deepEqual(validatePublishTimingSeconds({
    responseDelayMsMin: 1.5,
    responseDelayMsMax: 1.4
  }), { field: "responseDelayMsMax", message: "响应延迟最大值不能小于最小值" });
  assert.deepEqual(validatePublishTimingSeconds({ actionWaitMsMin: -0.1 }), {
    field: "actionWaitMsMin",
    message: "动作等待最小值不能小于 0 秒"
  });
  const schema = publishTimingSchemaForUi({
    type: "object",
    properties: { responseDelayMsMin: { type: "integer", minimum: 1, description: "响应延迟最小值（毫秒）" } }
  });
  assert.deepEqual(schema?.properties?.responseDelayMsMin, {
    type: "number",
    minimum: 0,
    description: "响应延迟最小值（秒）"
  });
});
