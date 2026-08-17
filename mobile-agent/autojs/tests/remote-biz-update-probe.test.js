const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("远程业务脚本发布入口包含唯一验收标记", () => {
  const sourcePath = path.join(__dirname, "../features/publish-video/publish-video-entry.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const marker = "REMOTE_BIZ_UPDATE_PROBE_V1";
  const occurrences = source.split(marker).length - 1;
  const handler = source.indexOf("function handle(command)");
  const markerPosition = source.indexOf(marker, handler);
  const executorStart = source.indexOf('logger.info("发布执行器启动"', handler);

  assert.equal(occurrences, 1, "probe marker must appear exactly once");
  assert(markerPosition > handler, "probe marker must be emitted by the publish handler");
  assert(markerPosition < executorStart, "probe marker must be emitted before normal publish execution");
  assert(source.split(/\r?\n/).length <= 400, "remote publish entry must stay within 400 lines");
});
