import {
  claimPublishTaskPayloadSchema,
  claimPublishTaskResponseSchema,
  externalPublishErrorSchema,
  patchPublishTaskStatusPayloadSchema,
  type ClaimPublishTaskPayload,
  type PatchPublishTaskStatusPayload,
  type ClaimedWecomPublishTask
} from "@pkg/types";

const REQUEST_TIMEOUT_MS = 10_000;

export type WecomPublishClientConfig = {
  externalBaseUrl: string;
  externalTokenEnv: string;
};

export type WecomPublishClientLog = {
  scope: "wecom-publish-client";
  event: "request_completed" | "request_failed";
  method: "OPTIONS" | "POST" | "PATCH";
  url: string;
  status?: number;
  code?: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type WecomPublishClientOptions = {
  fetch?: FetchLike;
  logger?: (entry: WecomPublishClientLog) => void;
};

export class WecomPublishClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage: string
  ) {
    super(code);
  }
}

export type InterfacePublishClaimResult =
  | { kind: "CLAIMED"; task: ClaimedWecomPublishTask }
  | { kind: "NO_MATERIAL" }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "RESULT_UNKNOWN"; code: "EXTERNAL_REQUEST_RESULT_UNKNOWN" };

function defaultLogger(entry: WecomPublishClientLog) {
  console.info(JSON.stringify(entry));
}

function baseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function tokenFor(config: WecomPublishClientConfig) {
  const token = process.env[config.externalTokenEnv];
  if (token) return token;

  throw new WecomPublishClientError(
    0,
    "EXTERNAL_TOKEN_ENV_MISSING",
    `环境变量 ${config.externalTokenEnv} 未配置`
  );
}

async function requestJson(
  config: WecomPublishClientConfig,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  options: WecomPublishClientOptions
) {
  const url = `${baseUrl(config.externalBaseUrl)}${path}`;
  const logger = options.logger ?? defaultLogger;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(config)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof WecomPublishClientError) {
      throw error;
    }
    logger({
      scope: "wecom-publish-client",
      event: "request_failed",
      method,
      url,
      code: "EXTERNAL_REQUEST_FAILED"
    });
    throw new WecomPublishClientError(0, "EXTERNAL_REQUEST_FAILED", "外部发布任务接口请求失败");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const parsedError = externalPublishErrorSchema.safeParse(payload);
    const code = parsedError.success ? parsedError.data.error.code : `HTTP_${response.status}`;
    const message = parsedError.success ? parsedError.data.error.message : "外部发布任务接口返回错误";
    logger({ scope: "wecom-publish-client", event: "request_failed", method, url, status: response.status, code });
    throw new WecomPublishClientError(response.status, code, message);
  }

  logger({ scope: "wecom-publish-client", event: "request_completed", method, url, status: response.status });
  return payload;
}

export async function claimRawTask(
  config: WecomPublishClientConfig,
  payload: ClaimPublishTaskPayload,
  options: WecomPublishClientOptions = {}
): Promise<unknown | null> {
  const body = claimPublishTaskPayloadSchema.parse(payload);
  const response = await requestJson(
    config,
    "POST",
    "/api/v1/external/publish-tasks/claim",
    body,
    options
  );
  if (!response || typeof response !== "object" || !("data" in response)) {
    throw new WecomPublishClientError(502, "EXTERNAL_TASK_PAYLOAD_INVALID", "外部领取接口响应缺少 data");
  }
  return (response as { data?: unknown }).data ?? null;
}

export async function claimTask(
  config: WecomPublishClientConfig,
  payload: ClaimPublishTaskPayload,
  options: WecomPublishClientOptions = {}
): Promise<ClaimedWecomPublishTask | null> {
  const data = await claimRawTask(config, payload, options);
  return claimPublishTaskResponseSchema.parse({ data }).data;
}

export async function claimInterfacePublishTask(
  config: WecomPublishClientConfig,
  accountName: string,
  options: WecomPublishClientOptions = {}
): Promise<InterfacePublishClaimResult> {
  try {
    const task = await claimTask(config, {
      platform: "抖音",
      accountName
    }, options);
    return task ? { kind: "CLAIMED", task } : { kind: "NO_MATERIAL" };
  } catch (error) {
    if (error instanceof WecomPublishClientError) {
      if (error.code === "EXTERNAL_REQUEST_FAILED") {
        return {
          kind: "RESULT_UNKNOWN",
          code: "EXTERNAL_REQUEST_RESULT_UNKNOWN"
        };
      }
      return { kind: "REJECTED", status: error.status, code: error.code };
    }
    return {
      kind: "REJECTED",
      status: 502,
      code: "EXTERNAL_TASK_PAYLOAD_INVALID"
    };
  }
}

export async function patchTaskStatus(
  config: WecomPublishClientConfig,
  taskId: string,
  payload: PatchPublishTaskStatusPayload,
  options: WecomPublishClientOptions = {}
) {
  const body = patchPublishTaskStatusPayloadSchema.parse(payload);
  return requestJson(
    config,
    "PATCH",
    `/api/v1/external/publish-tasks/${encodeURIComponent(taskId)}/status`,
    body,
    options
  );
}


export type WecomPublishConnectionResult = {
  reachable: true;
  httpStatus: number;
  message: string;
};

export async function testConnection(
  config: WecomPublishClientConfig,
  options: WecomPublishClientOptions = {}
): Promise<WecomPublishConnectionResult> {
  const url = `${baseUrl(config.externalBaseUrl)}/api/v1/external/publish-tasks/claim`;
  const logger = options.logger ?? defaultLogger;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "OPTIONS",
      headers: { Authorization: `Bearer ${tokenFor(config)}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof WecomPublishClientError) throw error;
    logger({
      scope: "wecom-publish-client",
      event: "request_failed",
      method: "OPTIONS",
      url,
      code: "EXTERNAL_CONNECTION_UNREACHABLE"
    });
    throw new WecomPublishClientError(
      0,
      "EXTERNAL_CONNECTION_UNREACHABLE",
      "外部接口不可达，请检查地址、网络或 TLS 配置"
    );
  }

  if (response.status === 401 || response.status === 403) {
    logger({
      scope: "wecom-publish-client",
      event: "request_failed",
      method: "OPTIONS",
      url,
      status: response.status,
      code: "EXTERNAL_CONNECTION_AUTH_FAILED"
    });
    throw new WecomPublishClientError(
      response.status,
      "EXTERNAL_CONNECTION_AUTH_FAILED",
      "外部接口认证失败，请检查 Token 环境变量配置"
    );
  }

  logger({
    scope: "wecom-publish-client",
    event: "request_completed",
    method: "OPTIONS",
    url,
    status: response.status
  });
  return {
    reachable: true,
    httpStatus: response.status,
    message: response.ok
      ? "外部接口 HTTP 可达"
      : `外部接口 HTTP 可达（HTTP ${response.status}）`
  };
}
