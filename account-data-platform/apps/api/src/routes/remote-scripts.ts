import {
  agentUpdateEventListQuerySchema,
  agentVersionChannelSchema,
  agentVersionListQuerySchema,
  buildBizScriptReleaseSchema,
  createRemoteScriptConfigSchema,
  createAgentVersionSchema,
  remoteScriptDeviceBindingPayloadSchema,
  remoteScriptConfigListQuerySchema,
  updateRemoteScriptConfigSchema
} from "@pkg/types";
import { Hono, type Context } from "hono";
import { validationError } from "../lib/validation";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  createRemoteScriptConfig,
  bindRemoteScriptConfig,
  deleteRemoteScriptConfig,
  getRemoteScriptConfig,
  getRemoteScriptBindings,
  getRemoteScriptConfigs,
  RemoteScriptServiceError,
  unbindRemoteScriptConfig,
  updateRemoteScriptConfig
} from "../services/remote-script.service";
import {
  AgentVersionServiceError,
  getAgentDeviceUpdateStatus,
  getAgentUpdateEvents,
  getAgentVersions,
  publishAgentVersion
} from "../services/agent-version.service";
import { z } from "zod";
import { BizScriptBuildError, bizScriptReleaseService } from "../services/biz-script-release.service";

type AdminContext = Context<{ Variables: AdminVariables }>;

function remoteScriptErrorResponse(c: AdminContext, error: unknown) {
  if (!(error instanceof RemoteScriptServiceError)) {
    throw error;
  }
  const body = {
    error: {
      code: error.message,
      message: error.userMessage,
      details: error.details
    }
  };
  if (error.message === "NOT_FOUND") {
    return c.json(body, 404);
  }
  if (error.message === "PAYLOAD_SCHEMA_MISMATCH") {
    return c.json(body, 400);
  }
  return c.json(body, 409);
}

export const remoteScriptConfigRoutes = new Hono<{ Variables: AdminVariables }>();

remoteScriptConfigRoutes.get("/releases", async (c) => {
  const parsed = agentVersionListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error);
  return c.json({ data: await getAgentVersions(parsed.data) });
});

remoteScriptConfigRoutes.post("/releases", async (c) => {
  const parsed = createAgentVersionSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    const savedVersion = await publishAgentVersion(parsed.data);
    return c.json(savedVersion, savedVersion.idempotent ? 200 : 201);
  } catch (error) {
    if (!(error instanceof AgentVersionServiceError)) throw error;
    return c.json({
      error: { code: error.message, message: error.userMessage, details: error.details }
    }, 409);
  }
});

remoteScriptConfigRoutes.post("/releases/build", async (c) => {
  const parsed = buildBizScriptReleaseSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await bizScriptReleaseService.build(parsed.data), 201);
  } catch (error) {
    if (!(error instanceof BizScriptBuildError)) throw error;
    return c.json({
      error: { code: error.message, message: error.userMessage, details: error.details }
    }, error.message === "BUILD_IN_PROGRESS" ? 409 : 500);
  }
});

remoteScriptConfigRoutes.get("/update-events", async (c) => {
  const parsed = agentUpdateEventListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error);
  return c.json(await getAgentUpdateEvents(parsed.data));
});

remoteScriptConfigRoutes.get("/device-update-status", async (c) => {
  const parsed = z.object({ channel: agentVersionChannelSchema.default("biz-scripts") })
    .strict()
    .safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error);
  return c.json(await getAgentDeviceUpdateStatus(parsed.data.channel));
});

remoteScriptConfigRoutes.get("/configs", async (c) => {
  const parsed = remoteScriptConfigListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await getRemoteScriptConfigs(parsed.data));
});

remoteScriptConfigRoutes.post("/configs", async (c) => {
  const parsed = createRemoteScriptConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(
      await createRemoteScriptConfig(parsed.data, c.get("admin").username),
      201
    );
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.get("/configs/:id", async (c) => {
  try {
    return c.json(await getRemoteScriptConfig(c.req.param("id")));
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.patch("/configs/:id", async (c) => {
  const parsed = updateRemoteScriptConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(
      await updateRemoteScriptConfig(
        c.req.param("id"),
        parsed.data,
        c.get("admin").username
      )
    );
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.delete("/configs/:id", async (c) => {
  try {
    await deleteRemoteScriptConfig(c.req.param("id"), c.get("admin").username);
    return c.json({ success: true });
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.get("/configs/:id/bindings", async (c) => {
  try {
    return c.json({ data: await getRemoteScriptBindings(c.req.param("id")) });
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.post("/configs/:id/bindings", async (c) => {
  const parsed = remoteScriptDeviceBindingPayloadSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(
      await bindRemoteScriptConfig(c.req.param("id"), parsed.data, c.get("admin").username),
      201
    );
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});

remoteScriptConfigRoutes.delete("/configs/:id/bindings/:deviceCode", async (c) => {
  try {
    return c.json(await unbindRemoteScriptConfig(
      c.req.param("id"),
      c.req.param("deviceCode"),
      c.get("admin").username
    ));
  } catch (error) {
    return remoteScriptErrorResponse(c, error);
  }
});
