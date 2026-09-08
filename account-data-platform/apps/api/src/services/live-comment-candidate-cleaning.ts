import { normalizeVocabularyValue } from "./account-warmup-vocabulary.service";

const allowedCommentPattern = /^[\u4e00-\u9fff0-9０-９?？.。,，、]+$/u;

export type CandidateForCleaning = {
  id: string;
  commentText: string;
  normalizedValue: string;
};

export function isCleanLiveComment(commentText: string) {
  return allowedCommentPattern.test(commentText);
}

export function cleanLiveCommentCandidates(candidates: CandidateForCleaning[]) {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!isCleanLiveComment(candidate.commentText)) {
      rejected.push(candidate.id);
      continue;
    }
    const key = normalizeVocabularyValue(candidate.normalizedValue || candidate.commentText);
    if (seen.has(key)) {
      duplicates.push(candidate.id);
      continue;
    }
    seen.add(key);
    accepted.push(candidate.id);
  }

  return { accepted, rejected, duplicates };
}
