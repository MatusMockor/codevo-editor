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
  rootPath?: string;
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

export function shouldApplyLanguageServerDiagnostics(
  event: LanguageServerDiagnosticEvent,
  currentSessionId: number | null,
  currentVersion: number | undefined,
): boolean {
  if (event.sessionId !== currentSessionId) {
    return false;
  }

  if (typeof event.version !== "number") {
    return true;
  }

  if (typeof currentVersion !== "number") {
    return true;
  }

  return event.version >= currentVersion;
}
