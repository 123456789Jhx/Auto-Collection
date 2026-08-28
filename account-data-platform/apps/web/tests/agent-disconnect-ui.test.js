const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.join(__dirname, "..", "src");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("device status mapping exposes persisted Agent lifecycle fields", () => {
  const source = read("../../api/src/services/admin.service.ts");
  assert.match(source, /agentLifecycleState/);
  assert.match(source, /pollingEnabled/);
  assert.match(source, /agentStateReason/);
  assert.match(source, /agentSessionId/);
});

test("warmup pages lock both controls when the Agent channel is closed", () => {
  const video = read("routes/VideoWarmupPage.tsx");
  const account = read("routes/AccountWarmupPage.tsx");
  assert.match(video, /isAgentCommandChannelOpen/);
  assert.match(account, /isAgentCommandChannelOpen/);
  assert.match(video, /agentDisconnectMessage|Agent 已停止|Agent 已断联/);
  assert.match(account, /agentDisconnectMessage|Agent 已停止|Agent 已断联/);
});
