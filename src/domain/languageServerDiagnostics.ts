import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export type LanguageServerDiagnosticSeverity =
  | "error"
  | "warning"
  | "information"
  | "hint";
export type LanguageServerDiagnosticNoticeSeverity =
  | "info"
  | "warning"
  | "error";

export interface LanguageServerDiagnostic {
  code?: string | number | null;
  codeDescriptionHref?: string | null;
  data?: unknown;
  message: string;
  severity: LanguageServerDiagnosticSeverity;
  source: string | null;
  tags?: number[];
  relatedInformation?: LanguageServerDiagnosticRelatedInformation[];
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface LanguageServerDiagnosticRelatedInformation {
  uri: string;
  message: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface LanguageServerDiagnosticEvent {
  rootPath: string;
  sessionId: number;
  uri: string;
  version: number | null;
  diagnostics: LanguageServerDiagnostic[];
}

export type DiagnosticsUnsubscribeFn = () => void;

export interface LanguageServerDiagnosticsGateway {
  subscribeDiagnostics(
    listener: (event: LanguageServerDiagnosticEvent) => void,
  ): Promise<DiagnosticsUnsubscribeFn>;
}

export function languageServerDiagnosticNoticeGroup(uri: string): string {
  return `language-server-diagnostics:${uri}`;
}

export function languageServerDiagnosticNoticeSeverity(
  severity: LanguageServerDiagnosticSeverity,
): LanguageServerDiagnosticNoticeSeverity {
  if (severity === "error") {
    return "error";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

export function languageServerDiagnosticNoticeMessage(
  diagnostic: LanguageServerDiagnostic,
  uri: string,
): string {
  return `${uri} ${diagnostic.line + 1}:${diagnostic.character + 1} ${diagnostic.message}`;
}

/**
 * Decides whether a `publishDiagnostics` event should be applied.
 *
 * phpactor (and the JS/TS server) publish diagnostics asynchronously, keyed by
 * the version of the document snapshot they *analysed* — NOT the live document
 * version. After a `didChange` advances the live document version, the server
 * can still publish results (including a clear, `count=0`) for the analysis it
 * had already started at an older version. Comparing against the live document
 * version therefore discards valid, in-order publications and leaves stale
 * markers on screen.
 *
 * We instead compare against the version of the LAST diagnostic we actually
 * APPLIED for this document (`lastAppliedDiagnosticVersion`). Because the server
 * publishes monotonically, this lets every fresh publication through (including
 * the clear) while still dropping a genuinely out-of-order publication whose
 * analysis version is older than one we have already applied.
 */
export function shouldApplyLanguageServerDiagnostics(
  event: LanguageServerDiagnosticEvent,
  currentSessionId: number | null,
  lastAppliedDiagnosticVersion: number | undefined,
  currentWorkspaceRoot?: string | null,
): boolean {
  if (
    currentWorkspaceRoot &&
    normalizedWorkspaceRootKey(event.rootPath) !==
      normalizedWorkspaceRootKey(currentWorkspaceRoot)
  ) {
    return false;
  }

  if (event.sessionId !== currentSessionId) {
    return false;
  }

  if (typeof event.version !== "number") {
    return true;
  }

  if (typeof lastAppliedDiagnosticVersion !== "number") {
    return true;
  }

  return event.version >= lastAppliedDiagnosticVersion;
}
