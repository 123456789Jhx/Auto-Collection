import { describe, expect, mock, test } from "bun:test";
import type {
  CreateRemoteScriptConfigPayload,
  UpdateRemoteScriptConfigPayload
} from "@pkg/types";

const createdPayloads: Array<Record<string, unknown>> = [];
const updatedPayloads: Array<Record<string, unknown>> = [];
const definition = {
  id: "11111111-1111-4111-8111-111111111111",
  scriptKey: "publish_video",
  configSchema: { type: "object" },
  status: "ENABLED"
};

mock.module("../repositories/remote-script.repository", () => ({
  createConfig: mock(async (payload: CreateRemoteScriptConfigPayload) => {
    createdPayloads.push(payload.configPayload);
    return { id: "config-id", ...payload };
  }),
  findEnabledConfigForDevice: mock(async () => null),
  findConfigById: mock(async () => ({ id: "config-id", scriptKey: "publish_video" })),
  findDefinitionByKey: mock(async () => definition),
  getBindingCounts: mock(async () => new Map()),
  listConfigBindings: mock(async () => []),
  listConfigs: mock(async () => ({ data: [], page: 1, pageSize: 20, total: 0 })),
  saveConfigBinding: mock(async () => null),
  softDeleteConfig: mock(async () => null),
  softDeleteConfigBinding: mock(async () => null),
  updateConfig: mock(async (_id: string, payload: UpdateRemoteScriptConfigPayload) => {
    if (payload.configPayload) {
      updatedPayloads.push(payload.configPayload);
    }
    return { id: "config-id", scriptKey: "publish_video" };
  })
}));
mock.module("../repositories/device.repository", () => ({
  findDeviceByCode: mock(async () => null)
}));
mock.module("./command.service", () => ({
  createScriptConfigUpdatedCommand: mock(async () => null)
}));

const {
  RemoteScriptServiceError,
  createRemoteScriptConfig,
  normalizePublishVideoConfigPayload,
  updateRemoteScriptConfig
} = await import("./remote-script.service");

function directMaterialPayload(): Record<string, unknown> {
  return {
    sourceMode: "direct_material",
    responseDelayMsMin: 100,
    responseDelayMsMax: 200,
    actionWaitMsMin: 100,
    actionWaitMsMax: 200
  };
}

function externalPullPayload(): Record<string, unknown> {
  return {
    sourceMode: "external_pull",
    responseDelayMsMin: 100,
    responseDelayMsMax: 200,
    actionWaitMsMin: 100,
    actionWaitMsMax: 200,
    externalBaseUrl: "https://publish.example.test",
    externalTokenEnv: "PUBLISH_EXTERNAL_TOKEN",
    publishTimeSlots: ["09:00"]
  };
}

function expectPayloadError(action: () => unknown) {
  try {
    action();
    throw new Error("expected payload validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteScriptServiceError);
    return error as InstanceType<typeof RemoteScriptServiceError>;
  }
}

function errorMessages(error: InstanceType<typeof RemoteScriptServiceError>) {
  return error.details.errors as string[];
}

describe("remote script service publish_video protection", () => {
  test("normalizes direct_material payloads before create", async () => {
    createdPayloads.length = 0;
    await createRemoteScriptConfig({
      scriptKey: "publish_video",
      configName: "direct material",
      configPayload: directMaterialPayload(),
      status: "ENABLED"
    }, "tester");

    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({
      sourceMode: "direct_material",
      expectedTopicCount: 5,
      requireCover: true,
      isDefault: false
    });
  });

  test("rejects external fields and credential-like keys for direct_material", () => {
    const externalFieldError = expectPayloadError(() => normalizePublishVideoConfigPayload({
      ...directMaterialPayload(),
      externalBaseUrl: "https://publish.example.test"
    }));
    expect(errorMessages(externalFieldError)).toContain("externalBaseUrl: direct_material 不允许该字段");

    const sensitiveFieldError = expectPayloadError(() => normalizePublishVideoConfigPayload({
      ...directMaterialPayload(),
      apiKey: "disallowed"
    }));
    expect(errorMessages(sensitiveFieldError)).toContain("apiKey: 不允许保存敏感凭据字段");
  });

  test("requires the external_pull URL and token environment name", () => {
    const withoutUrl = externalPullPayload();
    delete withoutUrl.externalBaseUrl;
    const missingUrlError = expectPayloadError(() =>
      normalizePublishVideoConfigPayload(withoutUrl)
    );
    expect(errorMessages(missingUrlError).length).toBeGreaterThan(0);

    const withoutTokenEnvironment = externalPullPayload();
    delete withoutTokenEnvironment.externalTokenEnv;
    const missingTokenEnvironmentError = expectPayloadError(() =>
      normalizePublishVideoConfigPayload(withoutTokenEnvironment)
    );
    expect(errorMessages(missingTokenEnvironmentError).length).toBeGreaterThan(0);
  });

  test("defaults legacy time slots and validates token environment names", () => {

    const withoutLegacySlots = externalPullPayload();
    delete withoutLegacySlots.publishTimeSlots;
    expect(normalizePublishVideoConfigPayload(withoutLegacySlots)).toMatchObject({
      publishTimeSlots: []
    });

    const environmentNameError = expectPayloadError(() => normalizePublishVideoConfigPayload({
      ...externalPullPayload(),
      externalTokenEnv: "not an env name"
    }));
    expect(errorMessages(environmentNameError)).toContain("externalTokenEnv: 必须是环境变量名");
  });

  test("normalizes publish_video payloads before update", async () => {
    updatedPayloads.length = 0;
    await updateRemoteScriptConfig("config-id", {
      configPayload: externalPullPayload()
    }, "tester");

    expect(updatedPayloads).toHaveLength(1);
    expect(updatedPayloads[0]).toMatchObject({
      sourceMode: "external_pull",
      expectedTopicCount: 5,
      platforms: ["抖音", "视频号"]
    });
  });
});
