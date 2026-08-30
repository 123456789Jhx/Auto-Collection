import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const commandRepositoryPath = fileURLToPath(new URL("../repositories/command.repository.ts", import.meta.url));
const mobileServicePath = fileURLToPath(new URL("./mobile.service.ts", import.meta.url));
const mobileRoutePath = fileURLToPath(new URL("../routes/mobile.ts", import.meta.url));

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

test("business task stopped status does not trigger Agent disconnect reconciliation", () => {
  const source = readFileSync(mobileServicePath, "utf8");

  expect(source).not.toContain('payload.status === "stopped"');
  expect(source).toContain('payload.agentLifecycleState === "STOPPED" || payload.pollingEnabled === false');
});

test("mobile stop can cancel active Agent commands before disconnecting", () => {
  const routeSource = readFileSync(mobileRoutePath, "utf8");
  const serviceSource = readFileSync(mobileServicePath, "utf8");

  expect(routeSource).toContain('mobileRoutes.post("/commands/cancel-active"');
  expect(routeSource).toContain("cancelActiveAgentCommands");
  expect(serviceSource).toContain("export async function cancelActiveAgentCommands");
  expect(serviceSource).toContain("reconcileAgentDisconnect");
  expect(serviceSource).toContain('commandType: "EXIT_AGENT_APP"');
  expect(serviceSource).toContain("agent-disconnect-cleanup:");
});

test("mobile manual stop has a task-scoped receipt path separate from disconnect reconciliation", () => {
  const repositorySource = readFileSync(commandRepositoryPath, "utf8");
  const serviceSource = readFileSync(mobileServicePath, "utf8");
  const routeSource = readFileSync(mobileRoutePath, "utf8");

  expect(repositorySource).toContain("acknowledgeManualAgentStop");
  expect(serviceSource).toContain("acknowledgeManualAgentStop");
  expect(routeSource).toContain("commandId");
  expect(routeSource).toContain("batchId");
});

test("command claim checks the persisted Agent lifecycle before selecting work", () => {
  const source = readFileSync(commandRepositoryPath, "utf8");

  expect(source).toContain("agent_lifecycle_state");
  expect(source).toContain("polling_enabled");
  expect(source).toContain("device.agent_lifecycle_state = 'RUNNING'");
  expect(source).toContain("device.polling_enabled = true");
});
