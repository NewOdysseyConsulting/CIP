import type {
  CipAdminTransport,
  CipControlPlaneTransport,
} from "./types.js";

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

  getIngestJob(...args: Parameters<CipControlPlaneTransport["getIngestJob"]>) {
    return this.transport.getIngestJob(...args);
  }
}

export class CipAdminClient {
  constructor(private readonly transport: CipAdminTransport) {}

  createTenant(...args: Parameters<CipAdminTransport["createTenant"]>) {
    return this.transport.createTenant(...args);
  }

  listTenants(...args: Parameters<CipAdminTransport["listTenants"]>) {
    return this.transport.listTenants(...args);
  }

  getTenant(...args: Parameters<CipAdminTransport["getTenant"]>) {
    return this.transport.getTenant(...args);
  }

  createConnectorDefinition(
    ...args: Parameters<CipAdminTransport["createConnectorDefinition"]>
  ) {
    return this.transport.createConnectorDefinition(...args);
  }

  listConnectorDefinitions(
    ...args: Parameters<CipAdminTransport["listConnectorDefinitions"]>
  ) {
    return this.transport.listConnectorDefinitions(...args);
  }

  getConnectorDefinition(
    ...args: Parameters<CipAdminTransport["getConnectorDefinition"]>
  ) {
    return this.transport.getConnectorDefinition(...args);
  }

  createCredentialBinding(
    ...args: Parameters<CipAdminTransport["createCredentialBinding"]>
  ) {
    return this.transport.createCredentialBinding(...args);
  }

  listCredentialBindings(
    ...args: Parameters<CipAdminTransport["listCredentialBindings"]>
  ) {
    return this.transport.listCredentialBindings(...args);
  }

  getCredentialBinding(
    ...args: Parameters<CipAdminTransport["getCredentialBinding"]>
  ) {
    return this.transport.getCredentialBinding(...args);
  }

  createConnectorBinding(
    ...args: Parameters<CipAdminTransport["createConnectorBinding"]>
  ) {
    return this.transport.createConnectorBinding(...args);
  }

  listConnectorBindings(
    ...args: Parameters<CipAdminTransport["listConnectorBindings"]>
  ) {
    return this.transport.listConnectorBindings(...args);
  }

  getConnectorBinding(
    ...args: Parameters<CipAdminTransport["getConnectorBinding"]>
  ) {
    return this.transport.getConnectorBinding(...args);
  }

  publishPolicyPack(...args: Parameters<CipAdminTransport["publishPolicyPack"]>) {
    return this.transport.publishPolicyPack(...args);
  }

  listPolicyPacks(...args: Parameters<CipAdminTransport["listPolicyPacks"]>) {
    return this.transport.listPolicyPacks(...args);
  }

  getPolicyPack(...args: Parameters<CipAdminTransport["getPolicyPack"]>) {
    return this.transport.getPolicyPack(...args);
  }

  publishGuardrailDefinition(
    ...args: Parameters<CipAdminTransport["publishGuardrailDefinition"]>
  ) {
    return this.transport.publishGuardrailDefinition(...args);
  }

  listGuardrailDefinitions(
    ...args: Parameters<CipAdminTransport["listGuardrailDefinitions"]>
  ) {
    return this.transport.listGuardrailDefinitions(...args);
  }

  getGuardrailDefinition(
    ...args: Parameters<CipAdminTransport["getGuardrailDefinition"]>
  ) {
    return this.transport.getGuardrailDefinition(...args);
  }

  registerAgentBlueprint(
    ...args: Parameters<CipAdminTransport["registerAgentBlueprint"]>
  ) {
    return this.transport.registerAgentBlueprint(...args);
  }

  listAgentBlueprints(
    ...args: Parameters<CipAdminTransport["listAgentBlueprints"]>
  ) {
    return this.transport.listAgentBlueprints(...args);
  }

  getAgentBlueprint(
    ...args: Parameters<CipAdminTransport["getAgentBlueprint"]>
  ) {
    return this.transport.getAgentBlueprint(...args);
  }

  createDeployment(...args: Parameters<CipAdminTransport["createDeployment"]>) {
    return this.transport.createDeployment(...args);
  }

  listDeployments(...args: Parameters<CipAdminTransport["listDeployments"]>) {
    return this.transport.listDeployments(...args);
  }

  getDeployment(...args: Parameters<CipAdminTransport["getDeployment"]>) {
    return this.transport.getDeployment(...args);
  }

  issueApiKey(...args: Parameters<CipAdminTransport["issueApiKey"]>) {
    return this.transport.issueApiKey(...args);
  }

  listApiKeys(...args: Parameters<CipAdminTransport["listApiKeys"]>) {
    return this.transport.listApiKeys(...args);
  }

  getApiKey(...args: Parameters<CipAdminTransport["getApiKey"]>) {
    return this.transport.getApiKey(...args);
  }

  rotateApiKey(...args: Parameters<CipAdminTransport["rotateApiKey"]>) {
    return this.transport.rotateApiKey(...args);
  }

  revokeApiKey(...args: Parameters<CipAdminTransport["revokeApiKey"]>) {
    return this.transport.revokeApiKey(...args);
  }

  getIngestJob(...args: Parameters<CipAdminTransport["getIngestJob"]>) {
    return this.transport.getIngestJob(...args);
  }

  listDeadLetterJobs(
    ...args: Parameters<CipAdminTransport["listDeadLetterJobs"]>
  ) {
    return this.transport.listDeadLetterJobs(...args);
  }

  requeueDeadLetterJob(
    ...args: Parameters<CipAdminTransport["requeueDeadLetterJob"]>
  ) {
    return this.transport.requeueDeadLetterJob(...args);
  }
}
