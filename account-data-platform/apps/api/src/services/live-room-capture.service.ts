import { upsertLiveRoomCapture, type LiveRoomComment } from "../repositories/live-room-capture.repository";

export async function captureLiveRoomSnapshots(command: {
  id: string;
  deviceId: string;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
}) {
  if (command.payloadJson?.featureKey !== "isolated_live_comment_entry") return [];
  const batchId = text(command.payloadJson.batchId ?? command.payloadJson.batch_id);
  const comments = Array.isArray(command.resultJson?.comments) ? command.resultJson.comments
    .filter((item): item is LiveRoomComment => Boolean(item && typeof item === "object")) : [];
  if (!batchId || !comments.length) return [];

  const grouped = new Map<string, LiveRoomComment[]>();
  for (const comment of comments) {
    const roomKey = text(comment.roomKey) || `live-comment:${batchId}`;
    const group = grouped.get(roomKey) ?? [];
    const { userName: _userName, sources, ...body } = comment;
    body.sources = Array.isArray(sources) ? sources.map((source) => {
      if (!source || typeof source !== "object") return {};
      const { userName: _sourceUserName, ...safeSource } = source as Record<string, unknown>;
      return safeSource;
    }) : [];
    group.push(body);
    grouped.set(roomKey, group);
  }
  const result = command.resultJson ?? {};
  return Promise.all([...grouped.entries()].map(([roomKey, roomComments]) => upsertLiveRoomCapture({
    batchId,
    deviceId: command.deviceId,
    commandId: command.id,
    roomKey,
    comments: roomComments,
    result
  })));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
