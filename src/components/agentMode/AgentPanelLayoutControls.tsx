import { Maximize2, PanelBottom, PanelRight } from "lucide-react";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";

export interface AgentPanelLayoutControlsProps {
  readonly bottomPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly rightPanelDisabledReason: string | null;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
  onExpandEditor: (() => void) | null;
}

export function AgentPanelLayoutControls({
  bottomPanelOpen,
  onExpandEditor,
  onToggleBottomPanel,
  onToggleRightPanel,
  rightPanelDisabledReason,
  rightPanelOpen,
  shortcuts,
}: AgentPanelLayoutControlsProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const bottomTitle = agentControlTooltip("Toggle terminal panel", chords.bottomPanel);
  const rightTitle =
    rightPanelDisabledReason ?? agentControlTooltip("Toggle right panel", chords.rightPanel);
  const expandTitle = agentControlTooltip("Expand to editor", chords.expandEditor);

  return (
    <div className="agent-layout-controls" data-panel-layout-controls>
      {onExpandEditor !== null && (
        <button
          aria-label={expandTitle}
          className="agent-icon-toggle"
          onClick={onExpandEditor}
          title={expandTitle}
          type="button"
        >
          <Maximize2 aria-hidden="true" size={14} />
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
        disabled={rightPanelDisabledReason !== null}
        onClick={onToggleRightPanel}
        title={rightTitle}
        type="button"
      >
        <PanelRight aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
