import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mobileBaseCommandAckSchema } from "@pkg/types";

const apiRoot = path.join(import.meta.dir, "..");

describe("native base control channel", () => {
  test("accepts only terminal acknowledgements with the current claim token", () => {
    expect(mobileBaseCommandAckSchema.parse({
      deviceId: "mi-8-001",
      claimToken: "00000000-0000-4000-8000-000000000001",
      status: "DONE",
      result: { action: "RESTORED_EXISTING_TASK" }
    }).status).toBe("DONE");
    expect(mobileBaseCommandAckSchema.safeParse({
      deviceId: "mi-8-001",
      claimToken: "bad",
      status: "RUNNING"
    }).success).toBe(false);
  });

  test("exposes dedicated BASE-only poll and acknowledgement routes", () => {
    const route = readFileSync(path.join(apiRoot, "routes/mobile.ts"), "utf8");
    expect(route).toContain('mobileRoutes.get("/base-control/commands"');
    expect(route).toContain('pollCommands(deviceId, "BASE"');
    expect(route).toContain('mobileRoutes.post("/base-control/commands/:id/ack"');
    expect(route).toContain("acknowledgeBaseCommand");
  });

  test("acknowledges only the matching BASE claim and never an Agent command", () => {
    const repository = readFileSync(path.join(apiRoot, "repositories/command.repository.ts"), "utf8");
    expect(repository).toContain("updateClaimedBaseCommandStatus");
    expect(repository).toContain("eq(mobileCommands.executorType, \"BASE\")");
    expect(repository).toContain("eq(mobileCommands.claimToken, claimToken)");
    expect(repository).toContain('inArray(mobileCommands.status, ["CLAIMED", "RUNNING"])');
  });

  test("returns the claim token required for isolated execution", () => {
    const service = readFileSync(path.join(apiRoot, "services/command.service.ts"), "utf8");
    expect(service).toContain("claimToken: command.claimToken");
    expect(service).toContain("export async function acknowledgeBaseCommand");
  });
});
