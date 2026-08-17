import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseConnectivityLabel } from "../src/features/remote-wake/BaseConnectivityStatus";

test("maps the backend-owned base connectivity states to the device-access labels", () => {
  expect(baseConnectivityLabel({
    status: "ONLINE",
    elapsedSeconds: 2,
    offlineThresholdSeconds: 60
  })).toBe("在线");
  expect(baseConnectivityLabel({
    status: "RECONNECTING",
    elapsedSeconds: 18,
    offlineThresholdSeconds: 60
  })).toBe("正在重新连接 18 / 60 秒");
  expect(baseConnectivityLabel({
    status: "OFFLINE",
    elapsedSeconds: 60,
    offlineThresholdSeconds: 60
  })).toBe("离线等待接入");
});

test("renders the settings button, threshold slider, progress, and automatic save", () => {
  const component = readFileSync(
    path.join(import.meta.dir, "../src/features/remote-wake/BaseConnectivityStatus.tsx"),
    "utf8"
  );
  expect(component).toContain("SettingOutlined");
  expect(component).toContain("<Popover");
  expect(component).toContain("<Slider");
  expect(component).toContain("min={15}");
  expect(component).toContain("max={150}");
  expect(component).toContain("15: \"15\"");
  expect(component).toContain("150: \"150\"");
  expect(component).toContain("onAfterChange");
  expect(component).toContain("updateBaseConnectivityThreshold");
  expect(component).toContain("<Progress");
});

test("places the new component in the existing device-access cell only", () => {
  const page = readFileSync(
    path.join(import.meta.dir, "../src/features/remote-wake/RemoteWakePage.tsx"),
    "utf8"
  );
  const action = readFileSync(
    path.join(import.meta.dir, "../src/features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  expect(page).toContain("<BaseConnectivityStatus");
  expect(page).toContain("<RemoteWakeDeviceAction");
  expect(action).toContain("onClick={handleClick}");
  expect(action).not.toContain("updateBaseConnectivityThreshold");
});
