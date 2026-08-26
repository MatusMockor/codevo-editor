import { Expand, Maximize2, Minimize2, PanelBottom, PanelRight } from "lucide-react";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";

export const AGENT_PANEL_MAXIMIZE_LABEL = "Maximize panel";
export const AGENT_PANEL_RESTORE_LABEL = "Restore panel";

export interface AgentPanelMaximizeControl {
  readonly maximized: boolean;
  onToggle(): void;
}

export interface AgentPanelLayoutControlsProps {
  readonly bottomPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly maximize?: AgentPanelMaximizeControl | null;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
  onExpandEditor: (() => void) | null;
}

export function AgentPanelLayoutControls({
  bottomPanelOpen,
  maximize = null,
  onExpandEditor,
  onToggleBottomPanel,
  onToggleRightPanel,
  rightPanelOpen,
  shortcuts,
}: AgentPanelLayoutControlsProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const bottomTitle = agentControlTooltip("Toggle terminal panel", chords.bottomPanel);
  const rightTitle = agentControlTooltip("Toggle right panel", chords.rightPanel);
  const expandTitle = agentControlTooltip("Expand to editor", chords.expandEditor);
  const maximizeTitle =
    maximize?.maximized === true ? AGENT_PANEL_RESTORE_LABEL : AGENT_PANEL_MAXIMIZE_LABEL;
  const MaximizeIcon = maximize?.maximized === true ? Minimize2 : Maximize2;

  return (
    <div className="agent-layout-controls" data-panel-layout-controls>
      {maximize !== null && (
        <button
          aria-label={maximizeTitle}
          aria-pressed={maximize.maximized}
          className="agent-icon-toggle"
          onClick={maximize.onToggle}
          title={maximizeTitle}
          type="button"
        >
          <MaximizeIcon aria-hidden="true" size={14} />
        </button>
      )}
      {onExpandEditor !== null && (
        <button
          aria-label={expandTitle}
          className="agent-icon-toggle"
          onClick={onExpandEditor}
          title={expandTitle}
          type="button"
        >
          <Expand aria-hidden="true" size={14} />
        </button>
      )}
      <button
        aria-label={bottomTitle}
        aria-pressed={bottomPanelOpen}
        className="agent-icon-toggle"
        onClick={onToggleBottomPanel}
        title={bottomTitle}
        type="button"
      >
        <PanelBottom aria-hidden="true" size={14} />
      </button>
      <button
        aria-label={rightTitle}
        aria-pressed={rightPanelOpen}
        className="agent-icon-toggle"
        onClick={onToggleRightPanel}
        title={rightTitle}
        type="button"
      >
        <PanelRight aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
