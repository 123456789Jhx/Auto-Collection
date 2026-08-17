import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AdminVariables } from "../middleware/admin-auth";
import { PublishInterfaceRunServiceError } from "../services/publish-interface-run.service";
import {
  createPublishInterfaceRunRoutes,
  type PublishInterfaceRunApiService
} from "./publish-interface-runs";

const runId = "11111111-1111-4111-8111-111111111111";
const config = {
  configId: "22222222-2222-4222-8222-222222222222",
  morningPublishTime: "09:00",
  afternoonPublishTime: "15:00",
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai",
  platform: "DOUYIN"
} as const;

function appFor(service: PublishInterfaceRunApiService) {
  const app = new Hono<{ Variables: AdminVariables }>();
  app.use("*", async (context, next) => {
    context.set("admin", {
      username: "admin",
      role: "admin",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await next();
  });
  app.route("/admin/interface-publish/runs", createPublishInterfaceRunRoutes(service));
  return app;
}

function post(app: ReturnType<typeof appFor>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function baseService(overrides: Partial<PublishInterfaceRunApiService> = {}): PublishInterfaceRunApiService {
  const run = { id: runId, status: "WAITING_USER_CONFIRMATION" as const, ...config };
  return {
    create: async () => ({
      run,
      preflight: [{
        bindingId: "33333333-3333-4333-8333-333333333333",
        deviceCode: "device-01",
        accountName: "开心幸福一家人",
        accountNo: "41218954470",
        status: "MATCHED"
      }],
      startTime: { valid: true, businessDate: "2026-08-06", morning: "WAITING", afternoon: "WAITING" }
    }),
    confirm: async () => ({ run: { ...run, status: "SCHEDULED" }, bindings: [] }),
    requestStop: async () => ({ ...run, status: "STOPPING" }),
    getStopRisk: async () => ({ businessDate: "2026-08-06", incompleteAccountCount: 0 }),
    getCurrent: async () => null,
    getById: async () => run,
    ...overrides
  } as PublishInterfaceRunApiService;
}

describe("interface publish run routes", () => {
  test("creates preflight and returns run id, config snapshot and binding statuses", async () => {
    let createCalls = 0;
    const app = appFor(baseService({
      create: async (...args) => {
        createCalls += 1;
        return baseService().create(...args);
      }
    }));
    const response = await post(app, "/admin/interface-publish/runs/preflight", config);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(createCalls).toBe(1);
    expect(body.data.run.id).toBe(runId);
    expect(body.data.run).toMatchObject(config);
    expect(body.data.preflight[0].status).toBe("MATCHED");
  });

  test("makes repeated confirm idempotent once the run is scheduled", async () => {
    let confirmCalls = 0;
    const scheduled = { id: runId, status: "SCHEDULED" as const, ...config };
    const service = baseService({
      confirm: async () => {
        confirmCalls += 1;
        if (confirmCalls > 1) {
          throw new PublishInterfaceRunServiceError("RUN_STATE_INVALID", "already scheduled");
        }
        return { run: scheduled, bindings: [] };
      },
      getById: async () => scheduled
    });
    const app = appFor(service);
    const first = await post(app, `/admin/interface-publish/runs/${runId}/confirm`, { skippedBindingIds: [] });
    const second = await post(app, `/admin/interface-publish/runs/${runId}/confirm`, { skippedBindingIds: [] });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).data.run.id).toBe(runId);
    expect((await second.json()).data.run).toEqual(scheduled);
  });

  test("requires fallback-risk confirmation and then enters stopping, not stopped", async () => {
    const app = appFor(baseService({
      getStopRisk: async () => ({ businessDate: "2026-08-06", incompleteAccountCount: 2 })
    }));
    const blocked = await post(app, `/admin/interface-publish/runs/${runId}/stop`, {
      confirmedDailyFallbackRisk: false
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: { code: "RUN_STOP_CONFIRMATION_REQUIRED", details: { incompleteAccountCount: 2 } }
    });

    const accepted = await post(app, `/admin/interface-publish/runs/${runId}/stop`, {
      confirmedDailyFallbackRisk: true
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.status).toBe("STOPPING");
  });

  test("returns null for no current run and a token-free snapshot when active", async () => {
    const emptyApp = appFor(baseService());
    expect(await (await emptyApp.request("/admin/interface-publish/runs/current")).json()).toEqual({ data: null });

    const active = { id: runId, status: "RUNNING" as const, ...config };
    const activeApp = appFor(baseService({ getCurrent: async () => active }));
    const response = await activeApp.request("/admin/interface-publish/runs/current");
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain(runId);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("externalToken");
  });
});
