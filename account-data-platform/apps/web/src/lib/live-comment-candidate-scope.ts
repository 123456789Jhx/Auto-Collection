import type { PendingLiveCommentCandidate } from "./api-client-live-comment-entry";

export type LiveCommentCandidateScope = {
  batchId: string;
  deviceId: string;
  roomKey: string;
};

export function scopeLiveCommentCandidates(
  candidates: PendingLiveCommentCandidate[],
  scope: LiveCommentCandidateScope
): PendingLiveCommentCandidate[] {
  if (!scope.batchId || !scope.deviceId || !scope.roomKey) return [];

  return candidates.flatMap((candidate) => {
    if (candidate.batchId !== scope.batchId) return [];

    const sourcesJson = candidate.sourcesJson.filter((source) =>
      source.deviceId === scope.deviceId && source.roomKey === scope.roomKey
    );
    return sourcesJson.length > 0 ? [{ ...candidate, sourcesJson }] : [];
  });
}
