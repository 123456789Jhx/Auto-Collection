import { commentActionTimingSchema, type CopyCommentActionTimingPayload, type UpdateCommentActionTimingPayload } from "@pkg/types";
import {
  copyCommentActionTimingAtomic,
  readCommentActionTimingConfig,
  saveDeviceProfileBaseAtomic,
  saveCommentActionTimingAtomic
} from "../repositories/comment-action-timing.repository";

export {
  CommentActionTimingConflictError,
  CommentActionTimingNotFoundError,
  CommentActionTimingSourceDisabledError,
  CommentActionTimingSourceEmptyError,
  CommentActionTimingTaskNotFoundError
} from "../repositories/comment-action-timing.repository";

type StoredConfig = {
  deviceProfile: Record<string, unknown> | null;
  updatedAt: Date | string;
};

function updatedAtValue(config: StoredConfig | null) {
  if (!config) return null;
  const date = config.updatedAt instanceof Date ? config.updatedAt : new Date(config.updatedAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function profileValue(config: StoredConfig | null) {
  const profile = config?.deviceProfile;
  return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
}

function responseValue(deviceCode: string, platform: string, config: StoredConfig | null) {
  const profile = profileValue(config);
  const timing = commentActionTimingSchema.safeParse(profile.commentActionTiming);
  const openDouyinWaitMs = Array.isArray(profile.openDouyinWaitMs) && profile.openDouyinWaitMs.length === 2
    ? profile.openDouyinWaitMs as [number, number]
    : undefined;
  return {
    deviceCode,
    platform,
    updatedAt: updatedAtValue(config),
    timing: timing.success ? timing.data : null,
    ...(openDouyinWaitMs ? { openDouyinWaitMs } : {})
  };
}

export async function getCommentActionTiming(deviceCode: string, platform = "douyin") {
  const result = await readCommentActionTimingConfig(deviceCode, platform);
  return responseValue(deviceCode, platform, result.config);
}

export async function getDeviceProfileSnapshot(deviceCode: string, platform = "douyin") {
  const result = await readCommentActionTimingConfig(deviceCode, platform);
  return {
    deviceProfile: result.config?.deviceProfile ?? null,
    updatedAt: updatedAtValue(result.config)
  };
}

export async function updateCommentActionTiming(
  deviceCode: string,
  platform: string,
  payload: UpdateCommentActionTimingPayload,
  actor: string
) {
  const result = await saveCommentActionTimingAtomic({ deviceCode, platform, actor, ...payload });
  return responseValue(deviceCode, platform, result.config);
}

export async function copyCommentActionTiming(payload: CopyCommentActionTimingPayload, actor: string) {
  return copyCommentActionTimingAtomic({ ...payload, actor });
}

export async function updateDeviceProfileWithCas(input: {
  deviceCode: string;
  platform: string;
  expectedUpdatedAt: string | null;
  deviceProfile: Record<string, unknown> | null;
  actor: string;
}) {
  const result = await saveDeviceProfileBaseAtomic(input);
  return {
    deviceProfile: result.config.deviceProfile ?? null,
    updatedAt: updatedAtValue(result.config)
  };
}
