import {
  publishInterfaceReservationRepository,
  type PublishInterfaceReservationRepository
} from "../repositories/publish-interface-reservation.repository";

type ReservationServiceDependencies = {
  repository?: PublishInterfaceReservationRepository;
  now?: () => Date;
};

export function createPublishInterfaceReservationService(
  dependencies: ReservationServiceDependencies = {}
) {
  const repository = dependencies.repository ?? publishInterfaceReservationRepository;
  const now = dependencies.now ?? (() => new Date());

  return {
    async reconcile(runId: string, actor: string) {
      const currentTime = now();
      const candidates = await repository.listCandidates(runId, currentTime);
      const summary = {
        checked: candidates.length,
        reserved: 0,
        waitingOffline: 0,
        waitingBusy: 0
      };
      for (const candidate of candidates) {
        const nextRetryAt = new Date(
          currentTime.getTime() + candidate.noMaterialRetryMinutes * 60 * 1000
        );
        const result = await repository.reserveOne(candidate.id, currentTime, nextRetryAt, actor);
        if (result.kind === "RESERVED") summary.reserved += 1;
        if (result.kind === "DEVICE_OFFLINE") summary.waitingOffline += 1;
        if (result.kind === "DEVICE_BUSY") summary.waitingBusy += 1;
      }
      return summary;
    },

    async reconcileActiveRuns(actor: string) {
      const runIds = await repository.listActiveRunIds();
      const results = [];
      for (const runId of runIds) {
        results.push({ runId, ...(await this.reconcile(runId, actor)) });
      }
      return results;
    },

    async releaseAll(runId: string, actor: string) {
      const status = await repository.findRunStatus(runId);
      if (status !== "STOPPED") return { released: 0, deferred: true };
      return { released: await repository.releaseAll(runId, actor), deferred: false };
    }
  };
}

export const publishInterfaceReservationService = createPublishInterfaceReservationService();
