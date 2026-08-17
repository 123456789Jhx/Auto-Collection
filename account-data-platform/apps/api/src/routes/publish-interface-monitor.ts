import { Hono, type Context } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import type { AdminVariables } from "../middleware/admin-auth";
import { publishInterfaceMonitorRepository } from "../repositories/publish-interface-monitor.repository";
import { publishInterfaceClaimService } from "../services/publish-interface-claim.service";
import { publishInterfaceResultService } from "../services/publish-interface-result.service";

const idSchema = z.string().uuid();
const resultResolutionSchema = z.object({
  resolution: z.enum(["PUBLISHED", "FAILED"]),
  evidence: z.string().trim().min(1)
}).strict();
const claimResolutionSchema = z.object({
  resolution: z.literal("SAFE_TO_RETRY"),
  evidence: z.string().trim().min(1)
}).strict();

export type PublishInterfaceMonitorApiService = {
  getRunDetails: (runId: string) => Promise<unknown>;
  markAlertRead: (alertId: string, actor: string) => Promise<unknown>;
  resolveResultUnknown: (input: {
    publishTaskId: string;
    resolution: "PUBLISHED" | "FAILED";
    evidence: string;
    actor: string;
  }) => Promise<unknown>;
  resolveClaimResultUnknown: (input: {
    slotExecutionId: string;
    resolution: "SAFE_TO_RETRY";
    evidence: string;
    actor: string;
  }) => Promise<unknown>;
};

const defaultService: PublishInterfaceMonitorApiService = {
  getRunDetails: (runId) => publishInterfaceMonitorRepository.getRunDetails(runId),
  markAlertRead: (alertId, actor) => publishInterfaceMonitorRepository.markAlertRead(alertId, actor),
  resolveResultUnknown: (input) => publishInterfaceResultService.resolveResultUnknown(input),
  resolveClaimResultUnknown: (input) => publishInterfaceClaimService.resolveClaimResultUnknown(input)
};

async function body(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return { valid: true as const, data: await c.req.json() };
  } catch {
    return { valid: false as const, data: null };
  }
}

function mapError(c: Context, error: unknown) {
  const code = String(error instanceof Error ? error.message : error);
  const status = code.endsWith("NOT_FOUND") ? 404 : code.endsWith("STATE_INVALID") ? 409 : 400;
  return c.json({ error: { code, message: code, details: {} } }, status);
}

export function createPublishInterfaceMonitorRoutes(
  service: PublishInterfaceMonitorApiService = defaultService
) {
  const routes = new Hono<{ Variables: AdminVariables }>();

  routes.get("/runs/:runId", async (c) => {
    const id = idSchema.safeParse(c.req.param("runId"));
    if (!id.success) return validationError(c, id.error);
    try {
      return c.json({ data: await service.getRunDetails(id.data) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  routes.post("/alerts/:alertId/read", async (c) => {
    const id = idSchema.safeParse(c.req.param("alertId"));
    if (!id.success) return validationError(c, id.error);
    try {
      return c.json({ data: await service.markAlertRead(id.data, c.get("admin").username) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  routes.post("/tasks/:taskId/resolve-result", async (c) => {
    const id = idSchema.safeParse(c.req.param("taskId"));
    if (!id.success) return validationError(c, id.error);
    const payload = await body(c);
    if (!payload.valid) return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    const parsed = resultResolutionSchema.safeParse(payload.data);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      return c.json({ data: await service.resolveResultUnknown({
        publishTaskId: id.data,
        ...parsed.data,
        actor: c.get("admin").username
      }) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  routes.post("/slots/:slotId/resolve-claim", async (c) => {
    const id = idSchema.safeParse(c.req.param("slotId"));
    if (!id.success) return validationError(c, id.error);
    const payload = await body(c);
    if (!payload.valid) return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    const parsed = claimResolutionSchema.safeParse(payload.data);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      return c.json({ data: await service.resolveClaimResultUnknown({
        slotExecutionId: id.data,
        ...parsed.data,
        actor: c.get("admin").username
      }) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  return routes;
}

export const publishInterfaceMonitorRoutes = createPublishInterfaceMonitorRoutes();
