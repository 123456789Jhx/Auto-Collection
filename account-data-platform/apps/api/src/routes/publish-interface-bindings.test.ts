import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AdminVariables } from "../middleware/admin-auth";
import {
  createPublishInterfaceBindingRoutes,
  type PublishInterfaceBindingApiService
} from "./publish-interface-bindings";

function appFor(service: PublishInterfaceBindingApiService) {
  const app = new Hono<{ Variables: AdminVariables }>();
  app.use("*", async (context, next) => {
    context.set("admin", {
      username: "admin",
      role: "admin",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await next();
  });
  app.route("/admin/interface-publish/bindings", createPublishInterfaceBindingRoutes(service));
  return app;
}

describe("interface publish binding routes", () => {
  test("rejects a client-selected WeChat Channels platform", async () => {
    let saveCalls = 0;
    const app = appFor({
      list: async () => [],
      preflight: async () => [],
      save: async () => { saveCalls += 1; return {}; },
      remove: async () => ({ deleted: true })
    });
    const response = await app.request("/admin/interface-publish/bindings/device-01", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountName: "账号 A",
        accountNo: "123",
        enabled: true,
        platform: "WECHAT_CHANNELS"
      })
    });
    expect(response.status).toBe(400);
    expect(saveCalls).toBe(0);
  });

  test("deletes only the Douyin interface binding selected by device code", async () => {
    let removedDeviceCode = "";
    const app = appFor({
      list: async () => [],
      preflight: async () => [],
      save: async () => ({}),
      remove: async (deviceCode) => {
        removedDeviceCode = deviceCode;
        return { deleted: true };
      }
    });
    const response = await app.request("/admin/interface-publish/bindings/device-01", {
      method: "DELETE"
    });
    expect(response.status).toBe(200);
    expect(removedDeviceCode).toBe("device-01");
  });
});
