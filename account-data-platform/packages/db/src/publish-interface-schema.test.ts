import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  publishInterfaceAlerts,
  publishRunBindings,
  publishRuns,
  publishSlotExecutions,
  publishStatusOutbox,
  publishTasks
} from "./schema";

function columnNames(index: ReturnType<typeof getTableConfig>["indexes"][number]) {
  return index.config.columns.map((column) => "name" in column ? column.name : "expression");
}

describe("interface publish database schema", () => {
  test("exports the four runtime tables", () => {
    expect(getTableName(publishRuns)).toBe("publish_runs");
    expect(getTableName(publishRunBindings)).toBe("publish_run_bindings");
    expect(getTableName(publishSlotExecutions)).toBe("publish_slot_executions");
    expect(getTableName(publishInterfaceAlerts)).toBe("publish_interface_alerts");
  });

  test("stores immutable run configuration and binding snapshots", () => {
    expect(publishRuns.morningWindowStart.name).toBe("morning_window_start");
    expect(publishRuns.morningPublishTime.name).toBe("morning_publish_time");
    expect(publishRuns.afternoonWindowEnd.name).toBe("afternoon_window_end");
    expect(publishRuns.afternoonPublishTime.name).toBe("afternoon_publish_time");
    expect(publishRuns.maxConcurrentPublishing.name).toBe("max_concurrent_publishing");

    expect(publishRunBindings.bindingId.name).toBe("binding_id");
    expect(publishRunBindings.deviceId.name).toBe("device_id");
    expect(publishRunBindings.accountName.name).toBe("account_name");
    expect(publishRunBindings.accountNo.name).toBe("account_no");
    expect(publishRunBindings.assignmentId.name).toBe("assignment_id");
  });

  test("keeps daily slot uniqueness independent of run id", () => {
    const index = getTableConfig(publishSlotExecutions).indexes.find(
      (candidate) => candidate.config.name === "uniq_publish_slot_executions_daily_slot"
    );
    expect(index?.config.unique).toBeTrue();
    expect(index && columnNames(index)).toEqual([
      "tenant_id",
      "business_date",
      "platform",
      "binding_id",
      "slot"
    ]);
  });

  test("limits each tenant to one non-terminal run", () => {
    const index = getTableConfig(publishRuns).indexes.find(
      (candidate) => candidate.config.name === "uniq_publish_runs_one_active_per_tenant"
    );
    expect(index?.config.unique).toBeTrue();
    expect(index && columnNames(index)).toEqual(["tenant_id"]);
    expect(index?.config.where).toBeDefined();
  });

  test("extends local tasks and outbox with immutable interface state", () => {
    expect(publishTasks.interfaceRunId.name).toBe("interface_run_id");
    expect(publishTasks.slotExecutionId.name).toBe("slot_execution_id");
    expect(publishTasks.localResultStatus.name).toBe("local_result_status");
    expect(publishTasks.errorCategory.name).toBe("error_category");
    expect(publishTasks.sideEffectStartedAt.name).toBe("side_effect_started_at");

    expect(publishStatusOutbox.targetStatus.name).toBe("target_status");
    expect(publishStatusOutbox.payloadJson.name).toBe("payload_json");
    expect(publishStatusOutbox.nextRetryAt.name).toBe("next_retry_at");
    expect(publishStatusOutbox.terminalAt.name).toBe("terminal_at");
  });
});
