import type { IntelligenceMode } from "../domain/workspace";

interface StatusBarProps {
  workspaceRoot: string | null;
  workspaceLabel: string | null;
  indexLabel: string | null;
  languageServerLabel: string | null;
  workspaceTrustLabel: string | null;
  activeLanguage: string | null;
  intelligenceMode: IntelligenceMode;
  dirtyCount: number;
  message: string | null;
}

export function StatusBar({
  workspaceRoot,
  workspaceLabel,
  indexLabel,
  languageServerLabel,
  workspaceTrustLabel,
  activeLanguage,
  intelligenceMode,
  dirtyCount,
  message,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{workspaceRoot || "No workspace"}</span>
      {workspaceLabel ? <span>{workspaceLabel}</span> : null}
      {indexLabel ? <span>{indexLabel}</span> : null}
      {languageServerLabel ? <span>{languageServerLabel}</span> : null}
      {workspaceTrustLabel ? <span>{workspaceTrustLabel}</span> : null}
      <span>{formatMode(intelligenceMode)}</span>
      {activeLanguage ? <span>{activeLanguage}</span> : null}
      {dirtyCount > 0 ? <span>{dirtyCount} unsaved</span> : null}
      {message ? <span className="status-message">{message}</span> : null}
    </footer>
  );
}

function formatMode(mode: IntelligenceMode): string {
  if (mode === "lightSmart") {
    return "Smart Index";
  }

  if (mode === "fullSmart") {
    return "IDE Mode";
  }

  return "Editor Mode";
}
