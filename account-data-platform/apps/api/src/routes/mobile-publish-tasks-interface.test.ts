import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createMobilePublishTaskRoutes,
  type MobilePublishTaskResultReporter
} from "./mobile-publish-tasks";

function appFor(reporter: MobilePublishTaskResultReporter) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set("mobileBody" as never, await context.req.json() as never);
    await next();
  });
  app.route("/mobile/publish-tasks", createMobilePublishTaskRoutes(reporter, false));
  return app;
}

describe("mobile interface publish result route", () => {
  test("accepts the interface result states and delegates once", async () => {
    const calls: unknown[] = [];
    const app = appFor(async (...args) => {
      calls.push(args);
      return { localResultStatus: "PUBLISHED" };
    });
    const response = await app.request("/mobile/publish-tasks/task-1/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-01",
        deviceToken: "test-token",
        status: "PUBLISHED"
      })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ localResultStatus: "PUBLISHED" });
    expect(calls).toHaveLength(1);
  });

  test("maps immutable snapshot device mismatch to 403", async () => {
    const app = appFor(async () => {
      throw new Error("PUBLISH_TASK_DEVICE_MISMATCH");
    });
    const response = await app.request("/mobile/publish-tasks/task-1/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "other-device",
        deviceToken: "test-token",
        status: "RESULT_UNKNOWN"
      })
    });
    expect(response.status).toBe(403);
  });
});
