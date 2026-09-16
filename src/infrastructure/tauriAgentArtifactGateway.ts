import { invoke } from "@tauri-apps/api/core";
import type { AgentArtifactLoader, AgentArtifactOwner } from "../application/agentArtifactPorts";
import {
  agentArtifactByteLimit,
  parseAgentArtifactPath,
  type AgentArtifactMetadata,
} from "../domain/agentArtifact";

type Invoke = (command: string, args: Readonly<{ request: unknown }>) => Promise<unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function artifactId(owner: AgentArtifactOwner, value: string): boolean {
  return owner.kind === "local" ? /^[a-f0-9]{64}$/.test(value) : UUID.test(value);
}
function identifier(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid artifact owner.");
}
function authority(owner: AgentArtifactOwner): Readonly<Record<string, string>> {
  if (owner.kind === "local") {
    identifier(owner.ownerId);
    identifier(owner.threadId);
    identifier(owner.turnId);
    return { workspaceId: owner.ownerId, threadId: owner.threadId, turnId: owner.turnId };
  }
  if (owner.kind === "remote") {
    identifier(owner.serverId);
    identifier(owner.runnerId);
    if (owner.runnerId.length > 128) throw new Error("Invalid runner identity.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(owner.serverId) || !UUID.test(owner.taskId))
      throw new Error("Invalid remote artifact owner.");
    return { serverId: owner.serverId, runnerId: owner.runnerId, taskId: owner.taskId };
  }
  throw new Error("Unknown artifact owner.");
}
function metadata(value: unknown, owner: AgentArtifactOwner): AgentArtifactMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid artifact metadata.");
  const object = value as Record<string, unknown>;
  const fields = ["id", "taskId", "name", "mediaType", "sizeBytes", "sha256"];
  if (
    Object.keys(object).length !== fields.length ||
    Object.keys(object).some((key) => !fields.includes(key)) ||
    typeof object.id !== "string" ||
    !artifactId(owner, object.id) ||
    object.taskId !== (owner.kind === "local" ? owner.turnId : owner.taskId) ||
    typeof object.name !== "string" ||
    object.name.length === 0 ||
    new TextEncoder().encode(object.name).length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(object.name) ||
    !["image/png", "image/jpeg", "image/webp", "text/html"].includes(String(object.mediaType)) ||
    typeof object.sizeBytes !== "number" ||
    !Number.isSafeInteger(object.sizeBytes) ||
    object.sizeBytes <= 0 ||
    typeof object.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(object.sha256)
  )
    throw new Error("Invalid artifact metadata.");
  const result = object as unknown as AgentArtifactMetadata;
  if (result.sizeBytes > agentArtifactByteLimit(result.mediaType))
    throw new Error("Artifact exceeds preview limit.");
  return result;
}

/** Only registered native owner IDs cross IPC. Credentials and file reads stay native. */
export class TauriAgentArtifactGateway implements AgentArtifactLoader {
  constructor(private readonly invokeCommand: Invoke = invoke) {}
  async resolve(owner: AgentArtifactOwner, path: string): Promise<AgentArtifactMetadata> {
    const request = authority(owner);
    // Already-decoded references must not be decoded a second time at this boundary.
    if (typeof path !== "string" || parseAgentArtifactPath(encodeURI(path)) !== path)
      throw new Error("Invalid artifact path.");
    const result = await this.invokeCommand(
      owner.kind === "local" ? "resolve_agent_output_artifact" : "resolve_remote_agent_artifact",
      { request: { ...request, path } },
    );
    return metadata(result, owner);
  }
  async read(owner: AgentArtifactOwner, id: string): Promise<ArrayBuffer> {
    const request = authority(owner);
    if (typeof id !== "string" || !artifactId(owner, id))
      throw new Error("Invalid artifact identifier.");
    const result = await this.invokeCommand(
      owner.kind === "local" ? "read_agent_output_artifact" : "read_remote_agent_artifact",
      { request: { ...request, artifactId: id } },
    );
    if (
      !(result instanceof ArrayBuffer) ||
      result.byteLength === 0 ||
      result.byteLength > 8 * 1024 * 1024
    )
      throw new Error("Invalid artifact content.");
    return result;
  }
}
