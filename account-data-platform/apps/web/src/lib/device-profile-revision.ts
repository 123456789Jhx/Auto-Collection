import type { CommentActionTiming } from "@pkg/types";
import type { DeviceProfileOverride } from "./device-profile-form";

// A child editor may have loaded a newer profile than its parent. Its new revision
// must never authorize the parent's older copy of unrelated fields.
export function acceptSavedTiming(
  draft: DeviceProfileOverride,
  parentRevision: string | null,
  timing: CommentActionTiming | null,
  savedRevision: string | null,
  childPreviousRevision: string | null
) {
  const next = { ...draft };
  if (timing) next.commentActionTiming = timing;
  else delete next.commentActionTiming;
  const conflict = parentRevision !== childPreviousRevision;
  return { draft: next, conflict, revision: conflict ? parentRevision : savedRevision };
}
