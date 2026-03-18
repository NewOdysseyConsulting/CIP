import type { CipControlPlaneTransport } from "./types.js";

export class CipClient {
  constructor(private readonly transport: CipControlPlaneTransport) {}

  createSession(...args: Parameters<CipControlPlaneTransport["createSession"]>) {
    return this.transport.createSession(...args);
  }

  enqueueEvents(...args: Parameters<CipControlPlaneTransport["enqueueEvents"]>) {
    return this.transport.enqueueEvents(...args);
  }

  requestApproval(...args: Parameters<CipControlPlaneTransport["requestApproval"]>) {
    return this.transport.requestApproval(...args);
  }

  resolveApproval(...args: Parameters<CipControlPlaneTransport["resolveApproval"]>) {
    return this.transport.resolveApproval(...args);
  }

  completeSession(...args: Parameters<CipControlPlaneTransport["completeSession"]>) {
    return this.transport.completeSession(...args);
  }

  transitionDeployment(
    ...args: Parameters<CipControlPlaneTransport["transitionDeployment"]>
  ) {
    return this.transport.transitionDeployment(...args);
  }

  rollbackDeployment(...args: Parameters<CipControlPlaneTransport["rollbackDeployment"]>) {
    return this.transport.rollbackDeployment(...args);
  }

  getReplay(...args: Parameters<CipControlPlaneTransport["getReplay"]>) {
    return this.transport.getReplay(...args);
  }

  getEvidenceBundle(...args: Parameters<CipControlPlaneTransport["getEvidenceBundle"]>) {
    return this.transport.getEvidenceBundle(...args);
  }

  getTenant(...args: Parameters<CipControlPlaneTransport["getTenant"]>) {
    return this.transport.getTenant(...args);
  }

  listDeployments(...args: Parameters<CipControlPlaneTransport["listDeployments"]>) {
    return this.transport.listDeployments(...args);
  }

  listAuditEvents(...args: Parameters<CipControlPlaneTransport["listAuditEvents"]>) {
    return this.transport.listAuditEvents(...args);
  }
}
