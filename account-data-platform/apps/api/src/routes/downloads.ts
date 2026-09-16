import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Hono } from "hono";
import { config } from "../config";
import { createBizScriptDownloadRoutes } from "./biz-script-workspace";
import { bizScriptWorkspaceService } from "../services/biz-script-workspace.production";

const allowedExtensions = new Set([".zip", ".json", ".sha256", ".mp4", ".jpg", ".apk"]);

function contentTypeFor(extension: string) {
  if (extension === ".zip") return "application/zip";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".jpg") return "image/jpeg";
  if (extension === ".apk") return "application/vnd.android.package-archive";
  return "text/plain; charset=utf-8";
}

export const downloadRoutes = new Hono();
downloadRoutes.route("/biz-scripts", createBizScriptDownloadRoutes(bizScriptWorkspaceService));

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
  return new Response(bytes, {
    headers: {
      "Content-Type": contentTypeFor(extension),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`
    }
  });
});
