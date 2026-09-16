import type { AgentArtifactMetadata } from "../domain/agentArtifact";

export type AgentArtifactOwner =
  | {
      readonly kind: "local";
      readonly rootKey: string;
      readonly ownerId: string;
      readonly repositoryRoot: string;
      readonly threadId: string;
      readonly turnId: string;
    }
  | {
      readonly kind: "remote";
      readonly serverId: string;
      readonly runnerId: string;
      readonly taskId: string;
    };

export interface AgentArtifactLoader {
  resolve(owner: AgentArtifactOwner, path: string): Promise<AgentArtifactMetadata>;
  read(owner: AgentArtifactOwner, id: string): Promise<ArrayBuffer>;
}

export interface AgentArtifactPreviewPort {
  prepare(html: ArrayBuffer): Promise<{ readonly url: string; dispose(): Promise<void> }>;
}
