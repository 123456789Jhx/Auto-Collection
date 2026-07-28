import { afterEach, describe, expect, test } from "bun:test";
import { remoteScriptConfigs, remoteScriptDefinitions } from "@pkg/db/schema";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import {
  createConfig,
  findConfigById,
  findDefinitionByKey,
  listConfigs,
  listDefinitions,
  softDeleteConfig,
  updateConfig,
  upsertDefinition
} from "./remote-script.repository";

const definitionIds: string[] = [];
const configIds: string[] = [];

afterEach(async () => {
  if (configIds.length > 0) {
    await db.delete(remoteScriptConfigs).where(inArray(remoteScriptConfigs.id, configIds.splice(0)));
  }
  if (definitionIds.length > 0) {
    await db.delete(remoteScriptDefinitions).where(inArray(remoteScriptDefinitions.id, definitionIds.splice(0)));
  }
});

describe("remote script repository", () => {
  test("upserts definitions by tenant and script key", async () => {
    const scriptKey = `repository_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const first = await upsertDefinition({
      scriptKey,
      name: "初始定义",
      description: null,
      configSchema: { type: "object", properties: {} },
      status: "ENABLED"
    }, "repository_test");
    definitionIds.push(first.id);

    const second = await upsertDefinition({
      scriptKey,
      name: "更新定义",
      description: "幂等更新",
      configSchema: { type: "object", properties: { enabled: { type: "boolean" } } },
      status: "ENABLED"
    }, "repository_test");

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("更新定义");
    expect((await findDefinitionByKey(scriptKey))?.id).toBe(first.id);
    expect((await listDefinitions()).some((item) => item.id === first.id)).toBe(true);
  });

  test("enforces config uniqueness and updates revision and hash", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const scriptKey = `repository_test_${suffix}`;
    const configName = `配置_${suffix}`;
    const first = await createConfig({
      scriptKey,
      configName,
      configPayload: { keywords: ["玉米"] },
      status: "ENABLED"
    }, "repository_test");
    configIds.push(first.id);

    let duplicateError: unknown;
    try {
      await createConfig({
        scriptKey,
        configName,
        configPayload: { keywords: ["水稻"] },
        status: "ENABLED"
      }, "repository_test");
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toMatchObject({ code: "23505" });

    const updated = await updateConfig(first.id, {
      configPayload: { keywords: ["玉米", "病虫害"] }
    }, "repository_test");
    expect(updated?.revision).toBe(2);
    expect(updated?.configHash).not.toBe(first.configHash);

    const page = await listConfigs({
      scriptKey,
      status: "ENABLED",
      keyword: suffix,
      page: 1,
      pageSize: 10
    });
    expect(page.total).toBe(1);
    expect(page.data[0]?.id).toBe(first.id);
    expect((await findConfigById(first.id))?.revision).toBe(2);

    expect((await softDeleteConfig(first.id, "repository_test"))?.id).toBe(first.id);
    expect(await findConfigById(first.id)).toBeNull();
  });
});
