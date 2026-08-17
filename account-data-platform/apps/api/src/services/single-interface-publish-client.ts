import { z } from "zod";

const TEST_BASE_URL = "https://wecom.dafengchan.top";
const TOKEN_ENV = "PUBLISH_EXTERNAL_TOKEN";

const singleTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  platform: z.literal("抖音"),
  status: z.literal("未发布"),
  title: z.string().trim().min(1),
  description: z.string(),
  videoUrl: z.string().trim().url(),
  coverUrl: z.string().trim().url()
}).passthrough();

export type SingleDouyinPublishTask = z.infer<typeof singleTaskSchema>;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class SingleInterfacePublishClientError extends Error {
  constructor(readonly code: string, readonly userMessage: string) {
    super(code);
  }
}

export async function fetchSingleDouyinPublishTask(
  douyinId: string,
  options: { fetch?: FetchLike } = {}
): Promise<SingleDouyinPublishTask | null> {
  const token = process.env[TOKEN_ENV];
  if (!token) {
    throw new SingleInterfacePublishClientError("EXTERNAL_TOKEN_ENV_MISSING", `环境变量 ${TOKEN_ENV} 未配置`);
  }
  const url = new URL(`/api/v1/external/douyin-accounts/${encodeURIComponent(douyinId)}/publish-tasks`, TEST_BASE_URL);
  url.searchParams.set("status", "未发布");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "1");

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new SingleInterfacePublishClientError("EXTERNAL_REQUEST_FAILED", "测试素材接口请求失败");
  }
  if (!response.ok) {
    throw new SingleInterfacePublishClientError(`EXTERNAL_HTTP_${response.status}`, "测试素材接口返回错误");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SingleInterfacePublishClientError("EXTERNAL_TASK_PAYLOAD_INVALID", "测试素材接口响应不是 JSON");
  }
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
      ? payload.data
      : null;
  if (!rows) {
    throw new SingleInterfacePublishClientError("EXTERNAL_TASK_PAYLOAD_INVALID", "测试素材接口响应缺少任务数组");
  }
  if (rows.length === 0) return null;
  const parsed = singleTaskSchema.safeParse(rows[0]);
  if (!parsed.success) {
    throw new SingleInterfacePublishClientError("EXTERNAL_TASK_PAYLOAD_INVALID", "测试素材字段不完整");
  }
  return parsed.data;
}
