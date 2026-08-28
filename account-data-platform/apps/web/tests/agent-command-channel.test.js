import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentCommandChannelOpen } from "../src/lib/agent-command-channel.ts";

test("keeps the command channel open for a reachable Agent", () => {
  assert.equal(isAgentCommandChannelOpen({ agentReachable: true, desiredAgentState: "running" }), true);
});

test("closes the command channel when the phone Agent is stopped", () => {
  assert.equal(isAgentCommandChannelOpen({ agentReachable: true, desiredAgentState: "stopped" }), false);
  assert.equal(isAgentCommandChannelOpen({ agentReachable: false, desiredAgentState: "stopped" }), false);
});

test("closes the command channel after the Agent heartbeat is lost", () => {
  assert.equal(isAgentCommandChannelOpen({ agentReachable: false, desiredAgentState: "running" }), false);
});

test("closes the command channel when persisted lifecycle is stopped", () => {
  assert.equal(isAgentCommandChannelOpen({
    agentReachable: true,
    desiredAgentState: "running",
    agentLifecycleState: "STOPPED",
    pollingEnabled: false
  }), false);
});

test("opens the command channel only for a running polling lifecycle", () => {
  assert.equal(isAgentCommandChannelOpen({
    agentReachable: true,
    agentLifecycleState: "RUNNING",
    pollingEnabled: true
  }), true);
  assert.equal(isAgentCommandChannelOpen({
    agentReachable: true,
    agentLifecycleState: "UNREACHABLE",
    pollingEnabled: true
  }), false);
});
