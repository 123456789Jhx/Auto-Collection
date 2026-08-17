import {
  interfacePublishConfirmRunPayloadSchema,
  interfacePublishRunConfigSchema
} from "@pkg/types";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  publishInterfaceRunService,
  PublishInterfaceRunServiceError
} from "../services/publish-interface-run.service";

const stopPayloadSchema = z.object({
  confirmedDailyFallbackRisk: z.boolean().default(false)
}).strict();

const runIdSchema = z.string().uuid();

export type PublishInterfaceRunApiService = Pick<
  typeof publishInterfaceRunService,
  "create" | "confirm" | "requestStop" | "getStopRisk" | "getCurrent" | "getById"
>;

type AdminContext = Context<{ Variables: AdminVariables }>;

function runServiceError(c: AdminContext, error: unknown) {
  if (!(error instanceof PublishInterfaceRunServiceError)) throw error;
  if (error.code === "RUN_NOT_FOUND") {
    return c.json({ error: { code: "RUN_NOT_FOUND", message: error.userMessage, details: error.details } }, 404);
  }
  if (error.code === "RUN_ALREADY_ACTIVE") {
    return c.json({ error: { code: "RUN_ALREADY_ACTIVE", message: error.userMessage, details: error.details } }, 409);
  }
  if (error.code === "MORNING_PUBLISH_TIME_PASSED" || error.code === "AFTERNOON_PUBLISH_TIME_PASSED") {
    return c.json({
      error: {
        code: "RUN_START_TIME_INVALID",
        message: error.userMessage,
        details: { ...error.details, reasonCode: error.code }
      }
    }, 400);
  }
  if (error.code === "RUN_STATE_INVALID") {
    return c.json({ error: { code: "RUN_STATE_CONFLICT", message: error.userMessage, details: error.details } }, 409);
  }
  return c.json({ error: { code: error.code, message: error.userMessage, details: error.details } }, 400);
}

async function jsonBody(c: AdminContext) {
  try {
    return { valid: true as const, data: await c.req.json() as unknown };
  } catch {
    return { valid: false as const };
  }
}

export function createPublishInterfaceRunRoutes(
  service: PublishInterfaceRunApiService = publishInterfaceRunService
) {
  const routes = new Hono<{ Variables: AdminVariables }>();

  routes.post("/preflight", async (c) => {
    const body = await jsonBody(c);
    if (!body.valid) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    }
    const parsed = interfacePublishRunConfigSchema.safeParse(body.data);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      return c.json({ data: await service.create(parsed.data, c.get("admin").username) });
    } catch (error) {
      return runServiceError(c, error);
    }
  });

  routes.get("/current", async (c) => c.json({ data: await service.getCurrent() }));

  routes.post("/:runId/confirm", async (c) => {
    const runId = runIdSchema.safeParse(c.req.param("runId"));
    if (!runId.success) return validationError(c, runId.error);
    const body = await jsonBody(c);
    if (!body.valid) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    }
    const parsed = interfacePublishConfirmRunPayloadSchema.safeParse(body.data);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      return c.json({
        data: await service.confirm(runId.data, parsed.data, c.get("admin").username)
      });
    } catch (error) {
      if (error instanceof PublishInterfaceRunServiceError && error.code === "RUN_STATE_INVALID") {
        try {
          const run = await service.getById(runId.data);
          if (["SCHEDULED", "RUNNING", "STOPPING", "STOPPED"].includes(run.status)) {
            return c.json({ data: { run, bindings: [], idempotent: true } });
          }
        } catch (lookupError) {
          return runServiceError(c, lookupError);
        }
      }
      return runServiceError(c, error);
    }
  });

  routes.post("/:runId/stop", async (c) => {
    const runId = runIdSchema.safeParse(c.req.param("runId"));
    if (!runId.success) return validationError(c, runId.error);
    const body = await jsonBody(c);
    if (!body.valid) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    }
    const parsed = stopPayloadSchema.safeParse(body.data);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      const risk = await service.getStopRisk(runId.data);
      if (risk.incompleteAccountCount > 0 && !parsed.data.confirmedDailyFallbackRisk) {
        return c.json({
          error: {
            code: "RUN_STOP_CONFIRMATION_REQUIRED",
            message: "停止后这些账号今天可能无法完成保底发布",
            details: risk
          }
        }, 409);
      }
      return c.json({
        data: await service.requestStop(runId.data, c.get("admin").username)
      });
    } catch (error) {
      return runServiceError(c, error);
    }
  });

  routes.get("/:runId", async (c) => {
    const runId = runIdSchema.safeParse(c.req.param("runId"));
    if (!runId.success) return validationError(c, runId.error);
    try {
      return c.json({ data: await service.getById(runId.data) });
    } catch (error) {
      return runServiceError(c, error);
    }
  });

  return routes;
}

export const publishInterfaceRunRoutes = createPublishInterfaceRunRoutes();
