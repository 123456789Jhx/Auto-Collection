const assert = require("node:assert/strict");
const { createDeviceRecoveryJournal } = require("../app/device-recovery-journal.js");
const { createDeviceRecoverySync } = require("../app/device-recovery-sync.js");

function memoryStorage() {
  const values = new Map();
  return {
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    put(key, value) { values.set(key, value); }
  };
}

function journal() {
  return createDeviceRecoveryJournal({
    storage: memoryStorage(),
    bootId: "boot-sync",
    now: () => "2026-08-12T06:00:10.000Z"
  });
}

(function flushesPendingEventsInOccurrenceOrder() {
  const local = journal();
  local.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T06:00:00.000Z");
  local.recordStage("NETWORK_CONNECTED", {}, "2026-08-12T06:00:03.000Z");
  const sent = [];
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "device-mi8",
    send: (payload) => { sent.push(payload); return { success: true, statusCode: 202 }; },
    now: () => 1000,
    isoNow: () => "2026-08-12T06:00:10.000Z"
  });

  const result = sync.flush(true);

  assert.equal(result.success, true);
  assert.deepEqual(sent.map((event) => event.stage), ["SYSTEM_BOOTED", "NETWORK_CONNECTED"]);
  assert.equal(sent[0].deviceId, "device-mi8");
  assert.equal(sent[0].reportedAt, "2026-08-12T06:00:10.000Z");
  assert.equal(local.listPending().length, 0);
})();

(function retainsFailedAndLaterEventsForRetry() {
  const local = journal();
  local.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T06:00:00.000Z");
  local.recordStage("NETWORK_CONNECTED", {}, "2026-08-12T06:00:03.000Z");
  let calls = 0;
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "device-mi8",
    send: () => ({ success: ++calls < 2 }),
    now: () => 1000
  });

  const result = sync.flush(true);

  assert.equal(result.success, false);
  assert.equal(result.uploadedCount, 1);
  assert.deepEqual(local.listPending().map((event) => event.stage), ["NETWORK_CONNECTED"]);
})();

(function throttlesAutomaticRetriesButAllowsAForcedFlush() {
  const local = journal();
  local.recordStage("SYSTEM_BOOTED", {}, "2026-08-12T06:00:00.000Z");
  let currentTime = 1000;
  let calls = 0;
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "device-mi8",
    send: () => { calls += 1; return { success: false }; },
    now: () => currentTime,
    retryIntervalMs: 30000
  });

  sync.flush(false);
  currentTime = 2000;
  const throttled = sync.flush(false);
  const forced = sync.flush(true);

  assert.equal(throttled.skipped, "retry_interval");
  assert.equal(calls, 2);
  assert.equal(forced.success, false);
})();

(function waitsForDeviceAuthenticationWithoutDroppingEvents() {
  const local = journal();
  local.recordStage("AGENT_LAUNCHED", {}, "2026-08-12T06:00:01.000Z");
  let sent = false;
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "",
    send: () => { sent = true; return { success: true }; }
  });

  const result = sync.flush(true);

  assert.equal(result.skipped, "device_unavailable");
  assert.equal(sent, false);
  assert.equal(local.listPending().length, 1);
})();

(function repeatedMilestonesRespectTheRetryInterval() {
  const local = journal();
  let currentTime = 1000;
  let calls = 0;
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "device-mi8",
    send: () => { calls += 1; return { success: false }; },
    now: () => currentTime,
    retryIntervalMs: 30000
  });

  sync.recordStage("HEARTBEAT_RESTORED", {}, undefined, true);
  currentTime = 2000;
  const repeated = sync.recordStage("HEARTBEAT_RESTORED", {}, undefined, true);

  assert.equal(repeated.recorded.created, false);
  assert.equal(repeated.flushed.skipped, "retry_interval");
  assert.equal(calls, 1);
})();

(function uploadsManualWakeIdentityWithoutABootId() {
  const local = journal();
  local.startManualWake({ commandId: "40000000-0000-4000-8000-000000000002", channel: "AGENT_POLL" });
  local.recordStage("AGENT_LAUNCHED", {}, "2026-08-12T06:00:01.000Z");
  let sent;
  const sync = createDeviceRecoverySync({
    journal: local,
    deviceId: () => "device-mi8",
    send: (payload) => { sent = payload; return { success: true }; }
  });

  sync.flush(true);

  assert.equal(sent.source, "MANUAL_WAKE");
  assert.equal(sent.commandId, "40000000-0000-4000-8000-000000000002");
  assert.equal(sent.channel, "AGENT_POLL");
  assert.equal(sent.bootId, undefined);
})();

console.log("device recovery sync tests passed");
