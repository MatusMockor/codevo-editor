import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type {
  ExternalAgentSessionPreview,
  ExternalAgentSessionView,
  ExternalSessionExchangeRole,
} from "../../domain/externalAgentSession";
import { agentProviderLabel, agentSessionTurnCountLabel } from "./agentSidebarPresentation";

export const MAX_TERMINAL_SESSION_FILTER_CHARS = 200;

export type AgentTerminalSessionPreviewView =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly preview: ExternalAgentSessionPreview };

export type AgentTerminalSessionsStateKey =
  | "loading"
  | "failed"
  | "empty"
  | "no-matches"
  | "preview-idle"
  | "preview-loading"
  | "preview-failed"
  | "preview-empty";

export interface AgentTerminalSessionMetaSegment {
  readonly kind: "provider" | "repository" | "turns";
  readonly text: string;
}

export interface AgentTerminalSessionRoleChip {
  readonly label: string;
  readonly className: string;
}

export function filterTerminalSessions(
  sessions: ReadonlyArray<ExternalAgentSessionView>,
  rawQuery: string,
): ReadonlyArray<ExternalAgentSessionView> {
  const needle = rawQuery.slice(0, MAX_TERMINAL_SESSION_FILTER_CHARS).trim().toLowerCase();
  if (needle === "") return sessions;
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(needle) ||
      session.sessionId.toLowerCase().includes(needle) ||
      session.cwd.toLowerCase().includes(needle),
  );
}

export function terminalSessionRepositoryLabel(repositoryRoot: string | null): string | null {
  if (repositoryRoot === null) return null;
  const segments = repositoryRoot.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? null;
}

export function terminalSessionMetaSegments(
  session: Pick<ExternalAgentSessionView, "cwd" | "provider" | "turnCount" | "turnCountExact">,
  repositoryRoot: string | null,
): ReadonlyArray<AgentTerminalSessionMetaSegment> {
  const segments: AgentTerminalSessionMetaSegment[] = [
    { kind: "provider", text: agentProviderLabel(session.provider) },
  ];
  const repository = terminalSessionRepositoryLabel(session.cwd);
  if (repositoryRoot !== null && session.cwd !== repositoryRoot && repository !== null) {
    segments.push({ kind: "repository", text: repository });
  }
  segments.push({
    kind: "turns",
    text: agentSessionTurnCountLabel(session.turnCount, session.turnCountExact),
  });
  return segments;
}

export function terminalSessionActionLabel(
  active: ExternalAgentSessionView | undefined,
  importPending: boolean,
): string {
  if (importPending) return "Importing…";
  if (active !== undefined && active.alreadyImportedThreadId !== null) {
    return "Open imported thread";
  }
  return "Continue in Codevo";
}

export function terminalSessionsEmptyNote(projectLabel: string | null): string {
  if (projectLabel === null) return "No terminal sessions for this project.";
  return `No terminal sessions for ${projectLabel}.`;
}

export function terminalSessionRoleChip(
  role: ExternalSessionExchangeRole,
): AgentTerminalSessionRoleChip {
  switch (role) {
    case "user":
      return { label: "you", className: "agent-tsp__role agent-tsp__role--you" };
    case "assistant":
      return { label: "agent", className: "agent-tsp__role" };
    default:
      return unsupportedExchangeRole(role);
  }
}

export function resolveTerminalSessionPreview(
  surface: Pick<ExternalSessionsSurface, "preview" | "previewPending">,
  active: ExternalAgentSessionView | null,
  requestedSessionId: string | null,
): AgentTerminalSessionPreviewView {
  if (active === null) return { kind: "idle" };
  const preview = surface.preview;
  if (preview !== null && preview.sessionId === active.sessionId) {
    return { kind: "ready", preview };
  }
  if (surface.previewPending) return { kind: "loading" };
  if (requestedSessionId === active.sessionId) return { kind: "failed" };
  return { kind: "loading" };
}

function unsupportedExchangeRole(role: never): never {
  throw new TypeError(`Unsupported exchange role: ${String(role)}.`);
}
