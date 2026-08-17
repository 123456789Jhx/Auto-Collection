import {
  resolvePublishMaterialUrls,
  type PublishMaterialFailureCode
} from "@pkg/types";

type PublishMaterialInput = {
  videoUrl?: string | null;
  coverUrl?: string | null;
};

export type PublishMaterialValidation =
  | { valid: true; videoUrl: string; coverUrl: string }
  | { valid: false; code: PublishMaterialFailureCode };

function normalizeUrl(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type PublishMaterialValidationOptions = {
  allowedHosts?: readonly string[];
};

function hostAllowed(value: string, allowedHosts: readonly string[]) {
  const hostname = new URL(value).hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const normalized = allowedHost.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return hostname.endsWith(suffix) && hostname !== normalized.slice(2);
    }
    return hostname === normalized;
  });
}

export function normalizeExternalPublishMaterial(
  input: PublishMaterialInput,
  options: PublishMaterialValidationOptions = {}
): PublishMaterialValidation {
  const resolution = resolvePublishMaterialUrls(input);
  if (!resolution.valid) return resolution;
  const allowedHosts = options.allowedHosts?.filter((host) => host.trim()) ?? [];
  if (allowedHosts.length) {
    if (!hostAllowed(resolution.material.sourceVideoUrl, allowedHosts)
      || !hostAllowed(resolution.material.videoUrl, allowedHosts)) {
      return { valid: false, code: "VIDEO_URL_INVALID" };
    }
    if ((resolution.material.sourceCoverUrl
      && !hostAllowed(resolution.material.sourceCoverUrl, allowedHosts))
      || !hostAllowed(resolution.material.coverUrl, allowedHosts)) {
      return { valid: false, code: "COVER_URL_INVALID" };
    }
  }
  return {
    valid: true,
    videoUrl: resolution.material.videoUrl,
    coverUrl: resolution.material.coverUrl
  };
}

export function validatePublishMaterial(input: PublishMaterialInput): PublishMaterialValidation {
  const videoUrl = normalizeUrl(input.videoUrl);
  if (!videoUrl) return { valid: false, code: "VIDEO_REQUIRED" };
  if (!isHttpUrl(videoUrl)) return { valid: false, code: "VIDEO_URL_INVALID" };

  const coverUrl = normalizeUrl(input.coverUrl);
  if (!coverUrl) return { valid: false, code: "COVER_REQUIRED" };
  if (!isHttpUrl(coverUrl)) return { valid: false, code: "COVER_URL_INVALID" };

  return { valid: true, videoUrl, coverUrl };
}
