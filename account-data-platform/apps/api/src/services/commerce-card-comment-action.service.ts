import {
  commerceCardWorkflowSnapshotSchema,
  type ReserveCommerceCardCommentActionPayload,
  type ResolveCommerceCardCommentActionPayload,
  type UpdateCommerceCardCommentActionPayload
} from "@pkg/types";
import { createHash, randomBytes } from "node:crypto";
import {
  findCommerceCardCommentActionByKey,
  reserveCommerceCardCommentActionAtomic,
  resolveCommerceCardCommentActionAtomic,
  updateCommerceCardCommentActionAtomic
} from "../repositories/commerce-card-execution.repository";
import { resolveDeviceByToken } from "../repositories/device.repository";
import { AssignmentRuntimeError, findTaskAssignmentById } from "../repositories/task-assignment.repository";
import { commerceCardAccountIdentityKey } from "./commerce-card-execution-approval.service";
import { evaluateFeatureRolloutForDevice } from "./feature-rollout-control.service";
import {
  buildCanonicalSha256,
  buildCommerceCardCommentPoolHash
} from "./live-target-config.service";

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hongKongDayStart(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - 8 * 60 * 60 * 1000);
}

async function resolveOwnedAssignment(assignmentId: string, deviceCode: string, deviceToken?: string) {
  const device = await resolveDeviceByToken({
    deviceToken: deviceToken || "",
    expectedDeviceCode: deviceCode
  });
  const assignment = await findTaskAssignmentById(assignmentId);
  if (!assignment || assignment.deviceId !== device.id) {
    throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
  }
  return { assignment, device };
}

function expectedCommentIdempotencyKey(input: {
  assignmentId: string;
  targetId: string;
  expectedAccountId: string | null;
  roomKeyVersion: number;
  roomKey: string;
  commentSlot: number;
}) {
  return `cc:${buildCanonicalSha256(input)}`;
}

export async function reserveCommentAction(
  assignmentId: string,
  payload: ReserveCommerceCardCommentActionPayload,
  deviceToken?: string
) {
  const { assignment, device } = await resolveOwnedAssignment(assignmentId, payload.deviceId, deviceToken);
  const rollout = await evaluateFeatureRolloutForDevice("commerce_card_real_comment", device.deviceCode);
  if (!rollout.allowed) {
    throw new AssignmentRuntimeError("REAL_COMMENT_ROLLOUT_REJECTED", { reasons: rollout.reasons });
  }
  if (!assignment.selectedTargetId) {
    throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INCOMPLETE");
  }
  const snapshot = commerceCardWorkflowSnapshotSchema.safeParse(assignment.configSnapshot);
  if (!snapshot.success) {
    throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INVALID");
  }
  const normalizedReply = payload.replyText.replace(/\s+/g, " ").trim();
  if (!snapshot.data.runtimeConfig.commentPool.includes(normalizedReply)) {
    throw new AssignmentRuntimeError("COMMENT_NOT_IN_APPROVED_POOL");
  }
  if (sha256Text(normalizedReply) !== payload.commentHash) {
    throw new AssignmentRuntimeError("COMMENT_HASH_MISMATCH");
  }
  const currentAccountIdentity = commerceCardAccountIdentityKey(
    payload.currentAccountId,
    payload.currentAccountName
  );
  const expectedIdempotencyKey = expectedCommentIdempotencyKey({
    assignmentId: assignment.id,
    targetId: assignment.selectedTargetId,
    expectedAccountId: assignment.expectedAccountId ?? null,
    roomKeyVersion: payload.roomKeyVersion,
    roomKey: payload.roomKey,
    commentSlot: payload.commentSlot
  });
  if (payload.idempotencyKey !== expectedIdempotencyKey) {
    throw new AssignmentRuntimeError("COMMENT_IDEMPOTENCY_KEY_INVALID", {
      expectedIdempotencyKey
    });
  }

  const permitToken = randomBytes(32).toString("base64url");
  const permitExpiresAt = new Date(Date.now() + 30 * 1000);
  const result = await reserveCommerceCardCommentActionAtomic({
    assignmentId,
    deviceId: device.id,
    expectedStateVersion: payload.expectedStateVersion,
    currentAccountIdentity,
    roomKeyVersion: payload.roomKeyVersion,
    roomKey: payload.roomKey,
    commentSlot: payload.commentSlot,
    commentHash: payload.commentHash,
    replyText: normalizedReply,
    idempotencyKey: payload.idempotencyKey,
    permitTokenHash: sha256Text(permitToken),
    permitExpiresAt,
    commentPoolHash: buildCommerceCardCommentPoolHash(snapshot.data.runtimeConfig.commentPool),
    dayStart: hongKongDayStart()
  });
  return {
    action: result.action,
    assignment: result.assignment,
    idempotent: result.idempotent,
    permitToken: result.permitIssued ? permitToken : null,
    permitExpiresAt: result.permitIssued ? permitExpiresAt.toISOString() : null
  };
}

export async function updateCommentAction(
  assignmentId: string,
  actionId: string,
  payload: UpdateCommerceCardCommentActionPayload,
  deviceToken?: string
) {
  const { device } = await resolveOwnedAssignment(assignmentId, payload.deviceId, deviceToken);
  return updateCommerceCardCommentActionAtomic({
    assignmentId,
    actionId,
    deviceId: device.id,
    expectedActionStateVersion: payload.expectedActionStateVersion,
    nextState: payload.state,
    permitTokenHash: payload.permitToken ? sha256Text(payload.permitToken) : undefined,
    failureReason: payload.failureReason,
    evidence: payload.evidence,
    payloadHash: buildCanonicalSha256(payload),
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date()
  });
}

export async function getCommentActionByKey(
  assignmentId: string,
  idempotencyKey: string,
  deviceCode: string,
  deviceToken?: string
) {
  const { device } = await resolveOwnedAssignment(assignmentId, deviceCode, deviceToken);
  const action = await findCommerceCardCommentActionByKey({
    assignmentId,
    deviceId: device.id,
    idempotencyKey
  });
  if (!action) {
    throw new AssignmentRuntimeError("COMMENT_ACTION_NOT_FOUND");
  }
  return action;
}

export async function resolveCommentAction(
  actionId: string,
  payload: ResolveCommerceCardCommentActionPayload,
  actor: string
) {
  return resolveCommerceCardCommentActionAtomic({
    actionId,
    expectedActionStateVersion: payload.expectedActionStateVersion,
    resolution: payload.resolution,
    evidence: payload.evidence,
    actor,
    payloadHash: buildCanonicalSha256(payload)
  });
}
