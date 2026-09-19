import { invoke } from "@tauri-apps/api/core";
import type {
  AgentArtifactFileLocation,
  AgentArtifactFileLocator,
  AgentArtifactOwner,
} from "../application/agentArtifactPorts";
import {
  agentArtifactAuthority,
  agentArtifactReference,
  type Invoke,
} from "./tauriAgentArtifactGateway";

export const AGENT_ARTIFACT_FILE_NOT_LOCAL = "That file is not stored on this machine.";
const PATH_LIMIT = 4096;

function absolute(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PATH_LIMIT ||
    !value.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid artifact location.");
  return value;
}

export function parseAgentArtifactFileLocation(value: unknown): AgentArtifactFileLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid artifact location.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1) throw new Error("Invalid artifact location.");
  return { filePath: absolute(record.filePath) };
}

/** The backend owns containment; this adapter only forwards an owner and a reference. */
export class TauriAgentArtifactFileGateway implements AgentArtifactFileLocator {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async locate(owner: AgentArtifactOwner, path: string): Promise<AgentArtifactFileLocation> {
    return parseAgentArtifactFileLocation(
      await this.invokeCommand("locate_agent_output_artifact_file", {
        request: request(owner, path),
      }),
    );
  }

  async reveal(owner: AgentArtifactOwner, path: string): Promise<void> {
    await this.invokeCommand("reveal_agent_output_artifact_file", {
      request: request(owner, path),
    });
  }
}

function request(owner: AgentArtifactOwner, path: string): Readonly<Record<string, string>> {
  if (owner.kind !== "local") throw new Error(AGENT_ARTIFACT_FILE_NOT_LOCAL);
  const authority = agentArtifactAuthority(owner);
  agentArtifactReference(path);
  if (path.startsWith("/")) throw new Error("Invalid artifact path.");
  return { ...authority, path };
}
