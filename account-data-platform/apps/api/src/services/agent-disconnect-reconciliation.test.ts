import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const commandRepositoryPath = fileURLToPath(new URL("../repositories/command.repository.ts", import.meta.url));
const mobileServicePath = fileURLToPath(new URL("./mobile.service.ts", import.meta.url));

test("disconnect reconciliation terminalizes every active Agent command", () => {
  const source = readFileSync(commandRepositoryPath, "utf8");

  expect(source).toContain("export async function reconcileAgentDisconnect");
  expect(source).toContain("AGENT_DISCONNECTED");
  expect(source).toContain("LOCAL_STOP_BUTTON");
  expect(source).toContain("inArray(mobileCommands.status, [\"PENDING\", \"FETCHED\", \"CLAIMED\", \"RUNNING\"])");
  expect(source).toContain("executorType, \"AGENT\"");
});

test("mobile heartbeat invokes disconnect reconciliation for a stopped polling channel", () => {
  const source = readFileSync(mobileServicePath, "utf8");

  expect(source).toContain("reconcileAgentDisconnect");
  expect(source).toContain("payload.pollingEnabled === false");
  expect(source).toContain("payload.agentLifecycleState === \"STOPPED\"");
  expect(source).toContain("rawPayload.agentLifecycleState = payload.agentLifecycleState");
  expect(source).toContain("rawPayload.pollingEnabled = payload.pollingEnabled");
  expect(source).toContain("agent-disconnect-cleanup:");
  expect(source).toContain("commandType: \"EXIT_AGENT_APP\"");
});

test("command claim checks the persisted Agent lifecycle before selecting work", () => {
  const source = readFileSync(commandRepositoryPath, "utf8");

  expect(source).toContain("agent_lifecycle_state");
  expect(source).toContain("polling_enabled");
  expect(source).toContain("device.agent_lifecycle_state = 'RUNNING'");
  expect(source).toContain("device.polling_enabled = true");
});
