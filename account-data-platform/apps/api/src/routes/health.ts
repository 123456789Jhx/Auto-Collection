import { Hono } from "hono";
import Redis from "ioredis";
import { config } from "../config";
import { db } from "../repositories/db";
import { collectionTasks } from "@pkg/db/schema";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

healthRoutes.get("/ready", async (c) => {
  const checks: Record<string, string> = {};
  try {
    await db.select().from(collectionTasks).limit(1);
    checks.postgres = "ok";
  } catch (error) {
    checks.postgres = error instanceof Error ? error.message : "failed";
  }

  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
    checks.redis = "ok";
  } catch (error) {
    checks.redis = error instanceof Error ? error.message : "failed";
  } finally {
    redis.disconnect();
  }

  const ready = Object.values(checks).every((value) => value === "ok");
  return c.json({ status: ready ? "ready" : "not_ready", checks }, ready ? 200 : 503);
});
