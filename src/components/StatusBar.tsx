import type { IntelligenceMode } from "../domain/workspace";

interface StatusBarProps {
  workspaceRoot: string | null;
  workspaceLabel: string | null;
  activeLanguage: string | null;
  intelligenceMode: IntelligenceMode;
  dirtyCount: number;
  message: string | null;
}

export function StatusBar({
  workspaceRoot,
  workspaceLabel,
  activeLanguage,
  intelligenceMode,
  dirtyCount,
  message,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{workspaceRoot || "No workspace"}</span>
      {workspaceLabel ? <span>{workspaceLabel}</span> : null}
      <span>{formatMode(intelligenceMode)}</span>
      {activeLanguage ? <span>{activeLanguage}</span> : null}
      {dirtyCount > 0 ? <span>{dirtyCount} unsaved</span> : null}
      {message ? <span className="status-message">{message}</span> : null}
    </footer>
  );
}

function formatMode(mode: IntelligenceMode): string {
  if (mode === "lightSmart") {
    return "Light Smart";
  }

  if (mode === "fullSmart") {
    return "Full Smart";
  }

  return "Basic";
}
