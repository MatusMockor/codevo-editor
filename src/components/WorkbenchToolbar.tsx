import { LoaderCircle, Minimize2, TriangleAlert } from "lucide-react";
import type { AgentWorkbenchLayoutMode } from "../domain/agentWorkbenchLayout";
import type { IdeProgressIndicator } from "../domain/ideProgress";
import type { IndexProgressState } from "../domain/indexProgress";
import type { LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { IntelligenceMode } from "../domain/workspace";
import { indexToolbarLabel } from "./appPresentation";
import { smartModeSummary } from "./appSmartModeSummary";

export const COLLAPSE_EDITOR_LABEL = "Collapse editor (⌥⌘E)";

export interface WorkbenchToolbarProps {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly collapseAvailable: boolean;
  readonly ideProgress: IdeProgressIndicator;
  readonly indexProgress: IndexProgressState;
  readonly intelligenceMode: IntelligenceMode;
  readonly languageServerPlan: LanguageServerPlan | null;
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  onCollapseEditor(): void;
  onShowProgressPanel(): void;
  onToggleSmartMode(): void;
  onTrustWorkspace(): void;
}

export function WorkbenchToolbar({
  collapseAvailable,
  ideProgress,
  indexProgress,
  intelligenceMode,
  languageServerPlan,
  languageServerRuntimeStatus,
  layout,
  onCollapseEditor,
  onShowProgressPanel,
  onToggleSmartMode,
  onTrustWorkspace,
  workspaceRoot,
  workspaceTrusted,
}: WorkbenchToolbarProps) {
  const trustNeeded = workspaceRoot !== null && !workspaceTrusted;
  const trustButton = trustNeeded ? (
    <button className="toolbar-action" onClick={onTrustWorkspace} type="button">
      Trust
    </button>
  ) : null;

  if (layout === "agent") {
    if (!trustNeeded) return null;
    return <header className="workbench-toolbar workbench-toolbar--agent">{trustButton}</header>;
  }

  return (
    <header className="workbench-toolbar">
      {collapseAvailable ? (
        <button
          aria-label={COLLAPSE_EDITOR_LABEL}
          className="toolbar-icon-action"
          onClick={onCollapseEditor}
          title={COLLAPSE_EDITOR_LABEL}
          type="button"
        >
          <Minimize2 aria-hidden="true" size={14} />
        </button>
      ) : null}
      <button
        aria-pressed={intelligenceMode === "fullSmart"}
        className={
          intelligenceMode === "fullSmart" ? "smart-mode-switch active" : "smart-mode-switch"
        }
        disabled={!workspaceRoot}
        onClick={onToggleSmartMode}
        type="button"
      >
        <span>IDE Mode</span>
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </button>
      <span className="toolbar-status">
        {smartModeSummary(
          workspaceRoot,
          intelligenceMode,
          languageServerRuntimeStatus,
          languageServerPlan,
          workspaceTrusted,
        )}
      </span>
      {ideProgress.text ? (
        <button
          aria-live="polite"
          className={`toolbar-progress ${ideProgress.state}`}
          onClick={onShowProgressPanel}
          title={ideProgress.text}
          type="button"
        >
          {ideProgress.state === "problem" ? (
            <TriangleAlert aria-hidden="true" size={14} />
          ) : (
            <LoaderCircle aria-hidden="true" className="toolbar-progress-spinner" size={14} />
          )}
          <span className="toolbar-progress-text">{ideProgress.text}</span>
        </button>
      ) : null}
      {workspaceRoot ? (
        <span className="toolbar-status">{indexToolbarLabel(indexProgress)}</span>
      ) : null}
      {trustButton}
    </header>
  );
}
