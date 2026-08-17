import type { InterfacePublishPhoneResultPayload } from "@pkg/types";
import {
  findPublishTaskContext,
  savePublishTaskResult,
  updatePublishTaskDescription
} from "../repositories/publish-dispatch.repository";
import { publishVideoConfigSchema } from "./publish-config";
import { matchClaimedPublishTask } from "./publish-match.service";
import {
  createPublishStatusOutbox,
  markPublishTaskReportFailed,
  markPublishTaskReportNotRequired
} from "./publish-status-outbox.service";
import { dispatchMatchedPublishTask } from "./publish-scheduler.service";
import { PublishTopicsValidationError, validatePublishTopics } from "./publish-topics";
import { publishInterfaceResultService } from "./publish-interface-result.service";
import type { WecomPublishClientOptions } from "./wecom-publish-client";

export type ResultInput = Omit<InterfacePublishPhoneResultPayload, "deviceToken">;

type ResultOptions = WecomPublishClientOptions & {
  enqueueExternalStatus?: (publishTaskId: string, actor: string) => Promise<unknown>;
  markReportNotRequired?: (publishTaskId: string, actor: string) => Promise<unknown>;
  markExternalReportFailure?: (publishTaskId: string, error: unknown, actor: string) => Promise<unknown>;
  reportInterfaceResult?: typeof publishInterfaceResultService.report;
};

function reportModeFor(task: object) {
  const reportMode = (task as { reportMode?: unknown }).reportMode;
  return reportMode === "NONE" ? "NONE" : "EXTERNAL";
}

export function shouldQueueExternalPublishStatus(reportMode: unknown, status: ResultInput["status"]) {
  return reportMode === "EXTERNAL" && (status === "SUCCEEDED" || status === "FAILED");
}

export async function reportPublishTaskResult(
  id: string,
  input: ResultInput,
  actor: string,
  options: ResultOptions = {}
) {
  const context = await findPublishTaskContext(id);
  if (!context) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (context.deviceCode !== input.deviceId) throw new Error("PUBLISH_TASK_DEVICE_MISMATCH");
  if (context.task.interfaceRunId) {
    return (options.reportInterfaceResult ?? publishInterfaceResultService.report)(
      context.task.id,
      input,
      actor
    );
  }
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

  const reportMode = reportModeFor(context.task);
  if (!shouldQueueExternalPublishStatus(reportMode, input.status)) {
    if (reportMode === "NONE") {
      await (options.markReportNotRequired ?? markPublishTaskReportNotRequired)(id, actor);
    }
    return finished;
  }

  try {
    await (options.enqueueExternalStatus ?? createPublishStatusOutbox)(id, actor);
  } catch (error) {
    await (options.markExternalReportFailure ?? markPublishTaskReportFailed)(id, error, actor);
  }
  return finished;
}

export async function completePublishTaskTopics(id: string, description: string, actor: string) {
  const current = await findPublishTaskContext(id);
  if (!current) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (current.task.status !== "TOPIC_PENDING") throw new Error("PUBLISH_TASK_TOPIC_STATE_INVALID");
  const commandConfig = publishVideoConfigSchema.parse(current.configPayload);
  if (commandConfig.sourceMode !== "external_pull") {
    throw new Error("PUBLISH_TASK_SOURCE_CONFIG_INVALID");
  }
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
