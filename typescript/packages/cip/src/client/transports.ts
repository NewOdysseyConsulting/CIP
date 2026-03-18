import { randomUUID } from "node:crypto";

import type { CipRepositories } from "../repositories/ports.js";
import type { CipControlPlane } from "../services/cip-control-plane.js";
import type {
  CipControlPlaneTransport,
  CipEventBatch,
  CipIngestReceipt,
  CompleteSessionRequest,
  CreateSessionRequest,
  RequestApprovalRequest,
  ResolveApprovalRequestRequest,
  RollbackDeploymentRequest,
  TransitionDeploymentRequest,
} from "./types.js";

const jsonHeaders = (idempotencyKey?: string): Record<string, string> => ({
  "content-type": "application/json",
  ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
});

const assertResponseOk = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`control plane request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

export interface LocalCipControlPlaneTransportOptions {
  controlPlane: CipControlPlane;
  repositories: CipRepositories;
}

export class LocalCipControlPlaneTransport
  implements CipControlPlaneTransport
{
  constructor(private readonly options: LocalCipControlPlaneTransportOptions) {}

  async createSession(
    input: CreateSessionRequest,
  ): Promise<Awaited<ReturnType<CipControlPlane["startRunSession"]>>> {
    return this.options.controlPlane.startRunSession(input);
  }

  async enqueueEvents(batch: CipEventBatch): Promise<CipIngestReceipt> {
    for (const event of batch.events) {
      if (event.kind === "run_event") {
        await this.options.controlPlane.appendRunEvent({
          sessionId: batch.sessionId,
          type: event.type,
          ...(event.actor === undefined ? {} : { actor: event.actor }),
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          ...(event.traceCorrelation === undefined
            ? {}
            : { traceCorrelation: event.traceCorrelation }),
          ...(event.occurredAt === undefined
            ? {}
            : { occurredAt: event.occurredAt }),
        });
      } else {
        await this.options.controlPlane.appendAuditEvent({
          tenantId: batch.tenantId,
          sessionId: batch.sessionId,
          ...(event.deploymentId === undefined
            ? {}
            : { deploymentId: event.deploymentId }),
          category: event.category,
          action: event.action,
          actor: event.actor,
          payload: event.payload,
          ...(event.severity === undefined ? {} : { severity: event.severity }),
          ...(event.occurredAt === undefined
            ? {}
            : { occurredAt: event.occurredAt }),
        });
      }
    }

    return {
      ingestJobId: `local-${randomUUID()}`,
      acceptedCount: batch.events.length,
      receivedAt: new Date().toISOString(),
    };
  }

  async requestApproval(input: RequestApprovalRequest) {
    return this.options.controlPlane.requestHumanApproval(input);
  }

  async resolveApproval(input: ResolveApprovalRequestRequest) {
    return this.options.controlPlane.resolveApprovalRequest(input);
  }

  async completeSession(input: CompleteSessionRequest) {
    return this.options.controlPlane.completeRunSession(input);
  }

  async transitionDeployment(input: TransitionDeploymentRequest) {
    return this.options.controlPlane.transitionDeployment(input);
  }

  async rollbackDeployment(input: RollbackDeploymentRequest) {
    return this.options.controlPlane.rollbackDeploymentToBlueprint(input);
  }

  async getReplay(sessionId: string) {
    return this.options.controlPlane.replayRunSession(sessionId);
  }

  async getEvidenceBundle(sessionId: string) {
    return this.options.controlPlane.getEvidenceBundle(sessionId);
  }

  async getTenant(tenantId: string) {
    return this.options.repositories.tenants.getById(tenantId);
  }

  async listDeployments(tenantId?: string) {
    return this.options.repositories.deployments.list(
      tenantId === undefined ? undefined : { tenantId },
    );
  }

  async listAuditEvents(tenantId?: string) {
    return this.options.repositories.auditEvents.list(
      tenantId === undefined ? undefined : { tenantId },
    );
  }
}

export interface HttpCipControlPlaneTransportOptions {
  baseUrl: string;
  apiKey?: string;
  operatorToken?: string;
  fetchImpl?: typeof fetch;
}

export class HttpCipControlPlaneTransport implements CipControlPlaneTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpCipControlPlaneTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private buildUrl(path: string): string {
    return new URL(path, this.options.baseUrl).toString();
  }

  private buildHeaders(
    authMode: "sdk" | "operator",
    idempotencyKey?: string,
  ): Record<string, string> {
    const authorization =
      authMode === "sdk"
        ? this.options.apiKey === undefined
          ? undefined
          : `Bearer ${this.options.apiKey}`
        : this.options.operatorToken === undefined
          ? undefined
          : `Bearer ${this.options.operatorToken}`;

    return {
      ...jsonHeaders(idempotencyKey),
      ...(authorization === undefined ? {} : { authorization }),
    };
  }

  async createSession(
    input: CreateSessionRequest,
    idempotencyKey?: string,
  ) {
    const response = await this.fetchImpl(this.buildUrl("/v1/sessions"), {
      method: "POST",
      headers: this.buildHeaders("sdk", idempotencyKey),
      body: JSON.stringify(input),
    });

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["createSession"]
    >;
  }

  async enqueueEvents(batch: CipEventBatch, idempotencyKey?: string) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/sessions/${batch.sessionId}/events:enqueue`),
      {
        method: "POST",
        headers: this.buildHeaders("sdk", idempotencyKey),
        body: JSON.stringify(batch),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["enqueueEvents"]
    >;
  }

  async requestApproval(input: RequestApprovalRequest) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/sessions/${input.sessionId}/approval-requests`),
      {
        method: "POST",
        headers: this.buildHeaders("sdk"),
        body: JSON.stringify(input),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["requestApproval"]
    >;
  }

  async resolveApproval(input: ResolveApprovalRequestRequest) {
    const response = await this.fetchImpl(
      this.buildUrl(
        `/v1/approval-requests/${input.approvalRequestId}:resolve`,
      ),
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["resolveApproval"]
    >;
  }

  async completeSession(
    input: CompleteSessionRequest,
    idempotencyKey?: string,
  ) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/sessions/${input.sessionId}:complete`),
      {
        method: "POST",
        headers: this.buildHeaders("sdk", idempotencyKey),
        body: JSON.stringify(input),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["completeSession"]
    >;
  }

  async transitionDeployment(input: TransitionDeploymentRequest) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/deployments/${input.deploymentId}:transition`),
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["transitionDeployment"]
    >;
  }

  async rollbackDeployment(input: RollbackDeploymentRequest) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/deployments/${input.deploymentId}:rollback`),
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["rollbackDeployment"]
    >;
  }

  async getReplay(sessionId: string) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/sessions/${sessionId}/replay`),
      {
        headers: this.buildHeaders("sdk"),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["getReplay"]
    >;
  }

  async getEvidenceBundle(sessionId: string) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/evidence-bundles/${sessionId}`),
      {
        headers: this.buildHeaders("sdk"),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["getEvidenceBundle"]
    >;
  }

  async getTenant(tenantId: string) {
    const response = await this.fetchImpl(
      this.buildUrl(`/v1/tenants/${tenantId}`),
      {
        headers: this.buildHeaders("operator"),
      },
    );

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["getTenant"]
    >;
  }

  async listDeployments(tenantId?: string) {
    const url = new URL("/v1/deployments", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }

    const response = await this.fetchImpl(url.toString(), {
      headers: this.buildHeaders("operator"),
    });

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["listDeployments"]
    >;
  }

  async listAuditEvents(tenantId?: string) {
    const url = new URL("/v1/audit-events", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }

    const response = await this.fetchImpl(url.toString(), {
      headers: this.buildHeaders("operator"),
    });

    return assertResponseOk(response) as ReturnType<
      CipControlPlaneTransport["listAuditEvents"]
    >;
  }
}
