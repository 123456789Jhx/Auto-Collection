import { describe, expect, test } from "bun:test";
import { supersededCommandTypesFor } from "./command-policy";

describe("command supersede policy", () => {
  test("STOP supersedes all pending state commands", () => {
    expect(supersededCommandTypesFor("STOP")).toEqual(["START", "RESUME", "PAUSE", "STOP"]);
  });

  test("ordinary state commands do not supersede pending STOP", () => {
    expect(supersededCommandTypesFor("START")).toEqual(["START", "RESUME", "PAUSE"]);
    expect(supersededCommandTypesFor("RESUME")).toEqual(["START", "RESUME", "PAUSE"]);
    expect(supersededCommandTypesFor("PAUSE")).toEqual(["START", "RESUME", "PAUSE"]);
  });

  test("non-state commands do not supersede state commands", () => {
    expect(supersededCommandTypesFor("REFRESH_CONFIG")).toEqual([]);
  });
});
