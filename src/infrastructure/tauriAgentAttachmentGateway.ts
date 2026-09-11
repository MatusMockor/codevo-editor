import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentAttachmentCandidateInspection,
  AgentAttachmentCandidateRequest,
  AgentAttachmentGateway,
  AgentAttachmentReferenceRequest,
  ClaimAgentAttachmentsRequest,
  ClaimedAgentAttachment,
  StageAgentAttachmentBytesRequest,
  StageAgentAttachmentFromPathRequest,
  StagedAgentAttachment,
  StoredAgentAttachmentRequest,
} from "../application/agentAttachmentPorts";
import {
  invokeClaimAgentAttachmentsIpc,
  invokeInspectAgentAttachmentCandidateIpc,
  invokeReadAgentAttachmentCandidateIpc,
  invokeReadAgentAttachmentIpc,
  invokeReleaseAgentAttachmentIpc,
  invokeRevealAgentAttachmentIpc,
  invokeStageAgentAttachmentBytesIpc,
  invokeStageAgentAttachmentFromPathIpc,
  type InvokeAgentAttachmentCommand,
  type InvokeAgentAttachmentRawCommand,
} from "./tauriAgentAttachmentIpcContract";

export const AGENT_ATTACHMENT_RUNTIME_UNAVAILABLE =
  "Attachments require the native runtime." as const;

export type AgentAttachmentRuntimeDetector = () => boolean;

const invokeAgentAttachmentCommand: InvokeAgentAttachmentCommand = (command, args) =>
  invoke(command, args);

const invokeAgentAttachmentRawCommand: InvokeAgentAttachmentRawCommand = (command, body, headers) =>
  invoke(command, body, { headers });

export class TauriAgentAttachmentGateway implements AgentAttachmentGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentAttachmentCommand = invokeAgentAttachmentCommand,
    private readonly invokeRawCommand: InvokeAgentAttachmentRawCommand = invokeAgentAttachmentRawCommand,
    private readonly isRuntimeAvailable: AgentAttachmentRuntimeDetector = isTauri,
  ) {}

  async stageAgentAttachmentBytes(
    request: StageAgentAttachmentBytesRequest,
  ): Promise<StagedAgentAttachment> {
    this.requireRuntime();
    return invokeStageAgentAttachmentBytesIpc(this.invokeRawCommand, request);
  }

  async stageAgentAttachmentFromPath(
    request: StageAgentAttachmentFromPathRequest,
  ): Promise<StagedAgentAttachment> {
    this.requireRuntime();
    return invokeStageAgentAttachmentFromPathIpc(this.invokeCommand, request);
  }

  async inspectAgentAttachmentCandidate(
    request: AgentAttachmentCandidateRequest,
  ): Promise<AgentAttachmentCandidateInspection> {
    this.requireRuntime();
    return invokeInspectAgentAttachmentCandidateIpc(this.invokeCommand, request);
  }

  async readAgentAttachmentCandidate(
    request: AgentAttachmentCandidateRequest,
  ): Promise<ArrayBuffer> {
    this.requireRuntime();
    return invokeReadAgentAttachmentCandidateIpc(this.invokeCommand, request);
  }

  async claimAgentAttachments(
    request: ClaimAgentAttachmentsRequest,
  ): Promise<ReadonlyArray<ClaimedAgentAttachment>> {
    this.requireRuntime();
    return invokeClaimAgentAttachmentsIpc(this.invokeCommand, request);
  }

  async releaseAgentAttachment(request: AgentAttachmentReferenceRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeReleaseAgentAttachmentIpc(this.invokeCommand, request);
  }

  async readAgentAttachment(request: StoredAgentAttachmentRequest): Promise<ArrayBuffer> {
    this.requireRuntime();
    return invokeReadAgentAttachmentIpc(this.invokeCommand, request);
  }

  async revealAgentAttachment(request: StoredAgentAttachmentRequest): Promise<void> {
    this.requireRuntime();
    return invokeRevealAgentAttachmentIpc(this.invokeCommand, request);
  }

  private requireRuntime(): void {
    if (this.isRuntimeAvailable()) return;
    throw new Error(AGENT_ATTACHMENT_RUNTIME_UNAVAILABLE);
  }
}
