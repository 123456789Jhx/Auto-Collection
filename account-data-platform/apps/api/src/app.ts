import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { adminRoutes } from "./routes/admin";
import { downloadRoutes } from "./routes/downloads";
import { healthRoutes } from "./routes/health";
import { mobileRoutes } from "./routes/mobile";
import { mobileRemoteScriptRoutes } from "./routes/mobile-remote-scripts";
import { mobilePublishTaskRoutes } from "./routes/mobile-publish-tasks";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.route("/", healthRoutes);
app.route("/downloads", downloadRoutes);
app.route("/api/v1/mobile/remote-scripts", mobileRemoteScriptRoutes);
app.route("/api/v1/mobile/publish-tasks", mobilePublishTaskRoutes);
app.route("/api/v1/mobile", mobileRoutes);
app.route("/api/v1/admin", adminRoutes);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "接口不存在", details: {} } }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "服务异常", details: {} } }, 500);
});
