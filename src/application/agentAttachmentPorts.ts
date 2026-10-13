import type { AgentImageMime } from "../domain/agentAttachment";
import type { AgentAttachmentFileSourcePort } from "./agentAttachmentFileSourcePort";

export interface AgentAttachmentWorkspaceRequest {
  readonly workspaceId: string;
}

export interface StageAgentAttachmentBytesRequest extends AgentAttachmentWorkspaceRequest {
  readonly kind: "image" | "file";
  readonly name: string;
  readonly mime: AgentImageMime | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly bytes: ArrayBuffer;
}

export interface StageAgentAttachmentFileRequest extends AgentAttachmentWorkspaceRequest {
  readonly path: string;
  readonly fileSource: AgentAttachmentFileSourcePort;
}

export class AgentAttachmentRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAttachmentRefusalError";
  }
}

export interface AgentAttachmentCandidateRequest extends AgentAttachmentWorkspaceRequest {
  readonly path: string;
}

export interface AgentAttachmentCandidateInspection {
  readonly bytes: number;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly extensionMime: string | null;
}

export interface StagedAgentAttachment {
  readonly attachmentId: string;
  readonly name: string;
  readonly mime: AgentImageMime | null;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly promptLineBytesMax: number;
}

export interface ClaimAgentAttachmentsRequest extends AgentAttachmentWorkspaceRequest {
  readonly threadId: string;
  readonly attachmentIds: ReadonlyArray<string>;
}

export interface ClaimedAgentAttachment {
  readonly attachmentId: string;
  readonly storedPath: string;
  readonly promptLine: string;
}

export interface AgentAttachmentReferenceRequest extends AgentAttachmentWorkspaceRequest {
  readonly attachmentId: string;
}

export interface StoredAgentAttachmentRequest extends AgentAttachmentWorkspaceRequest {
  readonly threadId: string;
  readonly attachmentId: string;
}

export interface AgentAttachmentGateway {
  stageAgentAttachmentBytes(
    request: StageAgentAttachmentBytesRequest,
  ): Promise<StagedAgentAttachment>;
  stageAgentAttachmentFile?(
    request: StageAgentAttachmentFileRequest,
  ): Promise<StagedAgentAttachment>;
  inspectAgentAttachmentCandidate(
    request: AgentAttachmentCandidateRequest,
  ): Promise<AgentAttachmentCandidateInspection | null>;
  readAgentAttachmentCandidate(request: AgentAttachmentCandidateRequest): Promise<ArrayBuffer>;
  claimAgentAttachments(
    request: ClaimAgentAttachmentsRequest,
  ): Promise<ReadonlyArray<ClaimedAgentAttachment>>;
  releaseAgentAttachment(request: AgentAttachmentReferenceRequest): Promise<void>;
  readAgentAttachment(request: StoredAgentAttachmentRequest): Promise<ArrayBuffer>;
  revealAgentAttachment(request: StoredAgentAttachmentRequest): Promise<void>;
}
