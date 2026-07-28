import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(currentDir, "admin.service.ts"), "utf8");

function getOverviewSource() {
  const start = source.indexOf("export async function getOverview()");
  const end = source.indexOf("export async function getDevices()", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("overview function status data", () => {
  test("工作台 overview 聚合运行日志和完整日志同步状态", () => {
    const block = getOverviewSource();

    expect(block).toContain("getLogDeviceSummaries(todayStart)");
    expect(block).toContain("getLogFileDeviceSummaries(todayStart)");
    expect(block).toContain("latestLogAt");
    expect(block).toContain("latestFileUploadedAt");
    expect(block).toContain("todayErrorCount");
  });
});
