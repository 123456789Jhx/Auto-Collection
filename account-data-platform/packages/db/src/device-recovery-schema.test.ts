import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { deviceRecoverySessions, deviceRecoveryStageEvents } from "./device-recovery-schema";

function columnNames(index: ReturnType<typeof getTableConfig>["indexes"][number]) {
  return index.config.columns.map((column) => "name" in column ? column.name : "expression");
}

describe("device recovery persistence schema", () => {
  test("stores one recovery summary for automatic boot or manual wake", () => {
    expect(getTableName(deviceRecoverySessions)).toBe("device_recovery_sessions");
    expect(deviceRecoverySessions.deviceId.name).toBe("device_id");
    expect(deviceRecoverySessions.commandId.name).toBe("command_id");
    expect(deviceRecoverySessions.source.name).toBe("source");
    expect(deviceRecoverySessions.stage.name).toBe("stage");
    expect(deviceRecoverySessions.resultStatus.name).toBe("result_status");
    expect(deviceRecoverySessions.startedAt.name).toBe("started_at");
    expect(deviceRecoverySessions.completedAt.name).toBe("completed_at");
    expect(deviceRecoverySessions.commandId.notNull).toBe(false);
  });

  test("stores idempotent stage events with original device timestamps", () => {
    expect(getTableName(deviceRecoveryStageEvents)).toBe("device_recovery_stage_events");
    expect(deviceRecoveryStageEvents.sessionId.name).toBe("session_id");
    expect(deviceRecoveryStageEvents.eventKey.name).toBe("event_key");
    expect(deviceRecoveryStageEvents.occurredAt.name).toBe("occurred_at");
    expect(deviceRecoveryStageEvents.reportedAt.name).toBe("reported_at");
    expect(deviceRecoveryStageEvents.detailsJson.name).toBe("details_json");

    const unique = getTableConfig(deviceRecoveryStageEvents).indexes.find(
      (index) => index.config.name === "uniq_device_recovery_stage_event_key"
    );
    expect(unique?.config.unique).toBeTrue();
    expect(unique && columnNames(unique)).toEqual(["tenant_id", "device_id", "event_key"]);
  });

  test("indexes the latest session and ordered timeline for one device", () => {
    const sessionIndex = getTableConfig(deviceRecoverySessions).indexes.find(
      (index) => index.config.name === "idx_device_recovery_session_device_started"
    );
    const eventIndex = getTableConfig(deviceRecoveryStageEvents).indexes.find(
      (index) => index.config.name === "idx_device_recovery_stage_event_session_occurred"
    );
    expect(sessionIndex && columnNames(sessionIndex)).toEqual(["tenant_id", "device_id", "started_at"]);
    expect(eventIndex && columnNames(eventIndex)).toEqual(["tenant_id", "session_id", "occurred_at"]);
  });
});
