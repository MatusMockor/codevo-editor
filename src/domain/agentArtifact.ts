/** Provider-neutral references emitted by assistant Markdown, never by tool logs. */
export interface AgentArtifactReference {
  readonly path: string;
  readonly label: string;
}

export type AgentArtifactMediaType = "image/png" | "image/jpeg" | "image/webp" | "text/html";

export interface AgentArtifactMetadata {
  readonly id: string;
  readonly taskId: string;
  readonly name: string;
  readonly mediaType: AgentArtifactMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const AGENT_ARTIFACT_REFERENCE_LIMIT = 32;
export const AGENT_ARTIFACT_HTML_LIMIT = 2 * 1024 * 1024;
export const AGENT_ARTIFACT_IMAGE_LIMIT = 8 * 1024 * 1024;
const MARKDOWN_LIMIT = 256 * 1024;

export function agentArtifactByteLimit(mediaType: AgentArtifactMediaType): number {
  return mediaType === "text/html" ? AGENT_ARTIFACT_HTML_LIMIT : AGENT_ARTIFACT_IMAGE_LIMIT;
}

export function parseAgentArtifactPath(value: string): string | null {
  if (value.length === 0 || value.length > 4096) return null;
  let path: string;
  try {
    path = decodeURIComponent(value.replace(/\\([ ()[\]<>])/g, "$1"));
  } catch {
    return null;
  }
  if (
    /[\u0000-\u001f\u007f\\?#]/.test(path) ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.includes("//") ||
    path.split("/").includes("..") ||
    !/\.(?:png|jpe?g|webp|html?)$/i.test(path)
  )
    return null;
  return path
    .split("/")
    .filter((part) => part !== ".")
    .join("/");
}

export function extractAgentArtifactReferences(
  markdown: string,
): readonly AgentArtifactReference[] {
  // Oversized replies fail closed instead of scanning an unbounded transcript.
  if (markdown.length > MARKDOWN_LIMIT) return [];
  const content = markdown.replace(/```[^]*?```|~~~[^]*?~~~|`[^`\n]*`/g, "");
  const references: AgentArtifactReference[] = [];
  const seen = new Set<string>();
  const links =
    /!?\[([^\]\n]{0,256})\]\(\s*(?:<([^>\n]{1,4096})>|((?:\\.|[^\\\s)]){1,4096}))(?:\s+"[^"\n]*")?\s*\)/g;
  for (const match of content.matchAll(links)) {
    const path = parseAgentArtifactPath(match[2] ?? match[3] ?? "");
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    references.push({
      path,
      label: match[1]?.trim() || path.slice(path.lastIndexOf("/") + 1) || "Artifact",
    });
    if (references.length === AGENT_ARTIFACT_REFERENCE_LIMIT) break;
  }
  return references;
}
