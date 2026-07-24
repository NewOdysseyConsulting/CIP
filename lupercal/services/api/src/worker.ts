import {
  type CipControlPlane,
  type CipEventBatch,
} from "@new-odyssey/cip";

import type { ControlPlaneServiceStore, WorkerProcessResult } from "./types.js";

const nextRetryAt = (attemptCount: number): string => {
  const delaySeconds = Math.min(60, 2 ** Math.max(attemptCount, 0));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
};

const eventRecordId = (jobId: string, index: number): string =>
  `ingest:${jobId}:${index + 1}`;

const processBatch = async (
  controlPlane: CipControlPlane,
  batch: CipEventBatch,
  jobId: string,
): Promise<void> => {
  for (const [index, event] of batch.events.entries()) {
    const id = eventRecordId(jobId, index);
    if (event.kind === "run_event") {
      await controlPlane.appendRunEvent({
        id,
        sessionId: batch.sessionId,
        type: event.type,
        ...(event.actor === undefined ? {} : { actor: event.actor }),
        ...(event.assertedActor === undefined
          ? {}
          : { assertedActor: event.assertedActor }),
        ...(event.actorVerification === undefined
          ? {}
          : { actorVerification: event.actorVerification }),
        ...(event.payload === undefined ? {} : { payload: event.payload }),
        ...(event.traceCorrelation === undefined
          ? {}
          : { traceCorrelation: event.traceCorrelation }),
        ...(event.occurredAt === undefined
          ? {}
          : { occurredAt: event.occurredAt }),
      });
      continue;
    }

    await controlPlane.appendAuditEvent({
      id,
      tenantId: batch.tenantId,
      sessionId: batch.sessionId,
      category: event.category,
      action: event.action,
      actor: event.actor,
      ...(event.assertedActor === undefined
        ? {}
        : { assertedActor: event.assertedActor }),
      ...(event.actorVerification === undefined
        ? {}
        : { actorVerification: event.actorVerification }),
      payload: event.payload,
      ...(event.deploymentId === undefined
        ? {}
        : { deploymentId: event.deploymentId }),
      ...(event.severity === undefined ? {} : { severity: event.severity }),
      ...(event.occurredAt === undefined
        ? {}
        : { occurredAt: event.occurredAt }),
    });
  }
};

export interface ProcessNextIngestJobOptions {
  controlPlane: CipControlPlane;
  serviceStore: ControlPlaneServiceStore;
  maxAttempts?: number;
}

export const processNextIngestJob = async (
  options: ProcessNextIngestJobOptions,
): Promise<WorkerProcessResult | null> => {
  const job = await options.serviceStore.ingestJobs.claimNextAvailable();
  if (job === null) {
    return null;
  }

  const maxAttempts = options.maxAttempts ?? 5;

  try {
    await processBatch(options.controlPlane, job.payload, job.id);
    await options.serviceStore.ingestJobs.markCompleted(job.id);
    return {
      outcome: "processed",
      job,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown ingest job failure";

    if (job.attemptCount + 1 >= maxAttempts) {
      await options.serviceStore.ingestJobs.moveToDeadLetter(job.id, message);
      return {
        outcome: "dead_letter",
        job,
      };
    }

    await options.serviceStore.ingestJobs.markRetryable(
      job.id,
      message,
      nextRetryAt(job.attemptCount + 1),
    );
    return {
      outcome: "retried",
      job,
    };
  }
};
