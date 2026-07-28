import type { PublishTaskResultPayload } from "@pkg/types";
import {
  findPublishTaskContext,
  savePublishTaskResult,
  updatePublishTaskDescription
} from "../repositories/publish-dispatch.repository";
import { publishClientOnlyConfigSchema, publishVideoConfigSchema } from "./publish-config";
import { matchClaimedPublishTask } from "./publish-match.service";
import { dispatchMatchedPublishTask } from "./publish-scheduler.service";
import { PublishTopicsValidationError, validatePublishTopics } from "./publish-topics";
import { patchTaskStatus, type WecomPublishClientOptions } from "./wecom-publish-client";

type ResultInput = Omit<PublishTaskResultPayload, "deviceToken">;

function externalPlatform(platform: string) {
  return platform === "WECHAT_CHANNELS" ? "视频号" as const : "抖音" as const;
}

export async function reportPublishTaskResult(
  id: string,
  input: ResultInput,
  actor: string,
  options: WecomPublishClientOptions = {}
) {
  const context = await findPublishTaskContext(id);
  if (!context) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (context.deviceCode !== input.deviceId) throw new Error("PUBLISH_TASK_DEVICE_MISMATCH");
  if (context.task.status === "REPORTED") return context.task;

  const finishedAt = new Date();
  const resultError = input.status === "FAILED"
    ? input.error ?? "发布失败"
    : input.status === "SUCCEEDED" ? null : input.error ?? null;
  const finished = await savePublishTaskResult(id, {
    status: input.status,
    resultError,
    publishedUrl: input.publishedUrl ?? null,
    platformContentId: input.platformContentId ?? null,
    finishedAt,
    reportedAt: null
  }, actor);

  if (input.status !== "SUCCEEDED" && input.status !== "FAILED") return finished;
  const clientConfig = publishClientOnlyConfigSchema.parse(context.configPayload);
  await patchTaskStatus(clientConfig, context.task.taskId, {
    platform: externalPlatform(context.task.platform),
    status: input.status === "SUCCEEDED" ? "已发布" : "未发布",
    ...(resultError ? { error: resultError } : {}),
    ...(input.publishedUrl ? { publishedUrl: input.publishedUrl } : {}),
    ...(input.platformContentId ? { platformContentId: input.platformContentId } : {})
  }, options);
  return savePublishTaskResult(id, { status: "REPORTED", reportedAt: new Date() }, actor);
}

export async function completePublishTaskTopics(id: string, description: string, actor: string) {
  const current = await findPublishTaskContext(id);
  if (!current) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (current.task.status !== "TOPIC_PENDING") throw new Error("PUBLISH_TASK_TOPIC_STATE_INVALID");
  const commandConfig = publishVideoConfigSchema.parse(current.configPayload);
  const validation = validatePublishTopics(description, commandConfig.expectedTopicCount);
  if (!validation.valid) throw new PublishTopicsValidationError(validation.reason);
  const updated = await updatePublishTaskDescription(
    id,
    description,
    current.task.matchedDeviceId ? "MATCHED" : "CLAIMED",
    actor
  );
  if (!updated) throw new Error("PUBLISH_TASK_TOPIC_STATE_INVALID");
  const matched = updated.matchedDeviceId ? updated : await matchClaimedPublishTask(updated, actor);
  const result = await dispatchMatchedPublishTask(
    matched,
    commandConfig,
    updated.scheduledSlot ?? new Date(),
    actor,
    {},
    true
  );
  return result.task;
}

export async function getPublishTaskTopicResolution(id: string, deviceCode: string) {
  const current = await findPublishTaskContext(id);
  if (!current) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (current.deviceCode !== deviceCode) throw new Error("PUBLISH_TASK_DEVICE_MISMATCH");
  return {
    taskId: current.task.id,
    status: current.task.status,
    description: current.task.description,
    resolved: current.task.status !== "TOPIC_PENDING"
  };
}
