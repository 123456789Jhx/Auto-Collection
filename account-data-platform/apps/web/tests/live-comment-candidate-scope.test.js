import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeLiveCommentCandidates } from "../src/lib/live-comment-candidate-scope.ts";

const scope = { batchId: "batch-a", deviceId: "device-a", roomKey: "room-a" };

function candidate(id, sourcesJson, overrides = {}) {
  return {
    id,
    batchId: "batch-a",
    commentText: `Comment ${id}`,
    status: "PENDING",
    sourcesJson,
    ...overrides
  };
}

test("includes only candidates from the current batch, device and room", () => {
  const rows = [
    candidate("current", [{ deviceId: "device-a", roomKey: "room-a" }]),
    candidate("other-room", [{ deviceId: "device-a", roomKey: "room-b" }]),
    candidate("other-device", [{ deviceId: "device-b", roomKey: "room-a" }]),
    candidate("other-batch", [{ deviceId: "device-a", roomKey: "room-a" }], { batchId: "batch-b" })
  ];

  assert.deepEqual(scopeLiveCommentCandidates(rows, scope).map((row) => row.id), ["current"]);
});

test("requires the device and room to match within the same source", () => {
  const rows = [candidate("split-match", [
    { deviceId: "device-a", roomKey: "room-b" },
    { deviceId: "device-b", roomKey: "room-a" }
  ])];

  assert.deepEqual(scopeLiveCommentCandidates(rows, scope), []);
});

test("keeps shared candidates with only their current room sources", () => {
  const rows = [candidate("shared", [
    { deviceId: "device-a", roomKey: "room-b", pageIndex: 1, userName: "Other room" },
    { deviceId: "device-a", roomKey: "room-a", pageIndex: 2, userName: "First user" },
    { deviceId: "device-b", roomKey: "room-a", pageIndex: 3, userName: "Other device" },
    { deviceId: "device-a", roomKey: "room-a", pageIndex: 4, userName: "Second user" }
  ], { commentText: "  Original comment\ntext  ", status: "IMPORTED" })];

  assert.deepEqual(scopeLiveCommentCandidates(rows, scope), [{
    id: "shared",
    batchId: "batch-a",
    commentText: "  Original comment\ntext  ",
    status: "IMPORTED",
    sourcesJson: [
      { deviceId: "device-a", roomKey: "room-a", pageIndex: 2, userName: "First user" },
      { deviceId: "device-a", roomKey: "room-a", pageIndex: 4, userName: "Second user" }
    ]
  }]);
});

test("fails closed when any scope field is empty or missing", () => {
  const rows = [candidate("current", [{ deviceId: "device-a", roomKey: "room-a" }])];

  for (const field of ["batchId", "deviceId", "roomKey"]) {
    for (const value of ["", undefined, null]) {
      assert.deepEqual(scopeLiveCommentCandidates(rows, { ...scope, [field]: value }), []);
    }
  }
});

test("excludes candidates with no complete matching source", () => {
  const rows = [
    candidate("no-sources", []),
    candidate("no-device", [{ roomKey: "room-a" }]),
    candidate("no-room", [{ deviceId: "device-a" }]),
    candidate("empty-source", [{}])
  ];

  assert.deepEqual(scopeLiveCommentCandidates(rows, scope), []);
});

test("returns copied candidates and source arrays without changing the input", () => {
  const rows = [candidate("shared", [
    { deviceId: "device-a", roomKey: "room-a", pageIndex: 1 },
    { deviceId: "device-a", roomKey: "room-b", pageIndex: 2 }
  ])];
  const original = JSON.parse(JSON.stringify(rows));
  for (const row of rows) {
    for (const source of row.sourcesJson) Object.freeze(source);
    Object.freeze(row.sourcesJson);
    Object.freeze(row);
  }
  Object.freeze(rows);

  const result = scopeLiveCommentCandidates(rows, scope);

  assert.deepEqual(rows, original);
  assert.equal(result.length, 1);
  assert.notEqual(result, rows);
  assert.notEqual(result[0], rows[0]);
  assert.notEqual(result[0].sourcesJson, rows[0].sourcesJson);
  assert.equal(result[0].status, "PENDING");
  assert.deepEqual(result[0].sourcesJson, [{ deviceId: "device-a", roomKey: "room-a", pageIndex: 1 }]);
});
