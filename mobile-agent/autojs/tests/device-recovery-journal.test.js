const assert = require("node:assert/strict");
const { createDeviceRecoveryJournal } = require("../app/device-recovery-journal.js");

function memoryStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    put(key, value) {
      values.set(key, value);
    },
    remove(key) {
      values.delete(key);
    }
  };
}

(function recordsStagesOnceAndKeepsOriginalTimestamps() {
  const storage = memoryStorage();
  const journal = createDeviceRecoveryJournal({
    storage,
    bootId: "boot-17",
    now: () => "2026-08-12T01:00:05.000Z"
  });

  const first = journal.recordStage("SYSTEM_BOOTED", { launcher: "watchdog" }, "2026-08-12T01:00:00.000Z");
  const duplicate = journal.recordStage("SYSTEM_BOOTED", { launcher: "main" }, "2026-08-12T01:00:02.000Z");

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(journal.listPending().length, 1);
  assert.equal(journal.listPending()[0].occurredAt, "2026-08-12T01:00:00.000Z");
  assert.equal(journal.listPending()[0].eventKey, "boot-17:SYSTEM_BOOTED");
})();

(function persistsPendingEventsAcrossEngineRestarts() {
  const storage = memoryStorage();
  createDeviceRecoveryJournal({ storage, bootId: "boot-18" })
    .recordStage("SYSTEM_BOOTED", {}, "2026-08-12T02:00:00.000Z");
  const restarted = createDeviceRecoveryJournal({ storage, bootId: "boot-18" });

  assert.equal(restarted.listPending().length, 1);
  assert.equal(restarted.currentStage(), "SYSTEM_BOOTED");
})();

(function rejectsLocalStageRegressionAndSortsPendingEvents() {
  const journal = createDeviceRecoveryJournal({ storage: memoryStorage(), bootId: "boot-19" });
  journal.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T03:00:00.000Z");
  journal.recordStage("NETWORK_CONNECTED", {}, "2026-08-12T03:00:03.000Z");
  const regression = journal.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T03:00:04.000Z");

  assert.equal(regression.created, false);
  assert.equal(regression.reason, "duplicate");
  assert.deepEqual(journal.listPending().map((event) => event.stage), [
    "SYSTEM_BOOTED",
    "NETWORK_CONNECTED"
  ]);
})();

(function marksOnlyAcknowledgedEventsAsReported() {
  const journal = createDeviceRecoveryJournal({ storage: memoryStorage(), bootId: "boot-20" });
  journal.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T04:00:00.000Z");
  journal.recordStage("NETWORK_CONNECTED", {}, "2026-08-12T04:00:03.000Z");

  assert.equal(journal.markReported("boot-20:SYSTEM_BOOTED", "2026-08-12T04:00:10.000Z"), true);
  assert.deepEqual(journal.listPending().map((event) => event.stage), ["NETWORK_CONNECTED"]);
  assert.equal(journal.listEvents()[0].reportedAt, "2026-08-12T04:00:10.000Z");
})();

(function startsASeparateJournalWhenTheBootIdChanges() {
  const storage = memoryStorage();
  createDeviceRecoveryJournal({ storage, bootId: "boot-21" })
    .recordStage("COMMAND_CHANNEL_READY", {}, "2026-08-12T05:00:00.000Z");
  const nextBoot = createDeviceRecoveryJournal({ storage, bootId: "boot-22" });

  assert.equal(nextBoot.currentStage(), "WAITING_DEVICE");
  assert.equal(nextBoot.listPending().length, 1);
  assert.equal(nextBoot.listEvents().length, 1);
})();

(function scopesManualWakeEventsToTheCommand() {
  const journal = createDeviceRecoveryJournal({ storage: memoryStorage(), bootId: "boot-23" });
  journal.startManualWake({
    commandId: "40000000-0000-4000-8000-000000000001",
    channel: "AGENT_POLL"
  });
  const recorded = journal.recordStage("AGENT_LAUNCHED", {}, "2026-08-12T06:00:00.000Z");

  assert.equal(recorded.event.source, "MANUAL_WAKE");
  assert.equal(recorded.event.commandId, "40000000-0000-4000-8000-000000000001");
  assert.equal(recorded.event.bootId, undefined);
  assert.equal(recorded.event.eventKey, "40000000-0000-4000-8000-000000000001:AGENT_LAUNCHED");
})();

console.log("device recovery journal tests passed");
