import { ApiError } from "./api-client";

const apiBaseUrl =
  (import.meta.env.PROD ? import.meta.env.VITE_API_BASE_URL_PROD : import.meta.env.VITE_API_BASE_URL_DEV) ??
  import.meta.env.VITE_API_BASE_URL ??
  "/api/v1";

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("auto_collection_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function download(path: string): Promise<{ blob: Blob; filename?: string }> {
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message || message;
    } catch {
      // Keep the HTTP status fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status, "API_REQUEST_FAILED", {});
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const encoded = /filename\*?=(?:UTF-8''|\"?)([^\";]+)/i.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    filename: encoded ? decodeURIComponent(encoded.replace(/\"/g, "")) : undefined
  };
}
