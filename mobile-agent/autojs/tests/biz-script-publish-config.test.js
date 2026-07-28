const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("业务脚本清单 URL 默认从 PUBLIC_BASE_URL 生成", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../../scripts/bundle-autojs.ps1"), "utf8");
  assert(source.includes("$env:PUBLIC_BASE_URL"));
  assert(source.includes('"/downloads/agent"'));
  assert(!source.includes('[string]$PackageBaseUrl = "http://localhost:3012/downloads/agent"'));
});

test("业务脚本 updater 不硬编码 localhost 下载地址", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/biz-script-updater.js"), "utf8");
  assert(source.includes("latest.packageUrl"));
  assert(!source.includes("localhost:3015"));
});
test("业务脚本发布脚本读取 API 实际托管目录", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../../scripts/publish-autojs-version.ps1"), "utf8");
  assert(source.includes("account-data-platform\\apps\\api\\dist\\agent"));
  assert(!source.includes("account-data-platform\\dist\\agent"));
});