import { agentAttachmentPathCandidates } from "../domain/agentAttachmentPath";
import {
  sanitizeAgentAttachmentName,
  type AgentAttachmentCandidate,
} from "../domain/agentAttachmentIntake";
import { agentReferenceEntryOf, type AgentReferenceEntry } from "../domain/agentReferenceEntry";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import type { AgentAttachmentSource } from "./useAgentComposerAttachments";

export interface DescribedAgentAttachmentSource {
  readonly source: AgentAttachmentSource;
  readonly candidate: AgentAttachmentCandidate;
  readonly entry: AgentReferenceEntry;
}

export async function describeAgentAttachmentSource(
  gateway: Pick<AgentAttachmentGateway, "inspectAgentAttachmentCandidate">,
  workspaceId: string,
  source: AgentAttachmentSource,
  isCurrent: () => boolean,
  reportError: (error: unknown) => void,
): Promise<DescribedAgentAttachmentSource | null> {
  if (!isCurrent()) return null;
  if (source.kind === "bytes") {
    return {
      source,
      candidate: {
        name: sanitizeAgentAttachmentName(source.name),
        mime: source.mime,
        hasPath: false,
        bytes: source.bytes.byteLength,
      },
      entry: "file",
    };
  }
  for (const path of agentAttachmentPathCandidates(source.path)) {
    try {
      const inspected = await gateway.inspectAgentAttachmentCandidate({ workspaceId, path });
      if (!isCurrent()) return null;
      if (inspected === null) continue;
      // An existing special file or symlink must not redirect to a decoded path.
      if (!inspected.isRegularFile && !inspected.isDirectory) return null;
      return {
        source: { kind: "path", path },
        candidate: {
          name: sanitizeAgentAttachmentName(path.replace(/\/+$/u, "")),
          mime: inspected.isDirectory ? "inode/directory" : (inspected.extensionMime ?? ""),
          hasPath: true,
          bytes: inspected.isDirectory ? 0 : inspected.bytes,
        },
        entry: agentReferenceEntryOf(inspected),
      };
    } catch (error) {
      if (!isCurrent()) return null;
      reportError(error);
      return null;
    }
  }
  return null;
}
