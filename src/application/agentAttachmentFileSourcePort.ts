export interface StagedAgentAttachmentFileSource {
  readonly sourceId: string;
  readonly name: string;
  readonly bytes: number;
}

export interface AgentAttachmentFileSourcePort {
  stage(path: string): Promise<StagedAgentAttachmentFileSource>;
  release(sourceId: string): Promise<void>;
}
