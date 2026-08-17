import { describe, expect, test } from "bun:test";
import { executorForCommandType, isCommandExecutor } from "./command-executor";

describe("mobile command executor ownership", () => {
  test.each(["START_AGENT", "STOP_AGENT", "OPEN_AGENT_APP", "EXIT_AGENT_APP"])("assigns %s exclusively to the native base", (commandType) => {
    expect(executorForCommandType(commandType)).toBe("BASE");
  });

  test.each(["START", "STOP", "STATUS", "PUBLISH_VIDEO_TASK", "SCRIPT_CONFIG_UPDATED"])("assigns %s to the inner Agent", (commandType) => {
    expect(executorForCommandType(commandType)).toBe("AGENT");
  });

  test("accepts only the two public polling executors", () => {
    expect(isCommandExecutor("BASE")).toBe(true);
    expect(isCommandExecutor("AGENT")).toBe(true);
    expect(isCommandExecutor("AUTOJS")).toBe(false);
    expect(isCommandExecutor(undefined)).toBe(false);
  });
});
