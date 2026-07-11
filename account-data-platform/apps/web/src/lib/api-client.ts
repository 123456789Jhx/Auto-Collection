import type {
  CommerceCardFeaturePreview,
  FeatureRolloutControl,
  FeatureRolloutControlUpdate,
  FeatureRolloutKey,
  LiveTargetFeatureType
} from "@pkg/types";

const apiBaseUrl =
  (import.meta.env.PROD ? import.meta.env.VITE_API_BASE_URL_PROD : import.meta.env.VITE_API_BASE_URL_DEV) ??
  import.meta.env.VITE_API_BASE_URL ??
  "/api/v1";
const adminTokenStorageKey = "auto_collection_admin_token";

type QueryParams = Record<string, string | number | undefined>;

export type AdminUser = {
  username: string;
  role: "admin";
  expiresAt: string;
};

export type AdminLoginResponse = {
  token: string;
  user: AdminUser;
};

export function getAdminToken() {
  return window.localStorage.getItem(adminTokenStorageKey);
}

export function setAdminToken(token: string) {
  window.localStorage.setItem(adminTokenStorageKey, token);
}

export function clearAdminToken() {
  window.localStorage.removeItem(adminTokenStorageKey);
}

function authHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toQuery(params?: QueryParams) {
  if (!params) return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      clearAdminToken();
      window.dispatchEvent(new Event("admin-auth-expired"));
    }

    let message = `API request failed: ${response.status}`;
    let code = "API_REQUEST_FAILED";
    let details: unknown = {};
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      message = body.error?.message || message;
      code = body.error?.code || code;
      details = body.error?.details ?? details;
    } catch {
      // Keep the HTTP status fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status, code, details);
  }
  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}${toQuery(params)}`, {
    headers: authHeaders()
  });
  return handleResponse<T>(response);
}

async function mutate<T>(path: string, body: unknown, authenticated = true): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authenticated ? authHeaders() : {}) },
    body: JSON.stringify(body)
  });
  return handleResponse<T>(response);
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  return handleResponse<T>(response);
}

async function remove<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  return handleResponse<T>(response);
}

export function loginAdmin(payload: { username: string; password: string }) {
  return mutate<AdminLoginResponse>("/admin/auth/login", payload, false);
}

export function getCurrentAdmin() {
  return request<{ user: AdminUser }>("/admin/auth/me");
}

export function getOverview() {
  return request<Record<string, unknown>>("/admin/overview");
}

export function getDevices() {
  return request<unknown[]>("/admin/devices");
}

export function getDeviceProgressHistory(deviceCode: string, params?: QueryParams) {
  return request<unknown[]>(`/admin/devices/${encodeURIComponent(deviceCode)}/progress-history`, params);
}

export function getDeviceDailyProgress(deviceCode: string, params?: QueryParams) {
  return request<unknown[]>(`/admin/devices/${encodeURIComponent(deviceCode)}/daily-progress`, params);
}

export function updateDevice(deviceCode: string, payload: {
  deviceName?: string;
  enabled?: boolean;
  remark?: string;
  lastRegion?: string;
  accountProfile?: Record<string, unknown> | null;
}) {
  return patch<unknown>(`/admin/devices/${encodeURIComponent(deviceCode)}`, payload);
}

export function rotateDeviceToken(deviceCode: string) {
  return mutate<{ deviceCode: string; deviceToken: string }>(`/admin/devices/${encodeURIComponent(deviceCode)}/token`, {});
}

export function clearDeviceToken(deviceCode: string) {
  return remove<unknown>(`/admin/devices/${encodeURIComponent(deviceCode)}/token`);
}

export function getRecords(params?: QueryParams) {
  return request<{ data: unknown[]; pagination: Record<string, number> }>("/admin/collection-records", params);
}

export function getLiveCommentActions(params?: QueryParams) {
  return request<{ data: unknown[]; pagination: Record<string, number> }>("/admin/live-comment-actions", params);
}

export function getLiveCommentDeviceSummary(params?: QueryParams) {
  return request<unknown[]>("/admin/live-comment-device-summary", params);
}

export function getRecordDeviceSummary(params?: QueryParams) {
  return request<unknown[]>("/admin/collection-record-device-summary", params);
}

export function getRecordDates(deviceCode: string) {
  return request<unknown[]>(`/admin/devices/${encodeURIComponent(deviceCode)}/collection-record-dates`);
}

export function getLogs(params?: QueryParams) {
  return request<{ data: unknown[]; pagination: Record<string, number> }>("/admin/runtime-logs", params);
}

export function getLogDeviceSummary(params?: QueryParams) {
  return request<unknown[]>("/admin/runtime-log-device-summary", params);
}

export function getLogDates(deviceCode: string) {
  return request<unknown[]>(`/admin/devices/${encodeURIComponent(deviceCode)}/runtime-log-dates`);
}

export function getLogFileDates(deviceCode: string) {
  return request<unknown[]>(`/admin/devices/${encodeURIComponent(deviceCode)}/log-file-dates`);
}

export function getLogFiles(params?: QueryParams) {
  return request<unknown[]>("/admin/log-files", params);
}

export function getLogFileDetail(fileId: string) {
  return request<Record<string, unknown>>(`/admin/log-files/${encodeURIComponent(fileId)}`);
}

export function getTasks() {
  return request<unknown[]>("/admin/tasks");
}

export type { LiveTargetFeatureType };

export type LiveTargetAlias = {
  id?: string;
  aliasText: string;
  aliasType: string;
  weight: number;
  enabled: boolean;
};

export type LiveTargetFeatureConfig = {
  id?: string;
  featureType: LiveTargetFeatureType;
  searchKeywords: string[];
  requiredKeywords?: string[];
  forbiddenKeywords?: string[];
  productKeywords?: string[];
  liveSignals?: string[];
  runtimeConfig?: Record<string, unknown>;
  enabled: boolean;
  expectedRevision?: number;
  revision?: number;
  configHash?: string | null;
  storedWorkflowVersion?: 1 | 2;
  configValidationError?: string | null;
  updatedAt?: string;
};

export type LiveTarget = {
  id?: string;
  targetCode: string;
  targetName: string;
  platform: string;
  similarityThreshold: number;
  enabled: boolean;
  remark?: string | null;
  aliases: LiveTargetAlias[];
  featureConfigs: LiveTargetFeatureConfig[];
  bindings?: Array<{
    deviceId?: string | null;
    targetId: string;
    featureType: LiveTargetFeatureType;
    priority: number;
    enabled: boolean;
  }>;
  updatedAt?: string;
};

export function getLiveTargets(platform = "douyin") {
  return request<LiveTarget[]>("/admin/live-targets", { platform });
}

export function saveLiveTarget(payload: {
  id?: string;
  targetCode: string;
  targetName: string;
  platform?: string;
  similarityThreshold?: number;
  enabled?: boolean;
  remark?: string | null;
  aliases?: LiveTargetAlias[];
  expectedRevisions?: Partial<Record<LiveTargetFeatureType, number>>;
}) {
  if (payload.id) {
    return patch<LiveTarget>(`/admin/live-targets/${encodeURIComponent(payload.id)}`, payload);
  }
  return mutate<LiveTarget>("/admin/live-targets", payload);
}

export function deleteLiveTarget(targetId: string) {
  return remove<{ success: boolean }>(`/admin/live-targets/${encodeURIComponent(targetId)}`);
}

export function saveLiveTargetFeatureConfig(targetId: string, payload: LiveTargetFeatureConfig) {
  return mutate<LiveTarget>(`/admin/live-targets/${encodeURIComponent(targetId)}/feature-configs`, payload);
}

export function saveDeviceLiveTargetBindings(payload: {
  targetId: string;
  featureType: LiveTargetFeatureType;
  deviceCodes: string[];
  defaultEnabled?: boolean;
  expectedRevision?: number;
}) {
  return mutate<LiveTarget>("/admin/live-target-device-bindings", payload);
}

export function getCommerceCardFeaturePreview(targetId: string) {
  return request<CommerceCardFeaturePreview>(`/admin/live-targets/${encodeURIComponent(targetId)}/feature-configs/commerce-card/preview`);
}

export function getFeatureRolloutControls() {
  return request<FeatureRolloutControl[]>("/admin/feature-rollout-controls");
}

export function updateFeatureRolloutControl(featureKey: FeatureRolloutKey, payload: FeatureRolloutControlUpdate) {
  return patch<FeatureRolloutControl>(`/admin/feature-rollout-controls/${encodeURIComponent(featureKey)}`, payload);
}

export function getTaskAssignments() {
  return request<unknown[]>("/admin/task-assignments");
}

export function createTaskAssignment(payload: {
  deviceId: string;
  taskType: "video" | "live" | "live_comment" | "commerce_card_live_comment";
  commandType?: "START" | "RESUME" | "PAUSE" | "STOP";
  reason?: string;
  priority?: number;
  source?: string;
  targetContext?: string;
  payload?: Record<string, unknown>;
  expiresInSeconds?: number;
}) {
  return mutate<unknown>("/admin/task-assignments", payload);
}

export function getDeviceTaskConfig(deviceCode: string, platform?: string) {
  return request<Record<string, unknown>>(`/admin/devices/${encodeURIComponent(deviceCode)}/task-config`, { platform });
}

export function updateTask(taskId: string, payload: {
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  autoStart?: boolean;
  collectComments?: boolean;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentConfig?: Record<string, unknown>;
  liveCommentBotConfig?: Record<string, unknown>;
  p3ExtensionsConfig?: Record<string, unknown>;
}) {
  return patch<unknown>(`/admin/tasks/${taskId}`, payload);
}

export function updateDeviceTaskConfig(deviceCode: string, payload: {
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  autoStart?: boolean;
  collectComments?: boolean;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentRole?: "none" | "followed" | "follower";
  liveCommentGroup?: "A" | "B" | "C" | null;
  followedAccountName?: string | null;
  followedAccountId?: string | null;
  followedAliases?: string[] | null;
  liveCommentMode?: "off" | "target_follow" | "agri_chatbot";
  liveCommentBotConfig?: Record<string, unknown> | null;
  liveCommentConfig?: Record<string, unknown>;
  p3ExtensionsConfig?: Record<string, unknown>;
}, platform?: string) {
  return patch<unknown>(`/admin/devices/${encodeURIComponent(deviceCode)}/task-config${toQuery({ platform })}`, payload);
}

export function createMobileCommand(payload: {
  deviceId: string;
  commandType: "START" | "PAUSE" | "RESUME" | "STOP" | "REFRESH_CONFIG" | "STATUS" | "RESTART_APP" | "RESTART_AGENT" | "CHECK_UPDATE" | "UPDATE_AGENT" | "UPLOAD_LOG";
  payload?: Record<string, unknown>;
  expiresInSeconds?: number;
}) {
  return mutate<unknown>("/admin/mobile-commands", payload);
}
