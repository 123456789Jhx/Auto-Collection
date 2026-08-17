import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands } from "@pkg/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { claimPendingCommandByDeviceId } from "../repositories/command.repository";
import { acknowledgeBaseCommand, createCommand } from "./command.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `exit-api-${suffix.slice(0, 12)}`;
const deviceToken = `${suffix}${suffix}`;
let deviceId = "";
let adminToken = "";

const exitStages = [
  { name: "STOP_AGENT", status: "SUCCESS" },
  { name: "REMOVE_APP_TASK", status: "SUCCESS" },
  { name: "LOCK_SCREEN", status: "SKIPPED", reason: "NOT_REQUESTED" }
] as const;

const partialExitStages = [
  { name: "STOP_AGENT", status: "SUCCESS" },
  { name: "REMOVE_APP_TASK", status: "SUCCESS" },
  { name: "LOCK_SCREEN", status: "FAILED", reason: "LOCK_FAILED" }
] as const;

function exitInput(lockScreen = false, idempotencyKey?: string) {
  return {
    deviceId: deviceCode,
    commandType: "EXIT_AGENT_APP" as const,
    payload: { lockScreen },
    ...(idempotencyKey ? { idempotencyKey } : {}),
    expiresInSeconds: 3600
  };
}

function mobileRequest(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: {
      "X-Device-Token": deviceToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function adminRequest(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function claimBaseCommand(commandType: "EXIT_AGENT_APP" | "OPEN_AGENT_APP" = "EXIT_AGENT_APP") {
  const command = await createCommand(commandType === "EXIT_AGENT_APP"
    ? exitInput(false)
    : {
        deviceId: deviceCode,
        commandType,
        expiresInSeconds: 3600
      });
  const claimed = await claimPendingCommandByDeviceId(deviceId, "BASE");
  expect(claimed?.id).toBe(command.id);
  if (!claimed) throw new Error("TEST_COMMAND_NOT_CLAIMED");
  return { command, claimed };
}

beforeAll(async () => {
  const device = await db.insert(collectorDevices).values({
    deviceCode,
    deviceToken,
    enabled: true,
    status: "online",
    createdBy: "exit-api-test",
    updatedBy: "exit-api-test"
  }).returning();
  deviceId = device[0]?.id ?? "";
  if (!deviceId) throw new Error("TEST_DEVICE_CREATE_FAILED");

  const login = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await login.json()).token;
});

beforeEach(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
});

afterAll(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

describe("EXIT_AGENT_APP API command integration", () => {
  test("serializes concurrent identical EXIT requests into one active command", async () => {
    const [first, second] = await Promise.all([
      createCommand(exitInput(false)),
      createCommand(exitInput(false))
    ]);

    expect(second.id).toBe(first.id);
    const rows = await db.select({ id: mobileCommands.id }).from(mobileCommands).where(and(
      eq(mobileCommands.deviceId, deviceId),
      eq(mobileCommands.commandType, "EXIT_AGENT_APP"),
      inArray(mobileCommands.status, ["PENDING", "FETCHED", "CLAIMED", "RUNNING"])
    ));
    expect(rows).toHaveLength(1);
  });

  test("returns a conflict containing the existing command id for a different lock choice", async () => {
    const existing = await createCommand(exitInput(false));
    const response = await adminRequest("/api/v1/admin/mobile-commands", exitInput(true));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("EXIT_AGENT_APP_ACTIVE_CONFLICT");
    expect(body.error.details.existingCommandId).toBe(existing.id);
  });

  test("allows EXIT idempotency keys and returns the original terminal command", async () => {
    const key = `exit:${suffix}`;
    const first = await createCommand(exitInput(false, key));
    await db.update(mobileCommands)
      .set({ status: "DONE", resultJson: { result: "DONE" } })
      .where(eq(mobileCommands.id, first.id));

    const repeated = await createCommand(exitInput(true, key));
    expect(repeated.id).toBe(first.id);
    expect(repeated.status).toBe("DONE");
  });

  test("keeps generic idempotency keys behind the assignment command route", async () => {
    await expect(createCommand({
      deviceId: deviceCode,
      commandType: "OPEN_AGENT_APP",
      idempotencyKey: `agent:${suffix}`,
      expiresInSeconds: 3600
    })).rejects.toThrow("ASSIGNMENT_COMMAND_ROUTE_REQUIRED");
  });

  test("rejects an omitted EXIT result before changing the claimed command", async () => {
    const { command, claimed } = await claimBaseCommand();

    const response = await mobileRequest(`/api/v1/mobile/base-control/commands/${command.id}/ack`, {
      deviceId: deviceCode,
      claimToken: claimed.claimToken,
      status: "DONE"
    });
    const body = await response.json();
    const [stored] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, command.id));

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BASE_COMMAND_ACK_VALIDATION_FAILED");
    expect(stored?.status).toBe("CLAIMED");
    expect(stored?.resultJson).toBeNull();
  });

  test("rejects a valid EXIT result attached to a non-EXIT BASE command", async () => {
    const { command, claimed } = await claimBaseCommand("OPEN_AGENT_APP");
    const response = await mobileRequest(`/api/v1/mobile/base-control/commands/${command.id}/ack`, {
      deviceId: deviceCode,
      claimToken: claimed.claimToken,
      status: "DONE",
      result: { commandType: "EXIT_AGENT_APP", result: "DONE", stages: exitStages }
    });
    const body = await response.json();

    const [stored] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, command.id));
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BASE_COMMAND_ACK_VALIDATION_FAILED");
    expect(stored?.status).toBe("CLAIMED");
  });

  test("persists PARTIAL business result with DONE transport and accepts an equivalent retry", async () => {
    const { command, claimed } = await claimBaseCommand();
    const result = { commandType: "EXIT_AGENT_APP" as const, result: "PARTIAL" as const, stages: partialExitStages };
    const payload = {
      deviceId: deviceCode,
      claimToken: claimed.claimToken,
      status: "DONE" as const,
      result
    };

    const first = await acknowledgeBaseCommand(command.id, payload);
    const repeated = await acknowledgeBaseCommand(command.id, payload);
    const [stored] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, command.id));

    expect(first.id).toBe(command.id);
    expect(repeated.id).toBe(command.id);
    expect(stored?.status).toBe("DONE");
    expect(stored?.resultJson).toEqual(result);
  });

  test("rejects a conflicting terminal EXIT acknowledgement", async () => {
    const { command, claimed } = await claimBaseCommand();
    const firstResult = { commandType: "EXIT_AGENT_APP" as const, result: "DONE" as const, stages: exitStages };
    const firstResponse = await mobileRequest(`/api/v1/mobile/base-control/commands/${command.id}/ack`, {
      deviceId: deviceCode,
      claimToken: claimed.claimToken,
      status: "DONE",
      result: firstResult
    });
    expect(firstResponse.status).toBe(200);

    const conflictingResponse = await mobileRequest(`/api/v1/mobile/base-control/commands/${command.id}/ack`, {
      deviceId: deviceCode,
      claimToken: claimed.claimToken,
      status: "DONE",
      result: {
        ...firstResult,
        stages: [
          firstResult.stages[0],
          firstResult.stages[1],
          { name: "LOCK_SCREEN", status: "SKIPPED", reason: "DIFFERENT_RESULT" }
        ]
      }
    });
    const body = await conflictingResponse.json();
    expect(conflictingResponse.status).toBe(409);
    expect(body.error.code).toBe("BASE_COMMAND_ACK_CONFLICT");
  });
});
