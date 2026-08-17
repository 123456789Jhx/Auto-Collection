import type { InterfacePublishSlotStatus } from "@pkg/types";

const ACTIVE_PHONE_PUBLISHING_STATUSES = new Set<InterfacePublishSlotStatus>([
  "DISPATCHED",
  "PUBLISHING"
]);

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function calculateFreePublishingSlots(
  maxConcurrentPublishing: number,
  activePublishingCount: number
) {
  return Math.max(
    0,
    nonNegativeInteger(maxConcurrentPublishing) - nonNegativeInteger(activePublishingCount)
  );
}

export function calculatePublishingCapacity(
  maxConcurrentPublishing: number,
  slotStatuses: readonly InterfacePublishSlotStatus[]
) {
  const activePublishingCount = slotStatuses.filter((status) =>
    ACTIVE_PHONE_PUBLISHING_STATUSES.has(status)
  ).length;
  return {
    activePublishingCount,
    freeSlots: calculateFreePublishingSlots(maxConcurrentPublishing, activePublishingCount)
  };
}
