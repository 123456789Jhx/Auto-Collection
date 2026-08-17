import { describe, expect, test } from "bun:test";

describe("interface publish production wiring", () => {
  test("mounts all admin routes after the shared admin authentication middleware", async () => {
    const source = await Bun.file(new URL("../routes/admin.ts", import.meta.url)).text();
    const authIndex = source.indexOf('adminRoutes.use("*", adminAuth)');

    expect(source).toContain('from "./publish-interface-bindings"');
    expect(source).toContain('from "./publish-interface-runs"');
    expect(source).toContain('from "./publish-interface-monitor"');
    expect(source.indexOf('adminRoutes.route("/interface-publish/bindings"')).toBeGreaterThan(authIndex);
    expect(source.indexOf('adminRoutes.route("/interface-publish/runs"')).toBeGreaterThan(authIndex);
    expect(source.indexOf('adminRoutes.route("/interface-publish/monitor"')).toBeGreaterThan(authIndex);
  });

  test("starts one interface worker beside the independent outbox worker", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();

    expect(source).toContain('from "./services/publish-interface-worker"');
    expect(source.match(/startPublishInterfaceWorker\(\)/g)).toHaveLength(1);
    expect(source.match(/startPublishStatusOutboxWorker\(\)/g)).toHaveLength(1);
  });
});
