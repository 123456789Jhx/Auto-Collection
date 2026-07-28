import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { remoteScriptConfigs } from "@pkg/db/schema";
import { inArray } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { syncRemoteScriptDefinitions } from "../services/remote-script-registry";

const createdIds: string[] = [];
let adminToken = "";

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

beforeAll(async () => {
  await syncRemoteScriptDefinitions();
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  const result = await response.json();
  adminToken = result.token;
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(remoteScriptConfigs).where(inArray(remoteScriptConfigs.id, createdIds));
  }
});

describe("remote script config admin API", () => {
  test("rejects unauthenticated requests", async () => {
    const response = await app.request("/api/v1/admin/remote-scripts/configs");

    expect(response.status).toBe(401);
  });

  test("rejects payloads that do not match the registered schema", async () => {
    const response = await adminRequest("/api/v1/admin/remote-scripts/configs", "POST", {
      scriptKey: "generic_form",
      configName: "无效配置",
      configPayload: { keywords: ["玉米"] }
    });
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error.code).toBe("PAYLOAD_SCHEMA_MISMATCH");
  });

  test("supports the complete config lifecycle", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const configName = `节点5配置_${suffix}`;
    const createPayload = {
      scriptKey: "generic_form",
      configName,
      configPayload: {
        keywords: ["玉米"],
        titleTpl: "今日{keyword}",
        dailyLimit: 10,
        mode: "scheduled",
        enabled: true
      }
    };

    const createResponse = await adminRequest("/api/v1/admin/remote-scripts/configs", "POST", createPayload);
    const created = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect(created.revision).toBe(1);
    createdIds.push(created.id);

    const duplicateResponse = await adminRequest("/api/v1/admin/remote-scripts/configs", "POST", createPayload);
    const duplicate = await duplicateResponse.json();
    expect(duplicateResponse.status).toBe(409);
    expect(duplicate.error.code).toBe("CONFIG_NAME_CONFLICT");

    const query = `scriptKey=generic_form&keyword=${suffix}&page=1&pageSize=10`;
    const listResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs?${query}`);
    const page = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(page.total).toBe(1);
    expect(page.data[0]?.id).toBe(created.id);

    const detailResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${created.id}`);
    const detail = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detail.id).toBe(created.id);

    const updateResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${created.id}`, "PATCH", {
      configPayload: {
        ...createPayload.configPayload,
        keywords: ["玉米", "病虫害"]
      }
    });
    const updated = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updated.revision).toBe(2);
    expect(updated.configHash).not.toBe(created.configHash);

    const statusResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${created.id}`, "PATCH", {
      status: "DISABLED"
    });
    const disabled = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(disabled.status).toBe("DISABLED");

    const deleteResponse = await adminRequest(`/api/v1/admin/remote-scripts/configs/${created.id}`, "DELETE");
    expect(deleteResponse.status).toBe(200);

    const afterDeleteList = await (await adminRequest(`/api/v1/admin/remote-scripts/configs?${query}`)).json();
    expect(afterDeleteList.total).toBe(0);

    const afterDeleteDetail = await adminRequest(`/api/v1/admin/remote-scripts/configs/${created.id}`);
    const missing = await afterDeleteDetail.json();
    expect(afterDeleteDetail.status).toBe(404);
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
