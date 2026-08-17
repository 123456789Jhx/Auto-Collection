import { Hono, type Context } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  publishInterfaceBindingService,
  PublishInterfaceBindingServiceError
} from "../services/publish-interface-binding.service";

const saveBindingSchema = z.object({
  accountName: z.string().trim().min(1).max(100),
  accountNo: z.string().trim().min(1).max(100),
  externalAccountKey: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(true)
}).strict();

export type PublishInterfaceBindingApiService = {
  list(): Promise<unknown>;
  preflight(): Promise<unknown>;
  save(deviceCode: string, payload: z.infer<typeof saveBindingSchema>, actor: string): Promise<unknown>;
  remove(deviceCode: string, actor: string): Promise<unknown>;
};

type AdminContext = Context<{ Variables: AdminVariables }>;

function serviceError(c: AdminContext, error: unknown) {
  if (!(error instanceof PublishInterfaceBindingServiceError)) throw error;
  const status = error.code === "DEVICE_NOT_FOUND" || error.code === "BINDING_NOT_FOUND" ? 404
    : error.code === "BINDING_CONFLICT" ? 409
      : 400;
  return c.json({
    error: {
      code: error.code,
      message: error.userMessage,
      details: {}
    }
  }, status);
}

export function createPublishInterfaceBindingRoutes(
  service: PublishInterfaceBindingApiService = publishInterfaceBindingService
) {
  const routes = new Hono<{ Variables: AdminVariables }>();

  routes.get("/", async (c) => c.json({ data: await service.list() }));
  routes.get("/preflight", async (c) => c.json({ data: await service.preflight() }));

  routes.put("/:deviceCode", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON", details: {} } }, 400);
    }
    const parsed = saveBindingSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      return c.json({
        data: await service.save(c.req.param("deviceCode"), parsed.data, c.get("admin").username)
      });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  routes.delete("/:deviceCode", async (c) => {
    try {
      return c.json({
        data: await service.remove(c.req.param("deviceCode"), c.get("admin").username)
      });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  return routes;
}

export const publishInterfaceBindingRoutes = createPublishInterfaceBindingRoutes();
