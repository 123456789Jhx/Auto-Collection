import {
  claimPublishTaskPayloadSchema,
  claimPublishTaskResponseSchema,
  externalPublishErrorSchema,
  patchPublishTaskStatusPayloadSchema,
  type ClaimPublishTaskPayload,
  type PatchPublishTaskStatusPayload,
  type WecomPublishTask
} from "@pkg/types";

const REQUEST_TIMEOUT_MS = 10_000;

export type WecomPublishClientConfig = {
  externalBaseUrl: string;
  externalTokenEnv: string;
};

export type WecomPublishClientLog = {
  scope: "wecom-publish-client";
  event: "request_completed" | "request_failed";
  method: "POST" | "PATCH";
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

function defaultLogger(entry: WecomPublishClientLog) {
  console.info(JSON.stringify(entry));
}

function baseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function tokenFor(config: WecomPublishClientConfig) {
  const token = process.env[config.externalTokenEnv];
  if (!token) {
    throw new WecomPublishClientError(
      0,
      "EXTERNAL_TOKEN_ENV_MISSING",
      `环境变量 ${config.externalTokenEnv} 未配置`
    );
  }
  return token;
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

export async function claimTask(
  config: WecomPublishClientConfig,
  payload: ClaimPublishTaskPayload,
  options: WecomPublishClientOptions = {}
): Promise<WecomPublishTask | null> {
  const body = claimPublishTaskPayloadSchema.parse(payload);
  const response = await requestJson(
    config,
    "POST",
    "/api/v1/external/publish-tasks/claim",
    body,
    options
  );
  return claimPublishTaskResponseSchema.parse(response).data;
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
