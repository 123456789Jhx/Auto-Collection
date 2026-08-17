import type {
  InterfacePublishReservationStatus,
  InterfacePublishSlotStatus
} from "@pkg/types";
import { calculateFreePublishingSlots } from "./publish-interface-capacity.service";
import { businessDateInShanghai } from "./publish-interface-start-time";

export type SchedulerTickInput = {
  runId: string;
  now: Date;
  maxConcurrentPublishing: number;
};

export type SchedulerTickOutcome = {
  freeSlotsBefore: number;
  claimsAttempted: number;
  dispatched: number;
  noMaterial: number;
  waitingDevice: number;
};

export type PublishInterfaceSchedulerCandidate = {
  slotExecutionId: string;
  bindingId: string;
  accountName: string;
  externalAccountKey: string;
  priority: number;
  attemptCount: number;
  stableOrder: number;
  status: InterfacePublishSlotStatus;
  reservationStatus: InterfacePublishReservationStatus;
  nextRetryAt: Date | null;
};

export type PublishInterfaceCandidateOutcome = {
  kind:
    | "DISPATCHED"
    | "NO_MATERIAL"
    | "WAITING_DEVICE"
    | "CLAIM_RESULT_UNKNOWN"
    | "REJECTED";
};

type PublishInterfaceSchedulerDependencies = {
  getActivePublishingCount: (runId: string) => Promise<number>;
  listCandidates: (
    runId: string,
    now: Date
  ) => Promise<PublishInterfaceSchedulerCandidate[]>;
  executeCandidate: (
    candidate: PublishInterfaceSchedulerCandidate,
    input: SchedulerTickInput
  ) => Promise<PublishInterfaceCandidateOutcome>;
};

const ELIGIBLE_STATUSES = new Set<InterfacePublishSlotStatus>([
  "ELIGIBLE",
  "NO_MATERIAL",
  "DEVICE_UNAVAILABLE",
  "FAILED"
]);

function dayIndex(businessDate: string) {
  const parsed = Date.parse(`${businessDate}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
}

function rotate<T>(items: readonly T[], offset: number) {
  if (items.length < 2) return [...items];
  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

export function orderSchedulerCandidates(
  candidates: readonly PublishInterfaceSchedulerCandidate[],
  businessDate: string
) {
  const groups = new Map<string, PublishInterfaceSchedulerCandidate[]>();
  const ordered = [...candidates].sort((left, right) =>
    left.priority - right.priority
    || left.attemptCount - right.attemptCount
    || left.stableOrder - right.stableOrder
    || left.bindingId.localeCompare(right.bindingId)
  );
  for (const item of ordered) {
    const key = `${item.priority}:${item.attemptCount}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => rotate(group, dayIndex(businessDate)));
}

function isEligible(candidate: PublishInterfaceSchedulerCandidate, now: Date) {
  return candidate.reservationStatus === "RESERVED"
    && ELIGIBLE_STATUSES.has(candidate.status)
    && (!candidate.nextRetryAt || candidate.nextRetryAt.getTime() <= now.getTime());
}

function emptyOutcome(freeSlotsBefore: number): SchedulerTickOutcome {
  return {
    freeSlotsBefore,
    claimsAttempted: 0,
    dispatched: 0,
    noMaterial: 0,
    waitingDevice: 0
  };
}

export function createPublishInterfaceSchedulerCore(
  dependencies: PublishInterfaceSchedulerDependencies
) {
  return {
    async tick(input: SchedulerTickInput): Promise<SchedulerTickOutcome> {
      const activePublishingCount = await dependencies.getActivePublishingCount(input.runId);
      const freeSlotsBefore = calculateFreePublishingSlots(
        input.maxConcurrentPublishing,
        activePublishingCount
      );
      if (freeSlotsBefore === 0) return emptyOutcome(0);

      const candidates = (await dependencies.listCandidates(input.runId, input.now))
        .filter((candidate) => isEligible(candidate, input.now));
      if (candidates.length === 0) return emptyOutcome(freeSlotsBefore);

      const outcome = emptyOutcome(freeSlotsBefore);
      const businessDate = businessDateInShanghai(input.now);
      for (const candidate of orderSchedulerCandidates(candidates, businessDate)) {
        if (outcome.dispatched >= freeSlotsBefore) break;
        outcome.claimsAttempted += 1;
        const result = await dependencies.executeCandidate(candidate, input);
        if (result.kind === "DISPATCHED") outcome.dispatched += 1;
        if (result.kind === "NO_MATERIAL") outcome.noMaterial += 1;
        if (result.kind === "WAITING_DEVICE") outcome.waitingDevice += 1;
      }
      return outcome;
    }
  };
}
