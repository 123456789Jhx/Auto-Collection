import { expect, test } from "bun:test";
import { mobileCommandAckSchema } from "@pkg/types";
import {
  buildTaskAssignmentCommandAckPatch,
  resolveTaskAssignmentCommandAckDisposition
} from "../repositories/task-assignment.repository";

test("allows repeated RUNNING acknowledgements to replace progress results without weakening terminal protection", () => {
  const now = new Date("2026-08-18T00:00:00.000Z");
  const claimed = {
    status: "CLAIMED",
    resultJson: null,
    fetchedAt: now,
    acknowledgedAt: null
  };
  const firstInput = {
    status: "RUNNING" as const,
    result: { stage: "OPENING_SEARCH", attempt: 1, obsolete: "first-progress" },
    payloadHash: "progress-hash-1"
  };

  expect(resolveTaskAssignmentCommandAckDisposition(claimed, firstInput)).toBe("UPDATE");
  const firstPatch = buildTaskAssignmentCommandAckPatch(claimed, firstInput, now);
  const running = { ...claimed, ...firstPatch };
  const secondInput = {
    status: "RUNNING" as const,
    result: { stage: "ENTERED", attempt: 2 },
    payloadHash: "progress-hash-2"
  };

  expect(resolveTaskAssignmentCommandAckDisposition(running, secondInput)).toBe("UPDATE");
  const secondPatch = buildTaskAssignmentCommandAckPatch(running, secondInput, now);
  expect(secondPatch.resultJson as Record<string, unknown>).toEqual({ stage: "ENTERED", attempt: 2, _ackHash: "progress-hash-2" });
  expect(secondPatch.resultJson as Record<string, unknown>).not.toHaveProperty("obsolete");

  expect(() => resolveTaskAssignmentCommandAckDisposition({
    ...running,
    status: "DONE",
    resultJson: { completed: true, _ackHash: "terminal-hash" }
  }, secondInput)).toThrow("COMMAND_ACK_CONFLICT");
});

test("accepts arbitrary command acknowledgement results", () => {
  const parsed = mobileCommandAckSchema.parse({
    deviceId: "device-1",
    status: "RUNNING",
    result: {
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      stage: "ENTERED",
      nested: { elapsedMs: 123, evidence: ["room"] }
    }
  });

  expect(parsed.result).toEqual({
    status: "LIVE_COMMENT_ENTRY_ENTERED",
    stage: "ENTERED",
    nested: { elapsedMs: 123, evidence: ["room"] }
  });
});
