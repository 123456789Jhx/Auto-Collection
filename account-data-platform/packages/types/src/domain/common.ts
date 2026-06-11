import { z } from "zod";

export const sceneTypeSchema = z.enum(["video", "live"]);
export const deviceStatusSchema = z.enum(["booting", "idle", "offline", "online", "running", "paused", "stopped", "updating", "error", "risk_control"]);
export const runtimeLogLevelSchema = z.enum(["INFO", "WARN", "ERROR"]);
export const taskStatusSchema = z.enum(["DRAFT", "ENABLED", "DISABLED"]);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  keyword: z.string().optional(),
  status: z.string().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional()
});

export type SceneType = z.infer<typeof sceneTypeSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type RuntimeLogLevel = z.infer<typeof runtimeLogLevelSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
