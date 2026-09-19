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

export interface AgentArtifactFileLocation {
  readonly filePath: string;
}

/** Native containment decides the absolute location; the UI only ever sends a reference. */
export interface AgentArtifactFileLocator {
  locate(owner: AgentArtifactOwner, path: string): Promise<AgentArtifactFileLocation>;
  reveal(owner: AgentArtifactOwner, path: string): Promise<void>;
}

/** The live active workspace root, read again after every await that can outlive a tab. */
export interface AgentArtifactWorkspaceAuthority {
  activeWorkspaceRoot(): string | null;
}

export interface AgentArtifactFilePort {
  openInEditor(owner: AgentArtifactOwner, path: string): Promise<void>;
  revealInFileManager(owner: AgentArtifactOwner, path: string): Promise<void>;
}

export type AgentArtifactFailureReporter = (source: string, error: unknown) => void;

export const AGENT_ARTIFACT_SOURCE = "Agent generated files";
