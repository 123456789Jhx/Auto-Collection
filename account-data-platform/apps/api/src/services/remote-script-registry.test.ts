import { describe, expect, test } from "bun:test";
import { listDefinitions } from "../repositories/remote-script.repository";
import {
  remoteScriptRegistry,
  syncRemoteScriptDefinitions
} from "./remote-script-registry";

type PublishVideoFormSchema = {
  properties: Record<string, { enum?: unknown[]; visibleWhen?: unknown; items?: unknown }>;
  required: string[];
  allOf?: Array<{
    if: { properties: { sourceMode: { const: string } }; required?: string[] };
    then: { required: string[] };
  }>;
};

describe("remote script registry", () => {
  test("marks external fields as conditional for publish video forms", () => {
    const publishVideo = remoteScriptRegistry.get("publish_video");
    const schema = publishVideo?.configSchema as unknown as PublishVideoFormSchema;

    expect(schema.properties.sourceMode?.enum).toEqual(["direct_material", "external_pull"]);
    for (const field of ["externalBaseUrl", "externalTokenEnv", "publishTimeSlots", "platforms"]) {
      expect(schema.properties[field]?.visibleWhen).toEqual({
        field: "sourceMode",
        equals: "external_pull"
      });
      expect(schema.required).not.toContain(field);
    }
    expect(schema.properties.platforms?.items).toEqual({
      type: "string",
      enum: ["\u6296\u97f3", "\u89c6\u9891\u53f7"]
    });
    expect(schema.allOf).toEqual([{
      if: { properties: { sourceMode: { const: "external_pull" } }, required: ["sourceMode"] },
      then: { required: ["externalBaseUrl", "externalTokenEnv"] }
    }]);
  });

  test("syncs registered definitions idempotently", async () => {
    await syncRemoteScriptDefinitions();
    await syncRemoteScriptDefinitions();

    const definitions = await listDefinitions();
    const genericForms = definitions.filter((item) => item.scriptKey === "generic_form");
    const publishVideos = definitions.filter((item) => item.scriptKey === "publish_video");
    const registeredGenericForm = remoteScriptRegistry.get("generic_form");
    const registeredPublishVideo = remoteScriptRegistry.get("publish_video");

    expect(genericForms).toHaveLength(1);
    expect(publishVideos).toHaveLength(1);
    expect(registeredGenericForm).toBeDefined();
    expect(registeredPublishVideo).toBeDefined();
    expect(publishVideos[0]?.configSchema).toEqual(registeredPublishVideo!.configSchema);
    expect(genericForms[0]?.configSchema).toEqual(registeredGenericForm!.configSchema);
  });
});
