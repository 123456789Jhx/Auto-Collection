import { mutate, patch, request } from "./api-client";
import type { CommentActionTiming, CommentActionTimingActionKey } from "@pkg/types";
import type { DeviceProfileOverride } from "./device-profile-form";

export type ActionKey = CommentActionTimingActionKey;
export type TimingPair = { beforeMs: [number, number]; afterMs: [number, number] };
export type { CommentActionTiming };
export type TimingResponse = { deviceCode: string; updatedAt: string | null; timing: CommentActionTiming | null; openDouyinWaitMs?: [number, number] };

export function getCommentActionTiming(deviceCode: string, platform = "douyin") {
  return request<TimingResponse>(`/admin/devices/${encodeURIComponent(deviceCode)}/comment-action-timing`, { platform });
}
export function updateCommentActionTiming(deviceCode: string, expectedUpdatedAt: string | null, timing: CommentActionTiming | null, platform = "douyin") {
  return patch<TimingResponse>(`/admin/devices/${encodeURIComponent(deviceCode)}/comment-action-timing?platform=${encodeURIComponent(platform)}`, { expectedUpdatedAt, timing });
}
export function copyCommentActionTiming(payload: { sourceDeviceCode: string; platform: string; expectedUpdatedAt: string | null; targets: Array<{ deviceCode: string; expectedUpdatedAt: string | null }> }) {
  return mutate<{ results: Array<{ deviceCode: string; ok: boolean; error?: string }> }>("/admin/device-profile-overrides/copy", payload);
}

export function updateDeviceProfile(deviceCode: string, deviceProfile: DeviceProfileOverride | null, expectedUpdatedAt: string | null, platform: string) {
  return patch<Record<string, unknown>>(`/admin/devices/${encodeURIComponent(deviceCode)}/task-config?platform=${encodeURIComponent(platform)}`, { deviceProfile, expectedUpdatedAt });
}
