import { config } from "../config";
import {
  createLiveRoomProfile,
  findLiveRoomProfile,
  updateLiveRoomProfile,
  type LiveRoomComment
} from "../repositories/live-room-capture.repository";

export const LIVE_ROOM_PROFILE_MODEL = "gpt-5.5";
const PROFILE_PROVIDER = config.aiProvider || "OpenAI";

export function buildLiveRoomProfilePrompt(input: {
  roomKey: string;
  accountName?: string | null;
  comments: LiveRoomComment[];
}) {
  const comments = input.comments.slice(0, 200).map((comment, index) => ({
    index,
    commentText: text(comment.commentText),
    pageIndex: comment.pageIndex ?? null
  }));
  return [
    "请根据直播间评论生成聚合用户画像，只输出 JSON，不要输出 Markdown 或解释文字。",
    "画像必须区分观察到的证据与推断，避免编造评论中没有的信息。",
    `直播间唯一键：${input.roomKey}`,
    `主播账号：${text(input.accountName) || "未识别"}`,
    "评论样本：",
    JSON.stringify(comments, null, 2),
    "JSON 字段必须为：summary(string), audienceFeatures(string[]), interestNeeds(string[]), interactionTraits(string[]), evidenceComments({text,reason,confidence}[]), confidence(string|number), confidenceExplanation(string)。"
  ].join("\n");
}

export function extractLiveRoomProfile(payload: unknown) {
  const outputText = responseText(payload);
  const cleaned = outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  return {
    summary: text(parsed.summary),
    audienceFeatures: stringArray(parsed.audienceFeatures),
    interestNeeds: stringArray(parsed.interestNeeds),
    interactionTraits: stringArray(parsed.interactionTraits),
    evidenceComments: Array.isArray(parsed.evidenceComments) ? parsed.evidenceComments
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .slice(0, 30)
      .map((item) => ({
        text: text(item.text),
        reason: text(item.reason),
        confidence: item.confidence === undefined ? undefined : String(item.confidence)
      })) : [],
    confidence: parsed.confidence === undefined ? null : String(parsed.confidence),
    confidenceExplanation: text(parsed.confidenceExplanation)
  };
}

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
    provider: PROFILE_PROVIDER,
    model: LIVE_ROOM_PROFILE_MODEL
  });
  void generateLiveRoomProfile(capture, pending.id);
  return pending;
}

async function generateLiveRoomProfile(capture: {
  id: string;
  roomKey: string;
  accountName?: string | null;
  rawComments?: LiveRoomComment[] | null;
}, profileId: string) {
  try {
    if (!config.aiApiKey) throw new Error("AI_API_KEY_NOT_CONFIGURED");
    await updateLiveRoomProfile(capture.id, { id: profileId, status: "RUNNING", model: LIVE_ROOM_PROFILE_MODEL, provider: PROFILE_PROVIDER });
    const response = await fetch(responsesUrl(config.aiBaseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LIVE_ROOM_PROFILE_MODEL,
        instructions: "你是用户研究分析助手。仅根据给定评论输出符合要求的 JSON。",
        input: buildLiveRoomProfilePrompt({
          roomKey: capture.roomKey,
          accountName: capture.accountName,
          comments: capture.rawComments ?? []
        })
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`AI_REQUEST_FAILED_${response.status}`);
    const profile = extractLiveRoomProfile(await response.json());
    await updateLiveRoomProfile(capture.id, {
      id: profileId,
      status: "SUCCEEDED",
      provider: PROFILE_PROVIDER,
      model: LIVE_ROOM_PROFILE_MODEL,
      summary: profile.summary,
      audienceFeatures: profile.audienceFeatures,
      interestNeeds: profile.interestNeeds,
      interactionTraits: profile.interactionTraits,
      evidenceComments: profile.evidenceComments,
      confidence: profile.confidence,
      confidenceExplanation: profile.confidenceExplanation,
      errorMessage: null,
      completedAt: new Date(),
      updatedBy: "ai"
    });
  } catch (error) {
    await updateLiveRoomProfile(capture.id, {
      id: profileId,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "AI_PROFILE_FAILED",
      updatedBy: "ai"
    });
  }
}

function responsesUrl(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/responses") ? base : `${base.endsWith("/v1") ? base : `${base}/v1`}/responses`;
}

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") {
    return (payload as { output_text: string }).output_text;
  }
  const output = payload && typeof payload === "object" && Array.isArray((payload as { output?: unknown }).output)
    ? (payload as { output: Array<Record<string, unknown>> }).output : [];
  const textParts = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((item) => item && typeof item === "object" ? item.text : "")
    .filter((item): item is string => typeof item === "string");
  if (!textParts.length) throw new Error("AI_RESPONSE_TEXT_EMPTY");
  return textParts.join("\n");
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 30) : [];
}
