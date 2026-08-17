import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("shows remote wake below logs and routes it to the remote wake page", () => {
  const source = readFileSync(path.join(import.meta.dir, "../src/routes/App.tsx"), "utf8");
  const logsMenu = source.indexOf('{ key: "logs"');
  const remoteWakeMenu = source.indexOf('{ key: "remoteWake"');

  expect(source).toContain('import { RemoteWakePage } from "../features/remote-wake/RemoteWakePage"');
  expect(source).toContain('remoteWake: { title: "远程唤醒" }');
  expect(source).toContain('if (page === "remoteWake") return <RemoteWakePage />');
  expect(source).toContain('window.location.pathname === "/remote-wake"');
  expect(logsMenu).toBeGreaterThanOrEqual(0);
  expect(remoteWakeMenu).toBeGreaterThan(logsMenu);
});

test("passes the current device state to the action control", () => {
  const source = readFileSync(
    path.join(import.meta.dir, "../src/features/remote-wake/RemoteWakePage.tsx"),
    "utf8"
  );

  expect(source).toContain("<RemoteWakeDeviceAction");
  expect(source).toContain("device={device}");
});
