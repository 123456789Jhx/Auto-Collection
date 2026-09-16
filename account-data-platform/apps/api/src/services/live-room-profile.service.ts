import { config } from "../config";
import {
  createLiveRoomProfile,
  findLiveRoomProfile,
  updateLiveRoomProfile,
  type LiveRoomComment
} from "../repositories/live-room-capture.repository";

import { LIVE_ROOM_PROFILE_MODEL, profileErrorMessage, requestLiveRoomProfile } from "./live-room-profile-model";

export { buildLiveRoomProfilePrompt, extractLiveRoomProfile, LIVE_ROOM_PROFILE_MODEL } from "./live-room-profile-model";

export async function startLiveRoomProfileGeneration(capture: {
  id: string;
  roomKey: string;
  accountName?: string | null;
  rawComments?: LiveRoomComment[] | null;
}) {
  const existing = await findLiveRoomProfile(capture.id);
  if (existing?.status === "SUCCEEDED" || existing?.status === "PENDING" || existing?.status === "RUNNING") return existing;
  const pending = await createLiveRoomProfile({
    captureId: capture.id,
    status: "PENDING",
    provider: config.aiProvider || "OpenAI",
    model: LIVE_ROOM_PROFILE_MODEL
  });
  // Only the caller holding the database claim may request a model response.
  if (!pending) return findLiveRoomProfile(capture.id);
  void generateLiveRoomProfile(capture, pending.updatedAt).catch(() => {
    console.error("用户画像结果保存失败", { captureId: capture.id });
  });
  return pending;
}

async function generateLiveRoomProfile(capture: {
  id: string;
  roomKey: string;
  accountName?: string | null;
  rawComments?: LiveRoomComment[] | null;
}, claimedAt: Date) {
  let expectedUpdatedAt = claimedAt;
  try {
    const running = await updateLiveRoomProfile(capture.id, {
      status: "RUNNING", model: LIVE_ROOM_PROFILE_MODEL, provider: config.aiProvider || "OpenAI"
    }, expectedUpdatedAt);
    if (!running) return;
    expectedUpdatedAt = running.updatedAt;
    const profile = await requestLiveRoomProfile({
      roomKey: capture.roomKey,
      accountName: capture.accountName,
      comments: capture.rawComments ?? []
    }, { apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl });
    await updateLiveRoomProfile(capture.id, {
      status: "SUCCEEDED",
      ...profile,
      errorMessage: null,
      completedAt: new Date(),
      updatedBy: "ai"
    }, expectedUpdatedAt);
  } catch (error) {
    await updateLiveRoomProfile(capture.id, {
      status: "FAILED",
      errorMessage: profileErrorMessage(error),
      updatedBy: "ai"
    }, expectedUpdatedAt);
  }
}
