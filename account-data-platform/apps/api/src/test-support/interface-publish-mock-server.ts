import type { ClaimedWecomPublishTask } from "@pkg/types";
import { Hono } from "hono";
import { z } from "zod";

const claimSchema = z.object({
  platform: z.literal("抖音"),
  accountName: z.string().trim().min(1)
}).strict();

const patchSchema = z.object({
  platform: z.literal("抖音"),
  status: z.enum(["已发布", "未发布"]),
  error: z.string().optional(),
  publishedUrl: z.string().url().optional(),
  platformContentId: z.string().optional()
}).strict();

type MockOptions = {
  queues: Record<string, ClaimedWecomPublishTask[]>;
  token?: string;
  claimDelayMs?: number;
  rejectedAccounts?: Set<string>;
  rejectedPatchTaskIds?: Set<string>;
};

export type InterfacePublishMockPatch = {
  taskId: string;
  payload: z.infer<typeof patchSchema>;
};

export function createInterfacePublishMockServer(options: MockOptions) {
  const app = new Hono();
  const queues = new Map(
    Object.entries(options.queues).map(([accountName, tasks]) => [accountName, [...tasks]])
  );
  const patchByTarget = new Map<string, string>();
  const state = {
    claims: [] as string[],
    patches: [] as InterfacePublishMockPatch[]
  };

  app.use("*", async (context, next) => {
    const expected = `Bearer ${options.token ?? "mock-token"}`;
    if (context.req.header("authorization") !== expected) {
      return context.json({ error: { code: "TOKEN_INVALID", message: "invalid mock token" } }, 401);
    }
    await next();
  });

  app.options("/api/v1/external/publish-tasks/claim", (context) => context.body(null, 204));

  app.post("/api/v1/external/publish-tasks/claim", async (context) => {
    if (options.claimDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.claimDelayMs));
    }
    const parsed = claimSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json({ error: { code: "VALIDATION_ERROR", message: "invalid claim payload" } }, 400);
    }
    if (options.rejectedAccounts?.has(parsed.data.accountName)) {
      return context.json({ error: { code: "CLAIM_CONFLICT", message: "mock claim conflict" } }, 409);
    }
    state.claims.push(parsed.data.accountName);
    const queue = queues.get(parsed.data.accountName) ?? [];
    return context.json({ data: queue.shift() ?? null });
  });

  app.patch("/api/v1/external/publish-tasks/:taskId/status", async (context) => {
    const taskId = context.req.param("taskId");
    if (options.rejectedPatchTaskIds?.has(taskId)) {
      return context.json({ error: { code: "PATCH_CONFLICT", message: "mock patch conflict" } }, 409);
    }
    const parsed = patchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json({ error: { code: "VALIDATION_ERROR", message: "invalid patch payload" } }, 400);
    }
    const targetKey = `${taskId}:${parsed.data.status}`;
    const serialized = JSON.stringify(parsed.data);
    const existing = patchByTarget.get(targetKey);
    if (existing) {
      if (existing !== serialized) {
        return context.json({ error: { code: "PATCH_PAYLOAD_CONFLICT", message: "mock payload conflict" } }, 409);
      }
      return context.json({ data: { success: true, duplicate: true } });
    }
    patchByTarget.set(targetKey, serialized);
    state.patches.push({ taskId, payload: parsed.data });
    return context.json({ data: { success: true, duplicate: false } });
  });

  return { app, state };
}
