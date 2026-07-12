import type {
  CreateCommerceCardExecutionApprovalPayload,
  RevokeCommerceCardExecutionApprovalPayload
} from "@pkg/types";
import { config } from "../config";
import {
  createCommerceCardExecutionApproval,
  findCommerceCardExecutionApprovalById,
  listCommerceCardExecutionApprovals,
  revokeCommerceCardExecutionApprovalAtomic
} from "../repositories/commerce-card-execution.repository";
import { findDeviceByCode } from "../repositories/device.repository";
import { getCommerceCardFeaturePreviewData } from "../repositories/live-target.repository";
import { AssignmentRuntimeError } from "../repositories/task-assignment.repository";
import { buildCommerceCardCommentPoolHash } from "./live-target-config.service";

export function commerceCardAccountIdentityKey(accountId: string | null | undefined, accountName: string | null | undefined) {
  const normalizedId = String(accountId || "").trim();
  if (normalizedId) {
    return normalizedId;
  }
  const normalizedName = String(accountName || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedName) {
    throw new AssignmentRuntimeError("EXPECTED_ACCOUNT_REQUIRED");
  }
  return `name:${normalizedName}`;
}

export async function createExecutionApproval(
  payload: CreateCommerceCardExecutionApprovalPayload,
  actor: string
) {
  const [device, preview] = await Promise.all([
    findDeviceByCode(payload.deviceCode),
    getCommerceCardFeaturePreviewData(payload.targetId)
  ]);
  if (!device) {
    throw new AssignmentRuntimeError("DEVICE_UNREGISTERED");
  }
  if (!preview) {
    throw new AssignmentRuntimeError("COMMERCE_CARD_FEATURE_NOT_FOUND");
  }
  if (!preview.runtimeConfig.enabledStages.includes("target_comment")) {
    throw new AssignmentRuntimeError("TARGET_COMMENT_STAGE_DISABLED");
  }
  if (payload.maxCommentsPerRoom > preview.runtimeConfig.maxCommentsPerRoom) {
    throw new AssignmentRuntimeError("APPROVAL_ROOM_LIMIT_EXCEEDS_CONFIG", {
      configuredLimit: preview.runtimeConfig.maxCommentsPerRoom
    });
  }
  const validFrom = payload.validFrom ? new Date(payload.validFrom) : new Date();
  const expiresAt = new Date(payload.expiresAt);
  if (expiresAt.getTime() <= validFrom.getTime()) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_TIME_INVALID");
  }
  const accountIdentity = commerceCardAccountIdentityKey(payload.expectedAccountId, payload.expectedAccountName);
  return createCommerceCardExecutionApproval({
    tenantId: config.tenantId,
    targetId: payload.targetId,
    deviceId: device.id,
    expectedAccountId: accountIdentity,
    expectedAccountName: payload.expectedAccountName,
    configHash: preview.configHash,
    commentPoolHash: buildCommerceCardCommentPoolHash(preview.runtimeConfig.commentPool),
    maxCommentsPerRoom: payload.maxCommentsPerRoom,
    totalQuota: payload.totalQuota,
    consumedQuota: 0,
    accountDailyLimit: payload.accountDailyLimit,
    targetDailyLimit: payload.targetDailyLimit,
    cooldownSeconds: payload.cooldownSeconds,
    status: "ACTIVE",
    revision: 1,
    validFrom,
    expiresAt,
    approvedBy: actor,
    approvedAt: new Date(),
    reason: payload.reason,
    createdBy: actor,
    updatedBy: actor
  });
}

export async function getExecutionApprovals() {
  return listCommerceCardExecutionApprovals();
}

export async function revokeExecutionApproval(
  approvalId: string,
  payload: RevokeCommerceCardExecutionApprovalPayload,
  actor: string
) {
  return revokeCommerceCardExecutionApprovalAtomic({
    approvalId,
    expectedRevision: payload.expectedRevision,
    actor,
    reason: payload.reason
  });
}

export async function assertExecutionApprovalMatches(input: {
  approvalId: string;
  targetId: string;
  deviceId: string;
  expectedAccountId: string;
  configHash: string;
  commentPoolHash: string;
}) {
  const approval = await findCommerceCardExecutionApprovalById(input.approvalId);
  if (!approval) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_NOT_FOUND");
  }
  const now = Date.now();
  if (
    approval.status !== "ACTIVE" ||
    approval.validFrom.getTime() > now ||
    approval.expiresAt.getTime() <= now ||
    approval.consumedQuota >= approval.totalQuota
  ) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_INACTIVE", { status: approval.status });
  }
  if (
    approval.targetId !== input.targetId ||
    approval.deviceId !== input.deviceId ||
    approval.expectedAccountId !== input.expectedAccountId ||
    approval.configHash !== input.configHash ||
    approval.commentPoolHash !== input.commentPoolHash
  ) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_SCOPE_MISMATCH");
  }
  return approval;
}

