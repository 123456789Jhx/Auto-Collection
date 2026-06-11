import { z } from "zod";

export const createTaskSchema = z
  .object({
    taskCode: z.string().min(1),
    name: z.string().min(1),
    platform: z.string().default("douyin"),
    mode: z.enum(["search", "feed"]).default("search"),
    searchKeywords: z.array(z.string().min(1)).min(1),
    matchKeywords: z.array(z.string().min(1)).min(1),
    videoMinutesMin: z.number().int().min(120).default(120),
    videoMinutesMax: z.number().int().min(120).default(180),
    liveMinutesMin: z.number().int().min(60).default(60),
    liveMinutesMax: z.number().int().min(60).default(120),
    autoStart: z.boolean().default(false),
    collectComments: z.boolean().default(true),
    commentLimit: z.number().int().min(0).max(50).default(10),
    heartbeatMinutes: z.number().int().min(1).default(1)
  })
  .refine((data) => data.videoMinutesMax >= data.videoMinutesMin, {
    message: "videoMinutesMax must be greater than or equal to videoMinutesMin",
    path: ["videoMinutesMax"]
  })
  .refine((data) => data.liveMinutesMax >= data.liveMinutesMin, {
    message: "liveMinutesMax must be greater than or equal to liveMinutesMin",
    path: ["liveMinutesMax"]
  });

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    videoMinutesMin: z.number().int().min(120).optional(),
    videoMinutesMax: z.number().int().min(120).optional(),
    liveMinutesMin: z.number().int().min(60).optional(),
    liveMinutesMax: z.number().int().min(60).optional(),
    autoStart: z.boolean().optional(),
    collectComments: z.boolean().optional(),
    commentLimit: z.number().int().min(0).max(50).optional(),
    heartbeatMinutes: z.number().int().min(1).max(60).optional()
  })
  .refine((data) => data.videoMinutesMin === undefined || data.videoMinutesMax === undefined || data.videoMinutesMax >= data.videoMinutesMin, {
    message: "videoMinutesMax must be greater than or equal to videoMinutesMin",
    path: ["videoMinutesMax"]
  })
  .refine((data) => data.liveMinutesMin === undefined || data.liveMinutesMax === undefined || data.liveMinutesMax >= data.liveMinutesMin, {
    message: "liveMinutesMax must be greater than or equal to liveMinutesMin",
    path: ["liveMinutesMax"]
  });

export type UpdateTaskPayload = z.infer<typeof updateTaskSchema>;

export const updateDeviceTaskConfigSchema = updateTaskSchema;

export type UpdateDeviceTaskConfigPayload = z.infer<typeof updateDeviceTaskConfigSchema>;

export const updateDeviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  remark: z.string().trim().max(500).optional(),
  lastRegion: z.string().trim().max(100).optional()
});

export type UpdateDevicePayload = z.infer<typeof updateDeviceSchema>;

export const createMobileCommandSchema = z.object({
  deviceId: z.string().min(1),
  taskId: z.string().optional(),
  commandType: z.enum(["START", "PAUSE", "RESUME", "STOP", "REFRESH_CONFIG", "STATUS", "RESTART_APP", "RESTART_AGENT", "CHECK_UPDATE", "UPDATE_AGENT", "UPLOAD_LOG"]),
  payload: z.record(z.unknown()).optional(),
  expiresInSeconds: z.number().int().min(60).max(86400).default(3600)
});

export type CreateMobileCommandPayload = z.infer<typeof createMobileCommandSchema>;

export const createAgentVersionSchema = z.object({
  version: z.string().min(1),
  channel: z.enum(["stable", "gray", "dev"]).default("stable"),
  minSupportedVersion: z.string().optional(),
  packageUrl: z.string().optional(),
  sha256: z.string().optional(),
  entryFile: z.string().default("main.js"),
  releaseNote: z.string().optional(),
  forceUpdate: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED", "REVOKED"]).default("PUBLISHED")
});

export type CreateAgentVersionPayload = z.infer<typeof createAgentVersionSchema>;
