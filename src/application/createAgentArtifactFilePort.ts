import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  AgentArtifactFileLocation,
  AgentArtifactFileLocator,
  AgentArtifactFilePort,
  AgentArtifactOwner,
  AgentArtifactWorkspaceAuthority,
} from "./agentArtifactPorts";

export const AGENT_ARTIFACT_REMOTE_FILE_REASON =
  "This turn ran on a remote server, so the file is not on this machine.";
export const AGENT_ARTIFACT_FOREIGN_WORKSPACE = "This file belongs to another workspace.";

export const AGENT_ARTIFACT_OPEN_FAILED = "The file could not be opened in the editor.";
export const AGENT_ARTIFACT_REVEAL_FAILED = "The file could not be revealed in the file manager.";

const BOUNDED_NOTICES: readonly string[] = [
  AGENT_ARTIFACT_REMOTE_FILE_REASON,
  AGENT_ARTIFACT_FOREIGN_WORKSPACE,
];

export interface AgentArtifactFileSurface {
  openFile(location: AgentArtifactFileLocation, shouldCommit: () => boolean): Promise<void>;
}

export function agentArtifactFileActionsBlockedReason(owner: AgentArtifactOwner): string | null {
  if (owner.kind === "remote") return AGENT_ARTIFACT_REMOTE_FILE_REASON;
  return null;
}

/** Only refusals the user can act on reach the DOM; anything else keeps its generic notice. */
export function agentArtifactActionNotice(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (!BOUNDED_NOTICES.includes(error.message)) return fallback;
  return error.message;
}

/** One use case per action; the locator owns containment, the surface owns presentation. */
export function createAgentArtifactFilePort(
  locator: AgentArtifactFileLocator,
  surface: AgentArtifactFileSurface,
  workspace: AgentArtifactWorkspaceAuthority,
): AgentArtifactFilePort {
  return {
    async openInEditor(owner: AgentArtifactOwner, path: string): Promise<void> {
      if (owner.kind !== "local") throw new Error(AGENT_ARTIFACT_REMOTE_FILE_REASON);
      const captured = normalizedWorkspaceRootKey(workspace.activeWorkspaceRoot());
      if (captured.length === 0) throw new Error(AGENT_ARTIFACT_FOREIGN_WORKSPACE);
      const location = await locator.locate(owner, path);
      const stillActive = () =>
        workspaceRootKeysEqual(workspace.activeWorkspaceRoot(), captured) &&
        insideRoot(location.filePath, captured) &&
        insideRoot(location.filePath, owner.repositoryRoot);
      if (!stillActive()) throw new Error(AGENT_ARTIFACT_FOREIGN_WORKSPACE);
      await surface.openFile(location, stillActive);
    },
    async revealInFileManager(owner: AgentArtifactOwner, path: string): Promise<void> {
      if (owner.kind !== "local") throw new Error(AGENT_ARTIFACT_REMOTE_FILE_REASON);
      await locator.reveal(owner, path);
    },
  };
}

function insideRoot(filePath: string, root: string): boolean {
  const normalizedRoot = normalizedWorkspaceRootKey(root);
  if (normalizedRoot.length === 0 || !filePath.startsWith("/")) return false;
  if (filePath.split("/").includes("..")) return false;
  return filePath.startsWith(`${normalizedRoot}/`);
}
