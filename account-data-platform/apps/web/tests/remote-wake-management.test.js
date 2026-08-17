import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const webRoot = path.join(import.meta.dir, "../src");
const repositoryRoot = path.join(import.meta.dir, "../../..");

test("connects the device action to the generic BASE command channel", () => {
  const page = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakePage.tsx"),
    "utf8"
  );
  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );

  expect(page).toContain("<RemoteWakeDeviceAction");
  expect(page).toContain("device={device}");
  expect(action).toContain("打开燎原星火");
  expect(action).toContain("createMobileCommand");
  expect(action).toContain("resolveRemoteWakeAction");
  expect(action).toContain("START_AGENT");
  expect(action).toContain("OPEN_AGENT_APP");
  expect(action).toContain("modal.confirm");
  expect(action).toContain("modal.info");
});

test("physically removes the dedicated remote wake interfaces", () => {
  const app = readFileSync(
    path.join(repositoryRoot, "apps/api/src/app.ts"),
    "utf8"
  );

  expect(app).not.toContain("remoteWakeRoutes");
  expect(app).not.toContain('app.route("/api/v1", remoteWakeRoutes)');
  expect(existsSync(path.join(webRoot, "features/remote-wake/api-client-remote-wake.ts"))).toBe(false);
  expect(existsSync(path.join(webRoot, "features/remote-wake/remote-wake-view-model.ts"))).toBe(false);
  expect(existsSync(path.join(repositoryRoot, "apps/api/src/features/remote-wake"))).toBe(false);
});
