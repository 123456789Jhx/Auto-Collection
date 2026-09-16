import { Hono } from "hono";
import { z } from "zod";
import { bizScriptUploadLimits } from "@pkg/types";
import type { AdminVariables } from "../middleware/admin-auth";
import type { createBizScriptWorkspaceService } from "../services/biz-script-workspace.service";
import { BizScriptWorkspaceError } from "../services/biz-script-artifact";

type Service = ReturnType<typeof createBizScriptWorkspaceService>;
const scopeSchema = z.object({ revision: z.number().int().nonnegative(),
  deviceIds: z.array(z.string().min(1).max(100)).min(1).max(500) }).strict();
const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const idSchema = z.string().uuid();

async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > bizScriptUploadLimits.maxRequestBytes) {
          await reader.cancel();
          throw new BizScriptWorkspaceError("SOURCE_TOO_LARGE", "上传请求超过大小限制", 413);
        }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw new BizScriptWorkspaceError("INVALID_JSON", "上传内容不是有效 JSON"); }
}

export function createBizScriptWorkspaceRoutes(service: Service) {
  const app = new Hono<{ Variables: AdminVariables }>();
  app.use("*", async (c, next) => {
    if (!c.get("admin")) return c.json({ error: { code: "ADMIN_AUTH_REQUIRED", message: "请先登录管理端" } }, 401);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof BizScriptWorkspaceError) return c.json({ error: { code: error.message, message: error.userMessage } }, error.status);
    return c.json({ error: { code: "WORKSPACE_UNAVAILABLE", message: "更新中心暂不可用，请核对服务与数据库迁移状态" } }, 503);
  });
  app.get("/workspace", async (c) => c.json(await service.workspace()));
  app.get("/workspace/devices", async (c) => c.json({ data: await service.devices() }));
  app.get("/previews", async (c) => c.json({ data: await service.list() }));
  app.post("/previews", async (c) => c.json(await service.preview(await boundedJson(c.req.raw), c.get("admin").username), 201));
  for (const action of ["test", "promote"] as const) {
    app.post(`/previews/:id/${action}`, async (c) => {
      const id = idSchema.safeParse(c.req.param("id"));
      const input = scopeSchema.safeParse(await boundedJson(c.req.raw));
      if (!id.success || !input.success) throw new BizScriptWorkspaceError("INVALID_SCOPE", "版本或设备范围不正确");
      return c.json(await service[action](id.data, input.data, c.get("admin").username));
    });
  }
  app.post("/previews/:id/revoke", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    const input = revisionSchema.safeParse(await boundedJson(c.req.raw));
    if (!id.success || !input.success) throw new BizScriptWorkspaceError("INVALID_SCOPE", "版本修订号不正确");
    return c.json(await service.revoke(id.data, input.data.revision, c.get("admin").username));
  });
  app.post("/releases/build", (c) => c.json({ error: { code: "SOURCE_PREVIEW_REQUIRED", message: "请选择本机脚本目录并创建预览" } }, 409));
  return app;
}

export function createBizScriptDownloadRoutes(service: Service) {
  const app = new Hono();
  app.get("/:id/:sha", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    const file = c.req.param("sha");
    if (!id.success || !/^[0-9a-f]{64}\.zip$/.test(file)) return c.notFound();
    const bytes = await service.download(id.data, file.slice(0, -4));
    if (!bytes) return c.notFound();
    return new Response(bytes, { headers: { "Content-Type": "application/zip", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="biz-scripts-${id.data}.zip"` } });
  });
  return app;
}
