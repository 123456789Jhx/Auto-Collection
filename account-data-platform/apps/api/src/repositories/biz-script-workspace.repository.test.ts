import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { agentVersions } from "@pkg/db/schema";
import { db } from "./db";
import { savePreview, transitionPreview, type StoredBizScriptPreview } from "./biz-script-workspace.repository";

const preview: StoredBizScriptPreview = {
  id: "00000000-0000-4000-8000-000000000001", version: "20260910.2", stage: "DRAFT", revision: 0,
  baselineVersion: "20260910.1", apkBuildId: "APK-1", baseCompatibilityId: "a".repeat(64),
  sourceSha256: "b".repeat(64), packageSha256: "c".repeat(64), sizeBytes: 3,
  files: [], changes: { added: [], modified: [], removed: [] }, releaseNote: "",
  createdAt: "2026-09-10T09:00:00Z", testDeviceIds: [], deviceIds: [], archiveBase64: "YWJj"
};

afterEach(() => { for (const spy of spies) spy.mockRestore(); spies.length = 0; });
const spies: Array<{ mockRestore(): void }> = [];

function fakeTransaction(rows: unknown[][]) {
  const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const updateValues: Array<Record<string, unknown>> = [];
  let lockTaken = false;
  const query = () => {
    const result = rows.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "orderBy", "innerJoin"]) chain[method] = () => chain;
    chain.for = () => { lockTaken = true; return chain; };
    chain.then = (resolve: (value: unknown[]) => void) => resolve(result);
    chain.returning = () => Promise.resolve(result);
    return chain;
  };
  const transaction = {
    execute: async () => { lockTaken = true; },
    select: () => query(),
    insert: (table: unknown) => ({ values: async (value: Record<string, unknown>) => {
      if (!lockTaken) throw new Error("lock must precede writes");
      writes.push({ table, value });
    } }),
    update: () => ({ set: (value: Record<string, unknown>) => { updateValues.push(value); return query(); } })
  };
  const spy = spyOn(db, "transaction").mockImplementation(async (run) => run(transaction as never));
  spies.push(spy);
  return { writes, updateValues };
}

describe("business preview persistence transaction", () => {
  test("persists an immutable archive with its draft version and creation audit", async () => {
    const fixture = fakeTransaction([[{ version: "20260910.1" }]]);
    await savePreview(preview, "operator");
    expect(fixture.writes).toHaveLength(4);
    expect(fixture.writes.find((write) => write.table === agentVersions)?.value).toMatchObject({
      id: preview.id, version: "20260910.2", channel: "biz-scripts", status: "DRAFT", createdBy: "operator"
    });
    expect(fixture.writes.filter((write) => "archiveBase64" in write.value)).toHaveLength(1);
    expect(fixture.writes.find((write) => "archiveBase64" in write.value)?.value.archiveBase64).toBe("YWJj");
  });

  test("rejects numerically older or equal versions before any row is written", async () => {
    const fixture = fakeTransaction([[{ version: "20260910.10" }]]);
    await expect(savePreview(preview, "operator")).rejects.toThrow("VERSION_CONFLICT");
    expect(fixture.writes).toHaveLength(0);
  });

  test("rejects a stale revision before changing the delivery scope", async () => {
    const fixture = fakeTransaction([[{ ...preview, previewJson: preview, revision: 1, stage: "TESTING" }]]);
    await expect(transitionPreview(preview.id, 0, "REVOKED", ["device-1"], [], "operator")).rejects.toThrow("REVISION_CONFLICT");
    expect(fixture.updateValues).toHaveLength(0);
  });

  test("moves the revision, explicit scope, companion publish status and audit together", async () => {
    const stored = { ...preview, previewJson: preview };
    const next = { ...stored, revision: 1, stage: "TESTING", testDeviceIds: ["device-1"] };
    const fixture = fakeTransaction([[stored], [next], []]);
    const result = await transitionPreview(preview.id, 0, "TESTING", ["device-1"], [], "operator");
    expect(result).toMatchObject({ stage: "TESTING", revision: 1, testDeviceIds: ["device-1"] });
    expect(fixture.updateValues).toContainEqual(expect.objectContaining({ status: "PUBLISHED" }));
    expect(fixture.writes.at(-1)?.value).toMatchObject({ revision: 1, stage: "TESTING", actor: "operator" });
  });
});
