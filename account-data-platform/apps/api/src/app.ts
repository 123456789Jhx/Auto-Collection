import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { adminRoutes } from "./routes/admin";
import { healthRoutes } from "./routes/health";
import { mobileRoutes } from "./routes/mobile";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.route("/", healthRoutes);
app.route("/api/v1/mobile", mobileRoutes);
app.route("/api/v1/admin", adminRoutes);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "接口不存在", details: {} } }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "服务异常", details: {} } }, 500);
});
