import {
  findLiveCommentCandidatesByIds,
  listLiveCommentCandidates,
  markLiveCommentCandidatesImported,
  upsertLiveCommentCandidate
} from "../repositories/live-comment-candidate.repository";
import { normalizeVocabularyValue } from "./account-warmup-vocabulary.service";
import { upsertAccountWarmupVocabulary } from "../repositories/account-warmup-vocabulary.repository";
import { cleanLiveCommentCandidates } from "./live-comment-candidate-cleaning";

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function captureLiveCommentCandidates(command: {
  id: string;
  taskId?: string | null;
  deviceId: string;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
}) {
  if (command.payloadJson?.featureKey !== "isolated_live_comment_entry") return [];
  const batchId = textValue(command.payloadJson.batchId ?? command.payloadJson.batch_id);
  const comments = command.resultJson?.comments;
  if (!batchId || !Array.isArray(comments)) return [];
  const rows = [];
  for (const commentValue of comments) {
    const comment = objectValue(commentValue);
    const commentText = textValue(comment.commentText);
    const sources = Array.isArray(comment.sources) && comment.sources.length ? comment.sources : [comment];
    for (const sourceValue of sources) {
      const source = objectValue(sourceValue);
      const sourceText = commentText || textValue(source.commentText);
      if (!sourceText || sourceText.length > 100) continue;
      const sourceRecord: Record<string, unknown> = {
        deviceId: command.deviceId,
        roomKey: textValue(source.roomKey ?? comment.roomKey),
        pageIndex: source.pageIndex ?? comment.pageIndex ?? null,
        commandId: command.id
      };
      const accountName = textValue(source.accountName ?? comment.accountName);
      const accountId = textValue(source.accountId ?? comment.accountId);
      if (accountName) sourceRecord.accountName = accountName;
      if (accountId) sourceRecord.accountId = accountId;
      rows.push(await upsertLiveCommentCandidate({
        batchId,
        taskId: command.taskId,
        commandId: command.id,
        deviceId: command.deviceId,
        commentText: sourceText,
        normalizedValue: normalizeVocabularyValue(sourceText),
        source: sourceRecord
      }));
    }
  }
  return rows;
}

export async function getPendingLiveCommentCandidates(batchId: string) {
  return listLiveCommentCandidates(batchId);
}

export async function confirmLiveCommentCandidates(batchId: string, ids: string[], options: { clean?: boolean } = {}) {
  const candidates = await findLiveCommentCandidatesByIds(ids, batchId);
  const pending = candidates.filter((candidate) => candidate.status !== "IMPORTED");
  const clean = options.clean !== false;
  if (!clean) {
    return {
      selectedCount: ids.length,
      importedCount: 0,
      filteredCount: 0,
      duplicateCount: 0,
      candidates: []
    };
  }
  const cleaning = cleanLiveCommentCandidates(pending);
  const acceptedIds = new Set(cleaning.accepted);
  const accepted = pending.filter((candidate) => acceptedIds.has(candidate.id));
  const entries = await upsertAccountWarmupVocabulary(accepted.map((candidate) => ({
    kind: "COMMENT" as const,
    value: candidate.commentText,
    normalizedValue: candidate.normalizedValue
  })));
  const byKey = new Map(entries.map((entry) => [normalizeVocabularyValue(entry.value), entry.id]));
  const marked = await markLiveCommentCandidatesImported(
    accepted.map((candidate) => candidate.id),
    new Map(accepted.map((candidate) => [candidate.id, byKey.get(normalizeVocabularyValue(candidate.normalizedValue || candidate.commentText))]).filter((item): item is [string, string] => Boolean(item[1])))
  );
  return {
    selectedCount: ids.length,
    importedCount: marked.length,
    filteredCount: cleaning.rejected.length,
    duplicateCount: cleaning.duplicates.length,
    candidates: marked
  };
}
