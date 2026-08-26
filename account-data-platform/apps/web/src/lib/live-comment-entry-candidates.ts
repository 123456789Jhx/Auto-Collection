export const LIVE_COMMENT_VOCABULARY_BATCH_SIZE = 100;
export const LIVE_COMMENT_VOCABULARY_MAX_LENGTH = 100;

export type LiveCommentCandidateSource = {
  sourceId: string;
  commandId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  roomKey: string;
  pageIndex: number | null;
  userName: string;
};

export type LiveCommentCandidate = {
  id: string;
  commentText: string;
  uploadable: boolean;
  sources: LiveCommentCandidateSource[];
};

export type LiveCommentCandidateCommand = {
  id?: string;
  deviceId?: string;
  deviceCode?: string;
  deviceName?: string;
  resultJson?: Record<string, unknown> | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pageIndexValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeCapturedComment(value: unknown) {
  return stringValue(value);
}

export function liveCommentVocabularyKey(value: unknown) {
  return normalizeCapturedComment(value).normalize("NFKC").toLowerCase();
}

function candidateSource(
  command: LiveCommentCandidateCommand,
  comment: Record<string, unknown>,
  sourceValue: unknown,
  index: number
): LiveCommentCandidateSource {
  const source = objectValue(sourceValue);
  const commandId = stringValue(command.id);
  // The command row owns the database UUID. Mobile capture scope can contain
  // the human-readable device code, so it must not override that identity.
  const deviceId = stringValue(command.deviceId) || stringValue(source.deviceId) || stringValue(comment.deviceId);
  const deviceCode = stringValue(command.deviceCode) || stringValue(source.deviceCode) ||
    stringValue(comment.deviceCode) || deviceId;
  const deviceName = stringValue(source.deviceName) || stringValue(comment.deviceName) ||
    stringValue(command.deviceName) || deviceCode;
  const roomKey = stringValue(source.roomKey) || stringValue(comment.roomKey);
  const pageIndex = pageIndexValue(source.pageIndex ?? comment.pageIndex);
  const userName = stringValue(source.userName) || stringValue(comment.userName);
  const suppliedId = stringValue(source.commentId) || stringValue(comment.commentId);
  const sourceId = suppliedId || [commandId, deviceId, roomKey, pageIndex ?? "", userName, index].join("|");
  return { sourceId, commandId, deviceId, deviceCode, deviceName, roomKey, pageIndex, userName };
}

export function collectLiveCommentCandidates(commands: LiveCommentCandidateCommand[]) {
  const candidateByKey = new Map<string, LiveCommentCandidate>();
  const sourceIdsByKey = new Map<string, Set<string>>();

  function addCandidate(commentText: string, source: LiveCommentCandidateSource) {
    const key = liveCommentVocabularyKey(commentText);
    if (!key) return;
    let candidate = candidateByKey.get(key);
    if (!candidate) {
      candidate = {
        id: key,
        commentText,
        uploadable: commentText.length <= LIVE_COMMENT_VOCABULARY_MAX_LENGTH,
        sources: []
      };
      candidateByKey.set(key, candidate);
      sourceIdsByKey.set(key, new Set());
    }
    const identity = [source.sourceId, source.commandId, source.deviceId, source.pageIndex ?? "", source.userName].join("|");
    const knownSources = sourceIdsByKey.get(key)!;
    if (!knownSources.has(identity)) {
      knownSources.add(identity);
      candidate.sources.push(source);
    }
  }

  commands.forEach((command) => {
    const comments = command.resultJson?.comments;
    if (!Array.isArray(comments)) return;
    comments.forEach((commentValue, commentIndex) => {
      const comment = objectValue(commentValue);
      const commentText = normalizeCapturedComment(comment.commentText);
      const sources = Array.isArray(comment.sources) && comment.sources.length ? comment.sources : [comment];
      sources.forEach((sourceValue, sourceIndex) => {
        const source = objectValue(sourceValue);
        const sourceText = commentText || normalizeCapturedComment(source.commentText);
        addCandidate(sourceText, candidateSource(command, comment, source, commentIndex * 1000 + sourceIndex));
      });
    });
  });

  return [...candidateByKey.values()];
}

export function buildLiveCommentVocabularyBatches(values: string[]) {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const normalized = normalizeCapturedComment(value);
    const key = liveCommentVocabularyKey(normalized);
    if (key && !unique.has(key)) unique.set(key, normalized);
  });
  const comments = [...unique.values()];
  const oversized = comments.filter((value) => value.length > LIVE_COMMENT_VOCABULARY_MAX_LENGTH);
  if (oversized.length) {
    throw new Error(`有 ${oversized.length} 条评论超过 ${LIVE_COMMENT_VOCABULARY_MAX_LENGTH} 字，无法写入评论词库`);
  }
  const batches: string[][] = [];
  for (let index = 0; index < comments.length; index += LIVE_COMMENT_VOCABULARY_BATCH_SIZE) {
    batches.push(comments.slice(index, index + LIVE_COMMENT_VOCABULARY_BATCH_SIZE));
  }
  return batches;
}

export async function saveLiveCommentVocabularyBatches(
  batches: string[][],
  saveBatch: (comments: string[]) => Promise<unknown>
) {
  const outcomes = await Promise.allSettled(batches.map(async (comments) => {
    const response = await saveBatch(comments);
    return { comments, response };
  }));
  const failures: Array<{ comments: string[]; message: string }> = [];
  let savedCount = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      const { comments, response } = outcome.value;
      if (Array.isArray(response)) {
        const entryIds = new Set(response.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const id = stringValue((value as Record<string, unknown>).id);
          return id ? [id] : [];
        }));
        savedCount += entryIds.size || response.length;
      } else {
        savedCount += comments.length;
      }
    }
    else failures.push({
      comments: batches[index],
      message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason || "入库失败")
    });
  });
  return { savedCount, failures };
}
