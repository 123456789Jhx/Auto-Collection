const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishTaskLock } = require("../domain/publish-task-lock.js");

function createStorage(values) {
  return {
    get(key, fallback) { return Object.hasOwn(values, key) ? values[key] : fallback; },
    put(key, value) { values[key] = value; },
    remove(key) { delete values[key]; }
  };
}

test("异常未来时间戳不会永久阻塞新发布任务", () => {
  const now = 1_000_000;
  const values = {
    active: { ownerId: "future-owner", timestamp: now + 60 * 60 * 1000 }
  };
  const lock = createPublishTaskLock({
    storage: createStorage(values),
    now: () => now,
    ownerId: "current-owner"
  });

  assert.equal(lock.acquire({ taskId: "task-current", commandId: "command-current" }), true);
  assert.deepEqual(values.active, {
    ownerId: "current-owner",
    taskId: "task-current",
    commandId: "command-current",
    acquiredAt: now,
    expiresAt: now + 15 * 60 * 1000,
    timestamp: now
  });
});

test("有效锁返回持有任务信息，过期旧格式锁允许接管", () => {
  let now = 2_000_000;
  const values = {};
  const first = createPublishTaskLock({ storage: createStorage(values), now: () => now, ownerId: "first" });
  const second = createPublishTaskLock({ storage: createStorage(values), now: () => now, ownerId: "second" });

  assert.equal(first.acquire({ taskId: "task-first", commandId: "command-first" }), true);
  assert.equal(second.acquire({ taskId: "task-second", commandId: "command-second" }), false);
  assert.deepEqual(second.inspect(), values.active);

  values.active = { ownerId: "legacy", timestamp: now - 15 * 60 * 1000 - 1 };
  assert.equal(second.acquire({ taskId: "task-second", commandId: "command-second" }), true);
  assert.equal(values.active.taskId, "task-second");
});
