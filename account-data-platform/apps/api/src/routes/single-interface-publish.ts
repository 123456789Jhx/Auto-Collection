import { Hono } from "hono";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  SingleInterfacePublishServiceError,
  singleInterfacePublishService
} from "../services/single-interface-publish.service";
import { SingleInterfacePublishClientError } from "../services/single-interface-publish-client";

type Service = {
  start(actor: string): Promise<unknown>;
  current(): Promise<unknown>;
  stop(actor: string): Promise<unknown>;
};

function errorResponse(c: Parameters<Parameters<Hono<{ Variables: AdminVariables }>["onError"]>[0]>[1], error: unknown) {
  if (error instanceof SingleInterfacePublishServiceError || error instanceof SingleInterfacePublishClientError) {
    const status = error.message === "NO_UNPUBLISHED_MATERIAL" ? 404 : 409;
    return c.json({ error: { code: error.message, message: error.userMessage, details: {} } }, status);
  }
  throw error;
}

export function createSingleInterfacePublishRoutes(service: Service = singleInterfacePublishService) {
  const routes = new Hono<{ Variables: AdminVariables }>();
  routes.post("/start", async (c) => {
    try {
      return c.json(await service.start(c.get("admin").username));
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  routes.get("/current", async (c) => c.json(await service.current()));
  routes.post("/stop", async (c) => {
    try {
      return c.json(await service.stop(c.get("admin").username));
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  return routes;
}

export const singleInterfacePublishRoutes = createSingleInterfacePublishRoutes();
