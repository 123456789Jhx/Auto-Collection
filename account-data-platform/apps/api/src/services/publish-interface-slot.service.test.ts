import { describe, expect, test } from "bun:test";
import type {
  EnsureInterfacePublishSlotsInput,
  InterfacePublishSlotRow,
  PublishInterfaceSlotRepository
} from "../repositories/publish-interface-slot.repository";
import { createPublishInterfaceSlotService } from "./publish-interface-slot.service";

const bindingId = "11111111-1111-4111-8111-111111111111";
const firstRunId = "22222222-2222-4222-8222-222222222222";
const secondRunId = "33333333-3333-4333-8333-333333333333";

function fakeRepository() {
  const rows = new Map<string, InterfacePublishSlotRow>();
  const key = (date: string, binding: string, slot: string) => `${date}:DOUYIN:${binding}:${slot}`;
  const repository: PublishInterfaceSlotRepository = {
    async ensureDailySlots(input: EnsureInterfacePublishSlotsInput) {
      for (const binding of input.bindings) {
        for (const slot of ["MORNING", "AFTERNOON"] as const) {
          const rowKey = key(input.businessDate, binding.bindingId, slot);
          if (!rows.has(rowKey)) {
            rows.set(rowKey, {
              id: crypto.randomUUID(),
              runId: input.runId,
              bindingId: binding.bindingId,
              businessDate: input.businessDate,
              slot,
              status: "WAITING",
              publishedAt: null
            });
          }
        }
      }
      return [...rows.values()].filter((row) =>
        row.businessDate === input.businessDate
        && input.bindings.some((binding) => binding.bindingId === row.bindingId)
      );
    },
    async markEligible(bindingIds, businessDate, slot) {
      for (const binding of bindingIds) {
        const row = rows.get(key(businessDate, binding, slot));
        if (row?.status === "WAITING") row.status = "ELIGIBLE";
      }
    },
    async expire(bindingIds, businessDate, slot) {
      for (const binding of bindingIds) {
        const row = rows.get(key(businessDate, binding, slot));
        if (row && ["WAITING", "ELIGIBLE", "NO_MATERIAL", "DEVICE_UNAVAILABLE", "FAILED"].includes(row.status)) {
          row.status = "WINDOW_EXPIRED";
        }
      }
    },
    async markPublished(slotExecutionId, publishedAt, actualBusinessDate) {
      const original = [...rows.values()].find((row) => row.id === slotExecutionId)!;
      if (original.businessDate === actualBusinessDate) {
        original.status = "PUBLISHED";
        original.publishedAt = publishedAt;
        return { original, credited: original };
      }
      original.status = "WINDOW_EXPIRED";
      const nextKey = key(actualBusinessDate, original.bindingId, "MORNING");
      let credited = rows.get(nextKey);
      if (!credited) {
        credited = {
          id: crypto.randomUUID(),
          runId: original.runId,
          bindingId: original.bindingId,
          businessDate: actualBusinessDate,
          slot: "MORNING",
          status: "WAITING",
          publishedAt: null
        };
        rows.set(nextKey, credited);
      }
      credited.status = "PUBLISHED";
      credited.publishedAt = publishedAt;
      return { original, credited };
    }
  };
  return { repository, rows, key };
}

describe("interface publish daily slot ledger", () => {
  test("ensures only one morning and one afternoon row per binding and date", async () => {
    const fake = fakeRepository();
    const service = createPublishInterfaceSlotService(fake.repository);
    const input = { runId: firstRunId, businessDate: "2026-08-06", bindings: [{ bindingId }] };
    await service.ensureDailySlots(input);
    await service.ensureDailySlots(input);
    expect(fake.rows.size).toBe(2);
    expect([...fake.rows.values()].filter((row) => row.slot === "MORNING")).toHaveLength(1);
  });

  test("expires morning without adding its quota to afternoon", async () => {
    const fake = fakeRepository();
    const service = createPublishInterfaceSlotService(fake.repository);
    await service.ensureDailySlots({ runId: firstRunId, businessDate: "2026-08-06", bindings: [{ bindingId }] });
    await service.expireWindowSlots(
      [bindingId],
      "MORNING",
      "2026-08-06",
      new Date("2026-08-06T04:00:00.000Z")
    );
    expect(fake.rows.get(fake.key("2026-08-06", bindingId, "MORNING"))?.status).toBe("WINDOW_EXPIRED");
    expect([...fake.rows.values()].filter((row) => row.slot === "AFTERNOON")).toHaveLength(1);
    expect(fake.rows.get(fake.key("2026-08-06", bindingId, "AFTERNOON"))?.status).toBe("WAITING");
  });

  test("does not reset a published daily slot when a second run starts", async () => {
    const fake = fakeRepository();
    const service = createPublishInterfaceSlotService(fake.repository);
    const first = await service.ensureDailySlots({
      runId: firstRunId,
      businessDate: "2026-08-06",
      bindings: [{ bindingId }]
    });
    const morning = first.find((row) => row.slot === "MORNING")!;
    await service.markSlotPublished(morning.id, new Date("2026-08-06T01:10:00.000Z"));
    await service.ensureDailySlots({
      runId: secondRunId,
      businessDate: "2026-08-06",
      bindings: [{ bindingId }]
    });
    expect(fake.rows.size).toBe(2);
    expect(fake.rows.get(fake.key("2026-08-06", bindingId, "MORNING"))?.status).toBe("PUBLISHED");
  });

  test("credits a cross-midnight success to next morning and leaves prior fallback incomplete", async () => {
    const fake = fakeRepository();
    const service = createPublishInterfaceSlotService(fake.repository);
    const first = await service.ensureDailySlots({
      runId: firstRunId,
      businessDate: "2026-08-06",
      bindings: [{ bindingId }]
    });
    const afternoon = first.find((row) => row.slot === "AFTERNOON")!;
    const result = await service.markSlotPublished(
      afternoon.id,
      new Date("2026-08-06T16:05:00.000Z")
    );
    expect(result.original.status).toBe("WINDOW_EXPIRED");
    expect(result.credited).toMatchObject({
      businessDate: "2026-08-07",
      slot: "MORNING",
      status: "PUBLISHED"
    });
  });
});
