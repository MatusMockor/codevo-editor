import { createContext, useContext, useState } from "react";
import { FILE_PREVIEW_MAX_BYTES, type FilePreview } from "../../domain/filePreview";
import {
  AGENT_FILE_REVEAL_TIMEOUT_MS,
  createAgentFileRevealRequests,
  type AgentFileRevealRequests,
} from "./useAgentFileRevealRequests";

export const MAX_AGENT_FILE_VIEWER_SESSIONS = 64;
export type AgentFileViewerMarkdownMode = "rendered" | "source";

export type AgentFileViewerDocument =
  | { readonly kind: "workspace"; readonly root: string; readonly relativePath: string }
  | {
      readonly kind: "external";
      readonly path: string;
      readonly preview: Extract<FilePreview, { kind: "text" }>;
    };

export interface AgentFileViewerTarget {
  readonly document: AgentFileViewerDocument;
  readonly revealLine: number | null;
  readonly revealSequence: number;
  readonly markdownMode: AgentFileViewerMarkdownMode;
  readonly scrollTop: number | null;
}

export interface AgentFileViewerSession {
  readonly root: string;
  readonly target: AgentFileViewerTarget | null;
  readonly treeFocus: string | null;
  readonly handledReveal: number | null;
}

export interface AgentFileViewerSessions {
  session(owner: string): AgentFileViewerSession | null;
  save(owner: string, session: AgentFileViewerSession): void;
  rememberScroll(owner: string, target: AgentFileViewerTarget, scrollTop: number): void;
  readonly requests: AgentFileRevealRequests<AgentFileViewerDocument>;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function agentFileViewerDocumentKey(document: AgentFileViewerDocument): string {
  if (document.kind === "external") return `external:${document.path}`;
  return `workspace:${document.root}\u0000${document.relativePath}`;
}

export function externalFileDocument(path: string, contents: string): AgentFileViewerDocument {
  return { kind: "external", path, preview: externalFilePreview(path, contents) };
}

export function externalFilePreview(
  path: string,
  contents: string,
): Extract<FilePreview, { kind: "text" }> {
  const bytes = utf8Encoder.encode(contents);
  if (bytes.byteLength <= FILE_PREVIEW_MAX_BYTES) {
    return {
      kind: "text",
      relativePath: path,
      contents,
      byteLength: bytes.byteLength,
      truncated: false,
    };
  }
  const head = utf8Decoder.decode(bytes.subarray(0, FILE_PREVIEW_MAX_BYTES)).replace(/�+$/, "");
  return {
    kind: "text",
    relativePath: path,
    contents: head,
    byteLength: bytes.byteLength,
    truncated: true,
  };
}

export function createAgentFileViewerSessions(
  revealTimeoutMs: number = AGENT_FILE_REVEAL_TIMEOUT_MS,
): AgentFileViewerSessions {
  const sessions = new Map<string, AgentFileViewerSession>();
  const requests = createAgentFileRevealRequests<AgentFileViewerDocument>(revealTimeoutMs);

  const touch = (key: string, value: AgentFileViewerSession, limit: number) => {
    const map = sessions;
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  };

  return {
    session: (owner) => sessions.get(owner) ?? null,
    save(owner, session) {
      const previous = sessions.get(owner)?.target ?? null;
      const target = session.target;
      const kept =
        target !== null && previous !== null && sameTarget(previous, target)
          ? { ...target, scrollTop: previous.scrollTop }
          : target;
      touch(owner, { ...session, target: kept }, MAX_AGENT_FILE_VIEWER_SESSIONS);
    },
    rememberScroll(owner, target, scrollTop) {
      const session = sessions.get(owner);
      if (session === undefined || session.target === null) return;
      if (!sameTarget(session.target, target)) return;
      sessions.set(owner, { ...session, target: { ...session.target, scrollTop } });
    },
    requests,
  };
}

function sameTarget(left: AgentFileViewerTarget, right: AgentFileViewerTarget): boolean {
  return (
    left.revealSequence === right.revealSequence &&
    agentFileViewerDocumentKey(left.document) === agentFileViewerDocumentKey(right.document)
  );
}

export const AgentFileViewerSessionsContext = createContext<AgentFileViewerSessions | null>(null);

export function useAgentFileViewerSessions(): AgentFileViewerSessions {
  const provided = useContext(AgentFileViewerSessionsContext);
  const [local] = useState(createAgentFileViewerSessions);
  return provided ?? local;
}
