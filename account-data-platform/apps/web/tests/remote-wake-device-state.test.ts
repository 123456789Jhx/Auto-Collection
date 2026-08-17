import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(import.meta.dir, "../src/features/remote-wake/RemoteWakePage.tsx"),
  "utf8"
);

test("shows the App UI state reported by the outer base", () => {
  expect(source).toContain("function appUiStatusText");
  expect(source).toContain("App界面");
  expect(source).toContain("device.appUiState");
  expect(source).toContain('foreground: "前台"');
  expect(source).toContain('background: "后台"');
  expect(source).toContain('not_running: "未运行"');
});

test("forces App UI display to unknown when the outer parent is unavailable", () => {
  expect(source).toContain('if (!device.baseReachable || device.baseStatus !== "online") return "未知"');
});
