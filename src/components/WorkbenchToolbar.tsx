import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { IdeProgressIndicator } from "../domain/ideProgress";
import type { IndexProgressState } from "../domain/indexProgress";
import type { LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { IntelligenceMode } from "../domain/workspace";
import { indexToolbarLabel } from "./appPresentation";
import { smartModeSummary } from "./appSmartModeSummary";

export interface WorkbenchToolbarProps {
  readonly agentModeActive: boolean;
  readonly ideProgress: IdeProgressIndicator;
  readonly indexProgress: IndexProgressState;
  readonly intelligenceMode: IntelligenceMode;
  readonly languageServerPlan: LanguageServerPlan | null;
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  onSelectAgentMode(active: boolean): void;
  onShowProgressPanel(): void;
  onToggleSmartMode(): void;
  onTrustWorkspace(): void;
}

export function WorkbenchToolbar({
  agentModeActive,
  ideProgress,
  indexProgress,
  intelligenceMode,
  languageServerPlan,
  languageServerRuntimeStatus,
  onSelectAgentMode,
  onShowProgressPanel,
  onToggleSmartMode,
  onTrustWorkspace,
  workspaceRoot,
  workspaceTrusted,
}: WorkbenchToolbarProps) {
  return (
    <header className="workbench-toolbar">
      <div aria-label="Workbench mode" className="workbench-mode-switch" role="group">
        <button
          aria-pressed={!agentModeActive}
          onClick={() => onSelectAgentMode(false)}
          type="button"
        >
          Code
        </button>
        <button
          aria-pressed={agentModeActive}
          disabled={!workspaceRoot}
          onClick={() => onSelectAgentMode(true)}
          type="button"
        >
          Agents
        </button>
      </div>
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
      {workspaceRoot && !workspaceTrusted ? (
        <button className="toolbar-action" onClick={onTrustWorkspace} type="button">
          Trust
        </button>
      ) : null}
    </header>
  );
}
