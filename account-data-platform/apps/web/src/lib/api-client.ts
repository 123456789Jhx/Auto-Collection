const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

type QueryParams = Record<string, string | number | undefined>;

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

async function request<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}${toQuery(params)}`);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function mutate<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function remove<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
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
