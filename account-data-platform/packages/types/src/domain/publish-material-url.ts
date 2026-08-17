import type { PublishMaterialFailureCode } from "./publish-task";

const PREVIEW_DOWNLOAD_VIDEO_PATTERN = /\/public\/downloads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp4$/i;
const REAL_VIDEO_BASE_URL = "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos";
const REAL_COVER_BASE_URL = "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers";

export type ResolvedPublishMaterial = {
  sourceVideoUrl: string;
  sourceCoverUrl: string | null;
  videoUrl: string;
  coverUrl: string;
  draftId: string | null;
};

export type PublishMaterialUrlResolution =
  | { valid: true; material: ResolvedPublishMaterial }
  | { valid: false; code: PublishMaterialFailureCode };

type PublishMaterialUrlInput = {
  videoUrl?: string | null;
  coverUrl?: string | null;
};

function httpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function draftIdFrom(parsed: URL) {
  const fileName = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  return fileName.replace(/\.mp4$/i, "") || null;
}

function deriveCoverUrl(video: URL) {
  const cover = new URL(video);
  cover.pathname = cover.pathname.replace(/\.mp4$/i, ".jpg");
  cover.search = "";
  cover.hash = "";
  return cover.toString();
}

export function isPublishPreviewUrl(value: string | URL) {
  const parsed = typeof value === "string" ? httpUrl(value) : value;
  if (!parsed) return false;
  const pathname = parsed.pathname.toLowerCase();
  return pathname.includes("/public/downloads/") || pathname.includes("/downloads/agent/");
}

export function resolvePublishMaterialUrls(
  input: PublishMaterialUrlInput
): PublishMaterialUrlResolution {
  const sourceVideoUrl = input.videoUrl?.trim() ?? "";
  if (!sourceVideoUrl) return { valid: false, code: "VIDEO_REQUIRED" };
  const sourceVideo = httpUrl(sourceVideoUrl);
  if (!sourceVideo || !/\.mp4$/i.test(sourceVideo.pathname)) {
    return { valid: false, code: "VIDEO_URL_INVALID" };
  }

  const sourceCoverUrl = input.coverUrl?.trim() || null;
  const sourceCover = sourceCoverUrl ? httpUrl(sourceCoverUrl) : null;
  if (sourceCoverUrl && !sourceCover) return { valid: false, code: "COVER_URL_INVALID" };

  if (isPublishPreviewUrl(sourceVideo)) {
    const match = sourceVideo.pathname.match(PREVIEW_DOWNLOAD_VIDEO_PATTERN);
    if (!match) return { valid: false, code: "VIDEO_URL_INVALID" };
    const draftId = match[1];
    return {
      valid: true,
      material: {
        sourceVideoUrl,
        sourceCoverUrl,
        videoUrl: `${REAL_VIDEO_BASE_URL}/${draftId}.mp4`,
        coverUrl: sourceCoverUrl ?? `${REAL_COVER_BASE_URL}/${draftId}.jpg`,
        draftId
      }
    };
  }

  return {
    valid: true,
    material: {
      sourceVideoUrl,
      sourceCoverUrl,
      videoUrl: sourceVideoUrl,
      coverUrl: sourceCoverUrl ?? deriveCoverUrl(sourceVideo),
      draftId: draftIdFrom(sourceVideo)
    }
  };
}
