import type {
  InterfacePublishRunConfig,
  InterfacePublishSlot
} from "@pkg/types";
import {
  publishInterfaceSlotRepository,
  type EnsureInterfacePublishSlotsInput,
  type PublishInterfaceSlotRepository
} from "../repositories/publish-interface-slot.repository";
import {
  isInterfacePublishWindowExpired,
  resolveBusinessClock,
  resolveDueSlots
} from "./publish-interface-time.service";

export function createPublishInterfaceSlotService(
  repository: PublishInterfaceSlotRepository = publishInterfaceSlotRepository
) {
  return {
    ensureDailySlots(input: EnsureInterfacePublishSlotsInput) {
      return repository.ensureDailySlots(input);
    },

    async activateDueSlots(
      config: InterfacePublishRunConfig,
      bindingIds: string[],
      now: Date
    ) {
      const clock = resolveBusinessClock(now, config.timezone);
      const dueSlots = resolveDueSlots(config, now);
      for (const slot of dueSlots) {
        await repository.markEligible(bindingIds, clock.businessDate, slot);
      }
      return { businessDate: clock.businessDate, dueSlots };
    },

    async expireWindowSlots(
      bindingIds: string[],
      slot: InterfacePublishSlot,
      businessDate: string,
      now: Date
    ) {
      if (!isInterfacePublishWindowExpired(slot, businessDate, now)) return false;
      await repository.expire(bindingIds, businessDate, slot);
      return true;
    },

    markSlotPublished(slotExecutionId: string, publishedAt: Date) {
      const actualBusinessDate = resolveBusinessClock(publishedAt).businessDate;
      return repository.markPublished(slotExecutionId, publishedAt, actualBusinessDate);
    }
  };
}

export const publishInterfaceSlotService = createPublishInterfaceSlotService();
