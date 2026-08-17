import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  createPublishInterfaceMonitorRoutes,
  type PublishInterfaceMonitorApiService
} from "./publish-interface-monitor";

const runId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const slotId = "33333333-3333-4333-8333-333333333333";
const alertId = "44444444-4444-4444-8444-444444444444";

function appFor(service: PublishInterfaceMonitorApiService) {
  const app = new Hono<{ Variables: AdminVariables }>();
  app.use("*", async (context, next) => {
    context.set("admin", {
      username: "admin",
      role: "admin",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await next();
  });
  app.route("/monitor", createPublishInterfaceMonitorRoutes(service));
  return app;
}

function service(overrides: Partial<PublishInterfaceMonitorApiService> = {}): PublishInterfaceMonitorApiService {
  return {
    getRunDetails: async () => ({ run: { id: runId }, bindings: [], slots: [], alerts: [] }),
    markAlertRead: async () => ({ read: true }),
    resolveResultUnknown: async () => ({ localResultStatus: "PUBLISHED" }),
    resolveClaimResultUnknown: async () => ({ resolved: true }),
    ...overrides
  };
}

describe("interface publish monitor routes", () => {
  test("provides run details and local-only human resolution operations", async () => {
    const calls: string[] = [];
    const app = appFor(service({
      getRunDetails: async () => {
        calls.push("details");
        return { run: { id: runId }, bindings: [], slots: [], alerts: [] };
      },
      markAlertRead: async () => {
        calls.push("read");
        return { read: true };
      },
      resolveResultUnknown: async () => {
        calls.push("result");
        return { localResultStatus: "PUBLISHED" };
      },
      resolveClaimResultUnknown: async () => {
        calls.push("claim");
        return { resolved: true };
      }
    }));

    expect((await app.request(`/monitor/runs/${runId}`)).status).toBe(200);
    expect((await app.request(`/monitor/alerts/${alertId}/read`, { method: "POST" })).status).toBe(200);
    expect((await app.request(`/monitor/tasks/${taskId}/resolve-result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "PUBLISHED", evidence: "人工核对抖音主页已发布" })
    })).status).toBe(200);
    expect((await app.request(`/monitor/slots/${slotId}/resolve-claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "SAFE_TO_RETRY", evidence: "外部后台确认未领取" })
    })).status).toBe(200);
    expect(calls).toEqual(["details", "read", "result", "claim"]);
  });
});
