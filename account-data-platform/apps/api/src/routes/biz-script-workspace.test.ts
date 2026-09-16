import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { AdminVariables } from "../middleware/admin-auth";
import type { createBizScriptWorkspaceService } from "../services/biz-script-workspace.service";
import * as routes from "./biz-script-workspace";

function setup(auth = true) {
  const calls: unknown[] = [];
  const service = {
    workspace: async () => ({ ready: false, baseline: null, reason: "not ready" }),
    list: async () => [], devices: async () => [],
    preview: async (input: unknown, actor: string) => { calls.push({ input, actor }); return { stage: "DRAFT" }; },
    test: async (...args: unknown[]) => { calls.push(args); return { stage: "TESTING" }; },
    promote: async () => ({}), revoke: async () => ({}), download: async () => null
  } as unknown as ReturnType<typeof createBizScriptWorkspaceService>;
  const app = new Hono<{ Variables: AdminVariables }>();
  if (auth) app.use("*", async (c, next) => { c.set("admin", { username: "operator" } as AdminVariables["admin"]); await next(); });
  app.route("/", routes.createBizScriptWorkspaceRoutes(service));
  return { app, calls };
}
const post = (body: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body });

test("workspace routes factory exists", () => expect(typeof routes.createBizScriptWorkspaceRoutes).toBe("function"));
test("preview route requires admin and passes the authenticated operator", async () => {
  expect((await setup(false).app.request("/previews", post("{}"))).status).toBe(401);
  const f = setup();
  expect((await f.app.request("/previews", post('{"files":[]}'))).status).toBe(201);
  expect(f.calls).toEqual([{ input: { files: [] }, actor: "operator" }]);
});
test("malformed JSON and invalid scope do not reach publication", async () => {
  const f = setup();
  expect((await f.app.request("/previews", post("{"))).status).toBe(400);
  expect((await f.app.request("/previews/invalid/test", post('{"deviceIds":[]}'))).status).toBe(400);
  expect(f.calls).toHaveLength(0);
});
test("bounded request reader rejects bodies over the limit even without content-length", async () => {
  const f = setup();
  const response = await f.app.request("/previews", post(" ".repeat(16 * 1024 * 1024 + 1)));
  expect(response.status).toBe(413);
  expect(f.calls).toHaveLength(0);
});
test("readiness failure is visible and legacy build is disabled without source access", async () => {
  const f = setup();
  expect((await (await f.app.request("/workspace")).json()).ready).toBe(false);
  const response = await f.app.request("/releases/build", post("{}"));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("SOURCE_PREVIEW_REQUIRED");
  expect(f.calls).toHaveLength(0);
});
