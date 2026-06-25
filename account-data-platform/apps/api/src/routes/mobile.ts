import { mobileAgentUpdateEventSchema, mobileCollectionRecordSchema, mobileCommandAckSchema, mobileHeartbeatSchema, mobileLiveCommentActionSchema, mobileLogFileSchema, mobileRuntimeLogSchema } from "@pkg/types";
import { Hono } from "hono";
import { savedResponse } from "../lib/response";
import { validationError } from "../lib/validation";
import { mobileAuth } from "../middleware/mobile-auth";
import { acknowledgeCommand, pollCommands } from "../services/command.service";
import { getAgentVersionCheck, saveAgentUpdateEvent } from "../services/agent-version.service";
import { getCurrentTask, registerDeviceToken, saveCollectionRecord, saveHeartbeat, saveLiveCommentAction, saveLogFile, saveRuntimeLog } from "../services/mobile.service";

type MobileVariables = {
  mobileBody: Record<string, unknown>;
  clientIp: string;
  deviceToken: string;
};

export const mobileRoutes = new Hono<{ Variables: MobileVariables }>();

function mobileLog(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({
    scope: "mobile-api",
    event,
    at: new Date().toISOString(),
    ...details
  }));
}

function logValidationError(route: string, body: Record<string, unknown>, error: { flatten: () => unknown }) {
  mobileLog("validation_failed", {
    route,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
    details: error.flatten()
  });
}

function mobileBody(c: { get: (key: "mobileBody") => Record<string, unknown> }) {
  return c.get("mobileBody") || {};
}

function clientIp(c: { get: (key: "clientIp") => string }) {
  return c.get("clientIp") || undefined;
}

function deviceToken(c: { get: (key: "deviceToken") => string }) {
  return c.get("deviceToken") || undefined;
}

mobileRoutes.use("*", mobileAuth);

mobileRoutes.post("/device-token/register", async (c) => {
  const body = mobileBody(c);
  try {
    const result = await registerDeviceToken({
      deviceId: String(body.deviceId || ""),
      deviceToken: String(body.deviceToken || ""),
      registrationSecret: c.req.header("x-registration-secret") || (typeof body.registrationSecret === "string" ? body.registrationSecret : undefined),
      platform: typeof body.platform === "string" ? body.platform : undefined,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
      deviceInfo: body.deviceInfo && typeof body.deviceInfo === "object" ? body.deviceInfo as Record<string, unknown> : undefined
    }, clientIp(c));

    mobileLog("device_token_registered", {
      deviceId: result.deviceCode,
      status: result.status,
      clientIp: clientIp(c)
    });
    return c.json(result);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    mobileLog("device_token_register_failed", {
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      reason: message,
      clientIp: clientIp(c)
    });
    if (message === "DEVICE_TOKEN_CONFLICT") {
      return c.json({ error: { code: "DEVICE_TOKEN_CONFLICT", message: "Device token does not match bound token", details: {} } }, 409);
    }
    if (message === "DEVICE_CODE_MISMATCH") {
      return c.json({ error: { code: "DEVICE_CODE_MISMATCH", message: "Device token is already bound to another device code", details: {} } }, 409);
    }
    if (message === "DEVICE_CODE_CONFLICT") {
      return c.json({ error: { code: "DEVICE_CODE_CONFLICT", message: "Device code is already bound to another phone", details: {} } }, 409);
    }
    if (message === "DEVICE_ID_NOT_UNIQUE") {
      return c.json({ error: { code: "DEVICE_ID_NOT_UNIQUE", message: "Device ID must be unique. Upgrade the mobile agent.", details: {} } }, 409);
    }
    if (message === "REGISTRATION_SECRET_INVALID") {
      return c.json({ error: { code: "REGISTRATION_SECRET_INVALID", message: "Mobile registration secret is invalid", details: {} } }, 403);
    }
    if (message === "DEVICE_DISABLED") {
      return c.json({ error: { code: "DEVICE_DISABLED", message: "Device is disabled", details: {} } }, 403);
    }
    return c.json({ error: { code: "INVALID_DEVICE_TOKEN", message: "Invalid device token registration payload", details: {} } }, 400);
  }
});

mobileRoutes.get("/tasks/current", async (c) => {
  const deviceId = c.req.query("deviceId");
  const platform = c.req.query("platform") ?? "douyin";
  if (!deviceId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "deviceId is required", details: {} } }, 400);
  }
  const task = await getCurrentTask(deviceId, platform, clientIp(c), deviceToken(c));
  mobileLog("current_task_fetched", {
    deviceId,
    platform,
    taskId: task.taskId,
    autoStart: task.autoStart,
    configSource: task.configSource,
    clientIp: clientIp(c)
  });
  return c.json(task);
});

mobileRoutes.post("/collection-records", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileCollectionRecordSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/collection-records", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const record = await saveCollectionRecord(parsed.data, clientIp(c), deviceToken(c));
  mobileLog("collection_record_saved", {
    deviceId: parsed.data.deviceId,
    taskId: parsed.data.taskId,
    platform: parsed.data.platform,
    sceneType: parsed.data.sceneType,
    recordId: record.id,
    createdAt: record.createdAt,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(record.id, record.createdAt));
});

mobileRoutes.post("/heartbeats", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileHeartbeatSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/heartbeats", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const heartbeat = await saveHeartbeat(parsed.data, clientIp(c), deviceToken(c));
  mobileLog("heartbeat_saved", {
    deviceId: parsed.data.deviceId,
    taskId: parsed.data.taskId,
    status: parsed.data.status,
    sceneType: parsed.data.sceneType ?? "none",
    lastMessage: parsed.data.lastMessage,
    reportedAt: parsed.data.reportedAt,
    heartbeatId: heartbeat.id,
    createdAt: heartbeat.createdAt,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(heartbeat.id, heartbeat.createdAt));
});

mobileRoutes.post("/runtime-logs", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileRuntimeLogSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/runtime-logs", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const log = await saveRuntimeLog(parsed.data, clientIp(c), deviceToken(c));
  return c.json(savedResponse(log.id, log.createdAt));
});

mobileRoutes.post("/live-comment-actions", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileLiveCommentActionSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/live-comment-actions", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const action = await saveLiveCommentAction(parsed.data, clientIp(c), deviceToken(c));
  mobileLog("live_comment_action_saved", {
    deviceId: parsed.data.deviceId,
    taskId: parsed.data.taskId,
    status: parsed.data.status,
    actionId: action.id,
    createdAt: action.createdAt,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(action.id, action.createdAt));
});

mobileRoutes.post("/log-files", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileLogFileSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/log-files", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const file = await saveLogFile(parsed.data, clientIp(c), deviceToken(c));
  mobileLog("log_file_saved", {
    deviceId: parsed.data.deviceId,
    taskId: parsed.data.taskId,
    logDate: parsed.data.logDate,
    fileName: parsed.data.fileName,
    fileSizeBytes: parsed.data.fileSizeBytes ?? parsed.data.content.length,
    fileId: file.id,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(file.id, file.createdAt));
});

mobileRoutes.get("/commands", async (c) => {
  const deviceId = c.req.query("deviceId");
  if (!deviceId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "deviceId is required", details: {} } }, 400);
  }
  const commands = await pollCommands(deviceId, deviceToken(c));
  mobileLog("commands_polled", {
    deviceId,
    commandCount: commands.length,
    clientIp: clientIp(c)
  });
  return c.json({ data: commands });
});

mobileRoutes.post("/commands/:id/ack", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileCommandAckSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError(`/commands/${c.req.param("id")}/ack`, body, parsed.error);
    return validationError(c, parsed.error);
  }
  let command: Awaited<ReturnType<typeof acknowledgeCommand>>;
  try {
    command = await acknowledgeCommand(c.req.param("id"), parsed.data, deviceToken(c));
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message === "COMMAND_NOT_FOUND") {
      return c.json({ error: { code: "COMMAND_NOT_FOUND", message: "Command does not belong to this device or no longer exists", details: {} } }, 404);
    }
    throw error;
  }
  mobileLog("command_acknowledged", {
    commandId: command.id,
    deviceId: parsed.data.deviceId,
    status: parsed.data.status,
    updatedAt: command.updatedAt,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(command.id, command.updatedAt));
});

mobileRoutes.get("/agent-version", async (c) => {
  const deviceId = c.req.query("deviceId");
  const currentVersion = c.req.query("currentVersion");
  const channel = c.req.query("channel") ?? "stable";
  if (!deviceId || !currentVersion) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "deviceId and currentVersion are required", details: {} } }, 400);
  }
  const result = await getAgentVersionCheck(deviceId, currentVersion, channel, deviceToken(c));
  mobileLog("agent_version_checked", {
    deviceId,
    currentVersion,
    channel,
    updateAvailable: result.updateAvailable,
    forceUpdate: result.forceUpdate,
    clientIp: clientIp(c)
  });
  return c.json(result);
});

mobileRoutes.post("/agent-update-events", async (c) => {
  const body = mobileBody(c);
  const parsed = mobileAgentUpdateEventSchema.safeParse(body);
  if (!parsed.success) {
    logValidationError("/agent-update-events", body, parsed.error);
    return validationError(c, parsed.error);
  }
  const event = await saveAgentUpdateEvent(parsed.data, deviceToken(c));
  mobileLog("agent_update_event_saved", {
    deviceId: parsed.data.deviceId,
    eventType: parsed.data.eventType,
    eventId: event.id,
    createdAt: event.createdAt,
    clientIp: clientIp(c)
  });
  return c.json(savedResponse(event.id, event.createdAt));
});
