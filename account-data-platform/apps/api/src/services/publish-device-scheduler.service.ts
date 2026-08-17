import type { ExternalPublishPlatform, PublishRoutingPlatform } from "@pkg/types";
import { hasActivePublishForDevice, savePublishTaskDispatched } from "../repositories/publish-dispatch.repository";
import {
  findActivePublishClaimQuarantine,
  findOnlineDeviceForPublish,
  listEnabledPublishAccountBindings,
  listEnabledPublishDeviceSchedules,
  savePublishClaimQuarantine
} from "../repositories/publish-routing.repository";
import { saveExternalClaimedPublishTask, savePublishTaskMaterialInvalid } from "../repositories/publish-task.repository";
import { createPublishVideoTaskCommand } from "./publish-command.service";
import { isPublishTimeWithinWindows, publishVideoConfigSchema } from "./publish-config";
import { normalizeExternalPublishMaterial } from "./publish-material.service";
import { getRemoteScriptConfig } from "./remote-script.service";
import { createPublishStatusOutbox } from "./publish-status-outbox.service";
import { claimRawTask, patchTaskStatus, type WecomPublishClientOptions } from "./wecom-publish-client";

const PLATFORM_ORDER: PublishRoutingPlatform[] = ["DOUYIN", "WECHAT_CHANNELS"];
const ONLINE_WINDOW_MS = 3 * 60_000;
const MATERIAL_INVALID = "MATERIAL_INVALID";
const CLAIM_QUARANTINE_MS = 30 * 60_000;

type RawExternalTask = Record<string, unknown>;
type PublishAccountBinding = { accountName: string; accountNo?: string | null };
export type PublishDeviceSchedulerOptions = WecomPublishClientOptions;

const defaultDependencies = {
  listSchedules: listEnabledPublishDeviceSchedules,
  findOnlineDevice: findOnlineDeviceForPublish,
  hasActivePublish: hasActivePublishForDevice,
  getConfig: getRemoteScriptConfig,
  listBindings: listEnabledPublishAccountBindings,
  findClaimQuarantine: findActivePublishClaimQuarantine,
  saveClaimQuarantine: savePublishClaimQuarantine,
  claimTask: claimRawTask,
  normalizeMaterial: normalizeExternalPublishMaterial,
  saveClaimedTask: saveExternalClaimedPublishTask,
  createCommand: createPublishVideoTaskCommand,
  markDispatched: savePublishTaskDispatched,
  patchStatus: patchTaskStatus,
  saveMaterialInvalid: savePublishTaskMaterialInvalid,
  enqueueStatusOutbox: createPublishStatusOutbox
};

export type PublishDeviceSchedulerDependencies = typeof defaultDependencies;

function externalPlatform(platform: PublishRoutingPlatform): ExternalPublishPlatform {
  return platform === "DOUYIN" ? "\u6296\u97f3" : "\u89c6\u9891\u53f7";
}

function externalTaskPlatform(value: unknown): ExternalPublishPlatform | null {
  if (value === "\u6296\u97f3" || value === "\u89c6\u9891\u53f7") return value;
  return null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRawTask(value: unknown): RawExternalTask | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RawExternalTask
    : null;
}

function taskIdOf(task: RawExternalTask) {
  return text(task.taskId) || text(task.draftId);
}

function videoUrlOf(task: RawExternalTask) {
  return text(task.videoUrl) || text(task.resultUrl);
}

function matchesBinding(task: RawExternalTask, platform: ExternalPublishPlatform, binding: PublishAccountBinding) {
  const returnedPlatform = externalTaskPlatform(task.platform);
  if (returnedPlatform && returnedPlatform !== platform) return false;
  const returnedAccountName = text(task.accountName);
  if (returnedAccountName && returnedAccountName !== binding.accountName) return false;
  const expectedAccountNo = text(binding.accountNo);
  const returnedAccountNo = text(task.accountNo) || text(task.accountId);
  return !expectedAccountNo || !returnedAccountNo || returnedAccountNo === expectedAccountNo;
}

async function releaseInvalidClaim(input: {
  clientConfig: Parameters<PublishDeviceSchedulerDependencies["patchStatus"]>[0];
  externalTaskId: string;
  platform: ExternalPublishPlatform;
  publishTaskId: string;
  actor: string;
  options: WecomPublishClientOptions;
  dependencies: Pick<PublishDeviceSchedulerDependencies, "patchStatus" | "saveMaterialInvalid" | "enqueueStatusOutbox">;
}) {
  try {
    await input.dependencies.patchStatus(input.clientConfig, input.externalTaskId, {
      platform: input.platform,
      status: "\u672a\u53d1\u5e03",
      error: MATERIAL_INVALID
    }, input.options);
    await input.dependencies.saveMaterialInvalid(input.publishTaskId, MATERIAL_INVALID, input.actor, {
      status: "REPORTED",
      reportStatus: "REPORTED"
    });
    return "MATERIAL_INVALID" as const;
  } catch (error) {
    await input.dependencies.saveMaterialInvalid(input.publishTaskId, MATERIAL_INVALID, input.actor, {
      status: "FAILED",
      reportStatus: "REPORT_FAILED",
      reportLastError: error instanceof Error ? error.message : "EXTERNAL_STATUS_PATCH_FAILED"
    });
    await input.dependencies.enqueueStatusOutbox(input.publishTaskId, input.actor);
    return "MATERIAL_INVALID_REPORT_PENDING" as const;
  }
}

export async function runPublishDeviceSchedulerTick(
  now = new Date(),
  options: PublishDeviceSchedulerOptions = {},
  dependencies: PublishDeviceSchedulerDependencies = defaultDependencies
) {
  const outcomes: Array<Record<string, unknown>> = [];
  const scheduleConfigIds = new Set<string>();

  for (const schedule of await dependencies.listSchedules()) {
    scheduleConfigIds.add(schedule.configId);
    if (!isPublishTimeWithinWindows(now, schedule.timeWindows)) {
      outcomes.push({ scheduleId: schedule.id, outcome: "OUTSIDE_TIME_WINDOW" });
      continue;
    }

    const device = await dependencies.findOnlineDevice(
      schedule.deviceCode,
      new Date(now.getTime() - ONLINE_WINDOW_MS)
    );
    if (!device) {
      outcomes.push({ scheduleId: schedule.id, outcome: "DEVICE_OFFLINE" });
      continue;
    }
    if (await dependencies.hasActivePublish(device.id)) {
      outcomes.push({ scheduleId: schedule.id, outcome: "DEVICE_BUSY" });
      continue;
    }

    const savedConfig = await dependencies.getConfig(schedule.configId);
    const parsedConfig = publishVideoConfigSchema.safeParse(savedConfig.configPayload);
    if (!parsedConfig.success || parsedConfig.data.sourceMode !== "external_pull" || savedConfig.status !== "ENABLED") {
      outcomes.push({ scheduleId: schedule.id, outcome: "CONFIG_INVALID" });
      continue;
    }

    for (const platform of PLATFORM_ORDER.filter((item) => schedule.platforms.includes(item))) {
      if (await dependencies.hasActivePublish(device.id)) break;

      const bindings = await dependencies.listBindings(schedule.deviceCode, platform);
      if (bindings.length !== 1) {
        outcomes.push({
          scheduleId: schedule.id,
          platform,
          outcome: bindings.length ? "BINDING_CONFLICT" : "BINDING_MISSING"
        });
        continue;
      }

      const binding = bindings[0];
      const activeQuarantine = await dependencies.findClaimQuarantine({
        deviceCode: schedule.deviceCode,
        platform,
        accountName: binding.accountName,
        now
      });
      if (activeQuarantine) {
        outcomes.push({
          scheduleId: schedule.id,
          platform,
          outcome: "CLAIM_QUARANTINED",
          blockedUntil: activeQuarantine.blockedUntil
        });
        continue;
      }

      const upstreamPlatform = externalPlatform(platform);
      const claimed = await dependencies.claimTask(parsedConfig.data, {
        platform: upstreamPlatform,
        accountName: binding.accountName
      }, options);
      if (!claimed) {
        outcomes.push({ scheduleId: schedule.id, platform, outcome: "NO_TASK" });
        continue;
      }

      const rawTask = asRawTask(claimed);
      const externalTaskId = rawTask ? taskIdOf(rawTask) : "";
      if (!rawTask || !externalTaskId) {
        outcomes.push({ scheduleId: schedule.id, platform, outcome: "CLAIM_RESPONSE_INVALID" });
        continue;
      }

      const title = text(rawTask.title);
      const description = text(rawTask.description);
      const material = dependencies.normalizeMaterial({
        videoUrl: videoUrlOf(rawTask),
        coverUrl: text(rawTask.coverUrl) || null
      });
      const valid = Boolean(title && description && matchesBinding(rawTask, upstreamPlatform, binding) && material.valid);
      const saved = await dependencies.saveClaimedTask({
        configId: savedConfig.id,
        platform,
        taskId: externalTaskId,
        accountName: binding.accountName,
        title: title || "External claimed task",
        description: description || "External task missing description",
        videoUrl: material.valid ? material.videoUrl : videoUrlOf(rawTask),
        coverUrl: material.valid ? material.coverUrl : text(rawTask.coverUrl) || null,
        matchedDeviceId: device.id,
        rawPayload: rawTask
      }, "publish-device-scheduler");

      if (!valid) {
        if (!saved.created && saved.task.failureCode === MATERIAL_INVALID) {
          outcomes.push({ scheduleId: schedule.id, platform, outcome: "MATERIAL_QUARANTINED", taskId: externalTaskId });
          continue;
        }
        const outcome = await releaseInvalidClaim({
          clientConfig: parsedConfig.data,
          externalTaskId,
          platform: upstreamPlatform,
          publishTaskId: saved.task.id,
          actor: "publish-device-scheduler",
          options,
          dependencies
        });
        const blockedUntil = new Date(now.getTime() + CLAIM_QUARANTINE_MS);
        await dependencies.saveClaimQuarantine({
          deviceCode: schedule.deviceCode,
          platform,
          accountName: binding.accountName,
          reason: MATERIAL_INVALID,
          blockedUntil,
          lastExternalTaskId: externalTaskId
        }, "publish-device-scheduler");
        outcomes.push({ scheduleId: schedule.id, platform, outcome, taskId: externalTaskId, blockedUntil });
        continue;
      }

      if (!saved.created) {
        outcomes.push({ scheduleId: schedule.id, platform, outcome: "TASK_ALREADY_TRACKED", taskId: externalTaskId });
        break;
      }

      await dependencies.createCommand(saved.task, parsedConfig.data, "publish-device-scheduler");
      await dependencies.markDispatched(saved.task.id, now, "publish-device-scheduler");
      outcomes.push({ scheduleId: schedule.id, platform, outcome: "DISPATCHED", taskId: externalTaskId });
      break;
    }
  }

  return { scheduleConfigIds: [...scheduleConfigIds], outcomes };
}
