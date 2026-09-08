import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  collectorDevices,
  mobileCommands,
  remoteScriptConfigs,
  remoteScriptDeviceBindings
} from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { syncRemoteScriptDefinitions } from "../services/remote-script-registry";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `node8-device-${suffix.slice(0, 12)}`;
const deviceToken = `${suffix}${suffix}`;
let adminToken = "";
let configId = "";
let deviceId = "";

function adminRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function mobileRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      "X-Device-Token": deviceToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeAll(async () => {
  await syncRemoteScriptDefinitions();
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await response.json()).token;
});

afterAll(async () => {
  if (deviceId) {
    await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  }
  if (configId) {
    await db.delete(remoteScriptDeviceBindings).where(eq(remoteScriptDeviceBindings.configId, configId));
    await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  }
  await db.delete(collectorDevices).where(eq(collectorDevices.deviceCode, deviceCode));
});

describe("remote script offline delivery", () => {
  test("binds, notifies, pulls and acknowledges idempotently", async () => {
    const registerResponse = await app.request("/api/v1/mobile/device-token/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceCode, deviceToken, platform: "android", appVersion: "node8-test" })
    });
    expect(registerResponse.status).toBe(200);
    const device = await db.query.collectorDevices.findFirst({
      where: eq(collectorDevices.deviceCode, deviceCode)
    });
    expect(device?.id).toBeString();
    deviceId = device?.id ?? "";

    const createResponse = await adminRequest("/api/v1/admin/remote-scripts/configs", "POST", {
      scriptKey: "generic_form",
      configName: `节点8配置_${suffix}`,
      configPayload: {
        keywords: ["玉米"],
        titleTpl: "今日{keyword}",
        dailyLimit: 10,
        mode: "scheduled",
        enabled: true
      }
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    configId = created.id;

    const bindResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${configId}/bindings`, "POST", {
      deviceCode,
      priority: 20
    });
    expect(bindResponse.status).toBe(201);

    const bindingsResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${configId}/bindings`);
    const bindings = await bindingsResponse.json();
    expect(bindingsResponse.status).toBe(200);
    expect(bindings.data).toHaveLength(1);
    expect(bindings.data[0]).toMatchObject({ deviceCode, priority: 20 });

    const listResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs?keyword=${suffix}&page=1&pageSize=10`);
    const list = await listResponse.json();
    expect(list.data[0]?.bindingCount).toBe(1);

    const offlineCommands = await (await adminRequest("/api/v1/admin/mobile-commands")).json();
    const bindCommand = offlineCommands.find((item: { deviceId: string; commandType: string }) =>
      item.deviceId === deviceId && item.commandType === "SCRIPT_CONFIG_UPDATED"
    );
    expect(bindCommand?.status).toBe("PENDING");

    const updateResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${configId}`, "PATCH", {
      configPayload: {
        keywords: ["玉米", "病虫害"],
        titleTpl: "更新{keyword}",
        dailyLimit: 12,
        mode: "scheduled",
        enabled: true
      }
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.revision).toBe(2);

    const firstPollResponse = await mobileRequest(`/api/v1/mobile/commands?deviceId=${deviceCode}&executorType=AGENT`);
    const firstPollCommands = (await firstPollResponse.json()).data;
    expect(firstPollResponse.status).toBe(200);
    const bindDeliveryCommand = firstPollCommands.find((item: { payload: { revision?: number } }) => item.payload.revision === 1);
    expect(bindDeliveryCommand).toMatchObject({
      commandType: "SCRIPT_CONFIG_UPDATED",
      payload: { revision: 1 }
    });

    const bindAck = await mobileRequest(`/api/v1/mobile/commands/${bindDeliveryCommand.id}/ack`, "POST", {
      deviceId: deviceCode,
      status: "DONE",
      result: { applied: true, appliedRevision: 1, configHash: bindDeliveryCommand.payload.config_hash }
    });
    expect(bindAck.status).toBe(200);

    const commandsResponse = await mobileRequest(`/api/v1/mobile/commands?deviceId=${deviceCode}&executorType=AGENT`);
    const commands = (await commandsResponse.json()).data;
    expect(commandsResponse.status).toBe(200);
    const updateCommand = commands.find((item: { payload: { revision?: number } }) => item.payload.revision === 2);
    expect(updateCommand).toMatchObject({
      commandType: "SCRIPT_CONFIG_UPDATED",
      payload: {
        script_key: "generic_form",
        revision: 2,
        config_hash: updated.configHash
      }
    });

    const pullResponse = await mobileRequest(`/api/v1/mobile/remote-scripts/configs/generic_form?deviceId=${deviceCode}`);
    const pulled = (await pullResponse.json()).data;
    expect(pullResponse.status).toBe(200);
    expect(pulled).toMatchObject({
      scriptKey: "generic_form",
      revision: 2,
      configHash: updated.configHash,
      configPayload: { titleTpl: "更新{keyword}" }
    });

    const ackBody = {
      deviceId: deviceCode,
      status: "DONE",
      result: { applied: true, appliedRevision: 2, configHash: updated.configHash }
    };
    const firstAck = await mobileRequest(`/api/v1/mobile/commands/${updateCommand.id}/ack`, "POST", ackBody);
    const firstAckResult = await firstAck.json();
    expect(firstAck.status).toBe(200);
    expect(firstAckResult.idempotent).toBeFalse();

    const repeatedAck = await mobileRequest(`/api/v1/mobile/commands/${updateCommand.id}/ack`, "POST", ackBody);
    const repeatedAckResult = await repeatedAck.json();
    expect(repeatedAck.status).toBe(200);
    expect(repeatedAckResult.idempotent).toBeTrue();

    const adminCommands = await (await adminRequest("/api/v1/admin/mobile-commands")).json();
    const acknowledged = adminCommands.find((item: { id: string }) => item.id === updateCommand.id);
    expect(acknowledged).toMatchObject({ status: "DONE" });
    expect(acknowledged.resultJson.appliedRevision).toBe(2);

    const unbindResponse = await adminRequest(
      `/api/v1/admin/remote-scripts/configs/${configId}/bindings/${encodeURIComponent(deviceCode)}`,
      "DELETE"
    );
    expect(unbindResponse.status).toBe(200);
    const afterUnbind = await (await adminRequest(`/api/v1/admin/remote-scripts/configs/${configId}/bindings`)).json();
    expect(afterUnbind.data).toHaveLength(0);
  });
});
