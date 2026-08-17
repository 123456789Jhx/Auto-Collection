import { describe, expect, test } from "bun:test";
import { desiredAgentStateForCommand, supersededAgentControlCommandsFor } from "./agent-control";

describe("Agent lifecycle command policy", () => {
  test("only dedicated Agent commands change the desired Agent state", () => {
    expect(desiredAgentStateForCommand("START_AGENT")).toBe("running");
    expect(desiredAgentStateForCommand("STOP_AGENT")).toBe("stopped");
    expect(desiredAgentStateForCommand("EXIT_AGENT_APP")).toBeNull();
    expect(desiredAgentStateForCommand("STOP")).toBeNull();
  });

  test("new Agent commands supersede only pending Agent lifecycle commands", () => {
    expect(supersededAgentControlCommandsFor("START_AGENT")).toEqual(["OPEN_AGENT_APP", "START_AGENT", "STOP_AGENT"]);
    expect(supersededAgentControlCommandsFor("STOP_AGENT")).toEqual(["OPEN_AGENT_APP", "START_AGENT", "STOP_AGENT"]);
    expect(supersededAgentControlCommandsFor("OPEN_AGENT_APP")).toEqual(["OPEN_AGENT_APP", "START_AGENT", "STOP_AGENT"]);
    expect(supersededAgentControlCommandsFor("EXIT_AGENT_APP")).toEqual([]);
    expect(supersededAgentControlCommandsFor("STOP")).toEqual([]);
  });
});
