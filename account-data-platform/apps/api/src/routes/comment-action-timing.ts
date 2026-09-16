import {
  copyCommentActionTimingSchema,
  updateCommentActionTimingSchema,
  updateDeviceTaskConfigSchema
} from "@pkg/types";
import { Hono, type Context } from "hono";
import { validationError } from "../lib/validation";
import { adminAuth, type AdminVariables } from "../middleware/admin-auth";
import { getDeviceTaskConfig, updateDeviceTaskConfig } from "../services/admin.service";
import {
  CommentActionTimingConflictError,
  CommentActionTimingNotFoundError,
  CommentActionTimingSourceDisabledError,
  CommentActionTimingSourceEmptyError,
  CommentActionTimingTaskNotFoundError,
  copyCommentActionTiming,
  getCommentActionTiming,
  getDeviceProfileSnapshot,
  updateCommentActionTiming,
  updateDeviceProfileWithCas
} from "../services/comment-action-timing.service";

type AdminContext = Context<{ Variables: AdminVariables }>;

function requestedDeviceCode(c: AdminContext) {
  return String(c.req.param("deviceCode"));
}

function errorResponse(c: AdminContext, error: unknown) {
  if (error instanceof CommentActionTimingNotFoundError) {
    return c.json({ error: { code: error.message, message: "设备不存在", details: { deviceCode: error.deviceCode } } }, 404);
  }
  if (error instanceof CommentActionTimingConflictError) {
    return c.json({ error: { code: error.message, message: "设备配置已被修改，请重新加载", details: { currentUpdatedAt: error.currentUpdatedAt } } }, 409);
  }
  if (error instanceof CommentActionTimingSourceEmptyError) {
    return c.json({ error: { code: error.message, message: "源设备尚未保存动作间隔配置", details: { deviceCode: error.deviceCode } } }, 409);
  }
  if (error instanceof CommentActionTimingSourceDisabledError) {
    return c.json({ error: { code: error.message, message: "源设备已关闭自定义动作间隔，不能复制", details: { deviceCode: error.deviceCode } } }, 409);
  }
  if (error instanceof CommentActionTimingTaskNotFoundError) {
    return c.json({ error: { code: error.message, message: "当前平台没有启用的任务", details: { platform: error.platform } } }, 409);
  }
  return null;
}

export const commentActionTimingRoutes = new Hono<{ Variables: AdminVariables }>();

commentActionTimingRoutes.get("/devices/:deviceCode/comment-action-timing", adminAuth, async (c) => {
  try {
    return c.json(await getCommentActionTiming(requestedDeviceCode(c), c.req.query("platform") ?? "douyin"));
  } catch (error) {
    const response = errorResponse(c, error);
    if (response) return response;
    throw error;
  }
});

commentActionTimingRoutes.patch("/devices/:deviceCode/comment-action-timing", adminAuth, async (c) => {
  const parsed = updateCommentActionTimingSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await updateCommentActionTiming(
      requestedDeviceCode(c),
      c.req.query("platform") ?? "douyin",
      parsed.data,
      c.get("admin").username
    ));
  } catch (error) {
    const response = errorResponse(c, error);
    if (response) return response;
    throw error;
  }
});

commentActionTimingRoutes.post("/device-profile-overrides/copy", adminAuth, async (c) => {
  const parsed = copyCommentActionTimingSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await copyCommentActionTiming(parsed.data, c.get("admin").username));
  } catch (error) {
    const response = errorResponse(c, error);
    if (response) return response;
    throw error;
  }
});

commentActionTimingRoutes.get("/devices/:deviceCode/task-config", adminAuth, async (c) => {
  const deviceCode = requestedDeviceCode(c);
  const platform = c.req.query("platform") ?? "douyin";
  const taskConfig = await getDeviceTaskConfig(deviceCode, platform);
  const profileSnapshot = await getDeviceProfileSnapshot(deviceCode, platform);
  return c.json({ ...taskConfig, ...profileSnapshot });
});

commentActionTimingRoutes.patch("/devices/:deviceCode/task-config", adminAuth, async (c) => {
  const parsed = updateDeviceTaskConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  if (parsed.data.deviceProfile === undefined) {
    const payload = { ...parsed.data };
    delete payload.expectedUpdatedAt;
    return c.json(await updateDeviceTaskConfig(
      requestedDeviceCode(c),
      payload,
      c.req.query("platform") ?? "douyin"
    ));
  }
  const extraKeys = Object.keys(parsed.data).filter((key) => !["deviceProfile", "expectedUpdatedAt"].includes(key));
  if (extraKeys.length > 0) {
    return c.json({
      error: { code: "DEVICE_PROFILE_UPDATE_MUST_BE_ISOLATED", message: "设备画像需要单独保存", details: { extraKeys } }
    }, 400);
  }
  try {
    const platform = c.req.query("platform") ?? "douyin";
    const saved = await updateDeviceProfileWithCas({
      deviceCode: requestedDeviceCode(c),
      platform,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt ?? null,
      deviceProfile: parsed.data.deviceProfile,
      actor: c.get("admin").username
    });
    return c.json({
      ...(await getDeviceTaskConfig(requestedDeviceCode(c), platform)),
      ...saved
    });
  } catch (error) {
    const response = errorResponse(c, error);
    if (response) return response;
    throw error;
  }
});
