import {
  claimedWecomPublishTaskSchema,
  type ClaimedWecomPublishTask
} from "@pkg/types";
import {
  publishInterfaceClaimRepository,
  type PublishInterfaceClaimRepository
} from "../repositories/publish-interface-claim.repository";
import {
  claimInterfacePublishTask,
  type InterfacePublishClaimResult,
  type WecomPublishClientConfig
} from "./wecom-publish-client";

const NO_MATERIAL_RETRY_MS = 10 * 60 * 1000;

export type AccountClaimOutcome =
  | { kind: "CLAIMED"; publishTaskId: string; externalTaskId: string }
  | { kind: "NO_MATERIAL"; nextRetryAt: Date }
  | { kind: "CLAIM_RESULT_UNKNOWN"; alertId: string }
  | { kind: "REJECTED"; retryable: boolean; code: string };

export type ClaimInterfaceAccountInput = {
  runId: string;
  configId: string;
  slotExecutionId: string;
  accountName: string;
  externalAccountKey: string;
  clientConfig: WecomPublishClientConfig;
  actor: string;
};

type ClaimServiceDependencies = {
  repository?: PublishInterfaceClaimRepository;
  claim?: (
    config: WecomPublishClientConfig,
    accountName: string
  ) => Promise<InterfacePublishClaimResult>;
  now?: () => Date;
};

export { type PublishInterfaceClaimRepository } from "../repositories/publish-interface-claim.repository";

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function validateClaimedTask(task: unknown, accountName: string) {
  const parsed = claimedWecomPublishTaskSchema.safeParse(task);
  if (!parsed.success) return { valid: false as const, code: "EXTERNAL_TASK_PAYLOAD_INVALID" };
  if (parsed.data.platform !== "抖音") {
    return { valid: false as const, code: "EXTERNAL_TASK_PLATFORM_MISMATCH" };
  }
  if (parsed.data.accountName !== accountName) {
    return { valid: false as const, code: "EXTERNAL_TASK_ACCOUNT_MISMATCH" };
  }
  if (parsed.data.status === "已发布") {
    return { valid: false as const, code: "EXTERNAL_TASK_STATUS_INVALID" };
  }
  return { valid: true as const, task: parsed.data as ClaimedWecomPublishTask };
}

export function createPublishInterfaceClaimService(dependencies: ClaimServiceDependencies = {}) {
  const repository = dependencies.repository ?? publishInterfaceClaimRepository;
  const claim = dependencies.claim ?? claimInterfacePublishTask;
  const now = dependencies.now ?? (() => new Date());

  async function reject(
    input: ClaimInterfaceAccountInput,
    code: string,
    retryable: boolean
  ): Promise<AccountClaimOutcome> {
    const occurredAt = now();
    await repository.recordRejected({
      slotExecutionId: input.slotExecutionId,
      code,
      retryable,
      nextRetryAt: retryable
        ? new Date(occurredAt.getTime() + NO_MATERIAL_RETRY_MS)
        : null,
      actor: input.actor,
      occurredAt
    });
    return { kind: "REJECTED", retryable, code };
  }

  return {
    async claimOne(input: ClaimInterfaceAccountInput): Promise<AccountClaimOutcome> {
      const existingAlertId = await repository.findClaimResultUnknownAlertId(
        input.slotExecutionId
      );
      if (existingAlertId) {
        return { kind: "CLAIM_RESULT_UNKNOWN", alertId: existingAlertId };
      }

      const result = await claim(input.clientConfig, input.externalAccountKey);
      if (result.kind === "NO_MATERIAL") {
        const nextRetryAt = new Date(now().getTime() + NO_MATERIAL_RETRY_MS);
        await repository.markNoMaterial(input.slotExecutionId, nextRetryAt, input.actor);
        return { kind: "NO_MATERIAL", nextRetryAt };
      }
      if (result.kind === "RESULT_UNKNOWN") {
        const isolated = await repository.markClaimResultUnknown({
          runId: input.runId,
          slotExecutionId: input.slotExecutionId,
          code: result.code,
          actor: input.actor,
          occurredAt: now()
        });
        return { kind: "CLAIM_RESULT_UNKNOWN", alertId: isolated.alertId };
      }
      if (result.kind === "REJECTED") {
        return reject(input, result.code, retryableStatus(result.status));
      }

      const validated = validateClaimedTask(result.task, input.accountName);
      if (!validated.valid) return reject(input, validated.code, false);
      const saved = await repository.saveClaimedTask({
        runId: input.runId,
        configId: input.configId,
        slotExecutionId: input.slotExecutionId,
        accountName: input.accountName,
        task: validated.task,
        actor: input.actor,
        claimedAt: now()
      });
      return { kind: "CLAIMED", ...saved };
    },

    async resolveClaimResultUnknown(input: {
      slotExecutionId: string;
      resolution: "SAFE_TO_RETRY";
      evidence: string;
      actor: string;
    }) {
      const evidence = input.evidence.trim();
      if (!evidence) throw new Error("CLAIM_RESULT_UNKNOWN_EVIDENCE_REQUIRED");
      const resolved = await repository.resolveClaimResultUnknown({
        ...input,
        evidence,
        resolvedAt: now()
      });
      return { resolved };
    }
  };
}

export const publishInterfaceClaimService = createPublishInterfaceClaimService();
