export type MediaCoverSource = "provided" | "derived" | "missing";

export type MediaUrlPair = {
  videoUrl: string | null;
  coverUrl: string | null;
  videoId: string | null;
  coverSource: MediaCoverSource;
  errors: string[];
};

type ParsedHttpUrl = {
  raw: string;
  parsed: URL;
};

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const ANY_PROTOCOL_URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
const TRAILING_TEXT_PUNCTUATION = /[.,;:!?，。；：！？]+$/;

function trimUrlCandidate(candidate: string) {
  return candidate.replace(TRAILING_TEXT_PUNCTUATION, "");
}

function extractHttpUrls(text: string) {
  const matches = Array.from(text.matchAll(HTTP_URL_PATTERN), (match) => trimUrlCandidate(match[0]));
  const uniqueUrls = [...new Set(matches.filter(Boolean))];
  const urls: ParsedHttpUrl[] = [];

  for (const raw of uniqueUrls) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push({ raw, parsed });
      }
    } catch {
      // Ignore malformed URL-like text; it is not a usable media URL.
    }
  }

  return urls;
}

function hasNonHttpProtocolUrl(text: string) {
  return Array.from(text.matchAll(ANY_PROTOCOL_URL_PATTERN), (match) => match[0])
    .some((candidate) => !/^https?:\/\//i.test(candidate));
}

function hasExtension(parsed: URL, extension: RegExp) {
  return extension.test(parsed.pathname);
}

export function parseMediaUrlPair(text: string): MediaUrlPair {
  const urls = extractHttpUrls(text);
  const videos = urls.filter(({ parsed }) => hasExtension(parsed, /\.mp4$/i));
  const covers = urls.filter(({ parsed }) => hasExtension(parsed, /\.jpe?g$/i));
  const realVideos = videos
    .filter(({ parsed }) => !isPublishPreviewUrl(parsed))
    .map(({ raw }) => resolvePublishMaterialUrls({ videoUrl: raw }))
    .filter((result) => result.valid)
    .map((result) => result.material);
  const convertedPreviewVideos = realVideos.length
    ? []
    : videos
      .filter(({ parsed }) => isPublishPreviewUrl(parsed))
      .map(({ raw }) => resolvePublishMaterialUrls({ videoUrl: raw }))
      .filter((result) => result.valid)
      .map((result) => result.material);
  const dispatchableVideos = [...realVideos, ...convertedPreviewVideos];
  const dispatchableCovers = covers.filter(({ parsed }) => !isPublishPreviewUrl(parsed));
  const previewVideoDetected = videos.some(({ parsed }) => isPublishPreviewUrl(parsed));
  const unconvertedPreviewVideoDetected = previewVideoDetected && !realVideos.length && !convertedPreviewVideos.length;
  const errors: string[] = [];

  if (!urls.length) {
    errors.push(hasNonHttpProtocolUrl(text) ? "素材 URL 必须使用 http 或 https 协议" : "缺少素材 URL");
  }
  if (!dispatchableVideos.length && unconvertedPreviewVideoDetected) {
    errors.push("检测到无法自动转换的预览下载地址，请粘贴原始 COS/OSS 素材地址");
  } else if (!dispatchableVideos.length && urls.length) {
    errors.push("缺少视频 URL");
  }
  if (dispatchableVideos.length > 1) errors.push("发现多个视频 URL，请拆成多条任务或只保留一个");
  if (dispatchableCovers.length > 1) errors.push("发现多个封面 URL，请只保留一个");

  const video = dispatchableVideos[0] ?? null;
  const providedCoverUrl = dispatchableCovers[0]?.raw ?? null;
  const resolved = video
    ? resolvePublishMaterialUrls({
      videoUrl: video.sourceVideoUrl,
      coverUrl: providedCoverUrl
    })
    : null;
  const material = resolved?.valid ? resolved.material : video;
  const videoUrl = material?.videoUrl ?? null;
  const coverUrl = material?.coverUrl ?? providedCoverUrl;
  const coverSource: MediaCoverSource = providedCoverUrl
    ? "provided"
    : coverUrl
      ? "derived"
      : "missing";

  return {
    videoUrl,
    coverUrl,
    videoId: material?.draftId ?? null,
    coverSource,
    errors
  };
}
import { isPublishPreviewUrl, resolvePublishMaterialUrls } from "@pkg/types";
