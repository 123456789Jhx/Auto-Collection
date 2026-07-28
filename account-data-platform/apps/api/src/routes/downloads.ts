import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Hono } from "hono";
import { config } from "../config";

const allowedExtensions = new Set([".zip", ".json", ".sha256"]);

export const downloadRoutes = new Hono();

downloadRoutes.get("/agent/:fileName", async (c) => {
  const fileName = basename(c.req.param("fileName"));
  const extension = extname(fileName).toLowerCase();
  if (!fileName || !allowedExtensions.has(extension)) {
    return c.json({ error: { code: "DOWNLOAD_NOT_FOUND", message: "文件不存在", details: {} } }, 404);
  }

  const filePath = resolve(process.cwd(), config.agentDownloadDir, fileName);
  const rootPath = resolve(process.cwd(), config.agentDownloadDir);
  if (!filePath.startsWith(rootPath) || !existsSync(filePath)) {
    return c.json({ error: { code: "DOWNLOAD_NOT_FOUND", message: "文件不存在", details: {} } }, 404);
  }

  const bytes = await readFile(filePath);
  const contentType = extension === ".zip" ? "application/zip" : "text/plain; charset=utf-8";
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`
    }
  });
});
