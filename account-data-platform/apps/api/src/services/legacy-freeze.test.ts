import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { guardLegacyMobileCommand, guardLegacyTaskAssignment } from "./legacy-freeze";

function createGuardApp(frozen: boolean) {
  const app = new Hono();
  app.post("/admin/mobile-commands", async (c) => {
    const body = await c.req.json<{ commandType?: string }>();
    return guardLegacyMobileCommand(c, body.commandType, frozen) ?? c.json({ accepted: true }, 201);
  });
  app.post("/admin/task-assignments", (c) => (
    guardLegacyTaskAssignment(c, frozen) ?? c.json({ accepted: true }, 201)
  ));
  app.post("/admin/task-assignments/:id/commands", (c) => (
    guardLegacyTaskAssignment(c, frozen) ?? c.json({ accepted: true }, 201)
  ));
  app.get("/admin/publish-tasks", (c) => c.json({ data: [] }));
  return app;
}

describe("legacy business freeze guard", () => {
  test("returns the standard 409 error for a frozen collection command", async () => {
    const response = await createGuardApp(true).request("/admin/mobile-commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandType: "START" })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "LEGACY_BUSINESS_FROZEN",
        message: "旧采集业务已冻结",
        details: {}
      }
    });
  });

  test("allows collection commands when the switch is disabled", async () => {
    const response = await createGuardApp(false).request("/admin/mobile-commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandType: "START" })
    });

    expect(response.status).toBe(201);
  });

  test("blocks task assignments but leaves maintenance and publish routes available", async () => {
    const app = createGuardApp(true);
    const assignment = await app.request("/admin/task-assignments", { method: "POST" });
    const assignmentCommand = await app.request("/admin/task-assignments/test-id/commands", { method: "POST" });
    const maintenance = await app.request("/admin/mobile-commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandType: "REFRESH_CONFIG" })
    });
    const publish = await app.request("/admin/publish-tasks");

    expect(assignment.status).toBe(409);
    expect(assignmentCommand.status).toBe(409);
    expect(maintenance.status).toBe(201);
    expect(publish.status).toBe(200);
  });
});
