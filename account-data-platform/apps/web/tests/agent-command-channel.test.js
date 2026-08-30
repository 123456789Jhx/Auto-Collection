import assert from "node:assert/strict";
import { test } from "node:test";
import { agentDisconnectMessage, isAgentCommandChannelOpen, shouldNotifyAgentDisconnect } from "../src/lib/agent-command-channel.ts";

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

test("notifies only for a new explicit Agent stop event", () => {
  assert.equal(shouldNotifyAgentDisconnect({
    agentLifecycleState: "STOPPED",
    agentStateReason: "LOCAL_STOP_BUTTON",
    agentStateChangedAt: "2026-08-28T15:00:00.000Z",
    agentSessionId: "session-1"
  }), true);
  assert.equal(shouldNotifyAgentDisconnect({
    agentLifecycleState: "STOPPED",
    agentStateReason: "TASK_STOPPED",
    agentStateChangedAt: "2026-08-28T15:00:00.000Z"
  }), false);
  assert.equal(shouldNotifyAgentDisconnect({
    agentLifecycleState: "UNREACHABLE",
    agentStateReason: "LOCAL_STOP_BUTTON"
  }), false);
});

test("shows a dedicated message for a manual local Agent stop", () => {
  const message = agentDisconnectMessage({
    agentLifecycleState: "STOPPED",
    pollingEnabled: false,
    agentStateReason: "LOCAL_STOP_BUTTON"
  });
  assert.equal(message.title, "Agent 已手动停止");
  assert.match(message.description, /任务已停止/);
});
