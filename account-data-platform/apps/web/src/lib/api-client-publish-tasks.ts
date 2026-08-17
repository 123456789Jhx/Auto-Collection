import type { ManualPublishTestPayload } from "@pkg/types";
import { mutate, request } from "./api-client";

export type { ManualPublishTestPayload };

export type PublishTaskRow = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  expectedTopicCount: number;
  accountName: string;
  deviceCode: string | null;
  platform: string;
  status: string;
  source: string;
  mode: string;
  reportMode: string;
  reportStatus: string;
  reportAttempts: number;
  reportLastError: string | null;
  scheduledAt: string | null;
  scheduledSlot: string | null;
  resultError: string | null;
  failureCode: string | null;
  dispatchRetryCount: number;
  nextDispatchAt: string | null;
  lastDispatchAttemptAt: string | null;
  matchNote: string | null;
  publishedUrl: string | null;
  claimedAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  reportedAt: string | null;
  updatedAt: string;
};

export type PublishTaskDashboard = {
  data: PublishTaskRow[];
  stats: {
    success: number;
    unpublished: number;
    unmatched: number;
    busy: number;
    topicPending: number;
    materialInvalid: number;
    channelsVerifyPending: number;
    reportFailed: number;
  };
};

export function getPublishTaskDashboard() {
  return request<PublishTaskDashboard>("/admin/publish-tasks");
}

export function completePublishTaskTopics(id: string, description: string) {
  return mutate<PublishTaskRow>(
    `/admin/publish-tasks/${encodeURIComponent(id)}/topics`,
    { description }
  );
}

export function dispatchExistingPublishTask(taskId: string) {
  return mutate<{ outcome: string; task: PublishTaskRow }>(
    "/admin/publish-tasks/" + encodeURIComponent(taskId) + "/dispatch-single",
    {}
  );
}

export function createManualPublishTest(payload: ManualPublishTestPayload) {
  return mutate<{
    task: PublishTaskRow;
    command: { id: string; commandType: string; status: string };
    idempotent: boolean;
  }>("/admin/publish-tasks/manual-test", payload);
}
