import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSingleInterfacePublishRoutes } from "./single-interface-publish";

describe("single interface publish routes", () => {
  test("exposes start, current and stop without accepting device or account input", async () => {
    const calls: string[] = [];
    const service = {
      start: async (actor: string) => { calls.push(`start:${actor}`); return { status: "RUNNING" as const }; },
      current: async () => { calls.push("current"); return { status: "RUNNING" as const }; },
      stop: async (actor: string) => { calls.push(`stop:${actor}`); return { status: "STOPPED" as const }; }
    };
    const app = new Hono<{ Variables: { admin: { username: string } } }>();
    app.use("*", async (c, next) => {
      c.set("admin", { username: "root" });
      await next();
    });
    app.route("/single-interface-publish", createSingleInterfacePublishRoutes(service));

    expect((await app.request("/single-interface-publish/start", { method: "POST" })).status).toBe(200);
    expect((await app.request("/single-interface-publish/current")).status).toBe(200);
    expect((await app.request("/single-interface-publish/stop", { method: "POST" })).status).toBe(200);
    expect(calls).toEqual(["start:root", "current", "stop:root"]);
  });
});
