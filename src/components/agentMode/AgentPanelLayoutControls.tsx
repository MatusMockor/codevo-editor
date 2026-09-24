import { Maximize2, Minimize2, PanelBottom, PanelRight, X } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";
import { ariaKeyShortcuts } from "./agentWorkbenchChrome";

export type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";

export const AGENT_PANEL_MAXIMIZE_LABEL = "Maximize panel";
export const AGENT_PANEL_RESTORE_LABEL = "Restore panel";
export const AGENT_PANEL_CLOSE_LABEL = "Close panel";
const TOGGLE_BOTTOM_PANEL_LABEL = "Toggle terminal panel";
const TOGGLE_RIGHT_PANEL_LABEL = "Toggle right panel";

export interface AgentPanelMaximizeControl {
  readonly maximized: boolean;
  onToggle(): void;
}

export interface AgentPanelLayoutControlsProps {
  readonly bottomPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
}

export function AgentPanelLayoutControls({
  bottomPanelOpen,
  onToggleBottomPanel,
  onToggleRightPanel,
  rightPanelOpen,
  shortcuts,
}: AgentPanelLayoutControlsProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  return (
    <div className="cv-panel-toggles" data-panel-layout-controls="">
      <IconButton
        aria-keyshortcuts={ariaKeyShortcuts(chords.bottomPanel) || undefined}
        icon={<PanelBottom size={16} />}
        label={TOGGLE_BOTTOM_PANEL_LABEL}
        onClick={onToggleBottomPanel}
        pressed={bottomPanelOpen}
        title={agentControlTooltip(TOGGLE_BOTTOM_PANEL_LABEL, chords.bottomPanel)}
      />
      <IconButton
        aria-keyshortcuts={ariaKeyShortcuts(chords.rightPanel) || undefined}
        icon={<PanelRight size={16} />}
        label={TOGGLE_RIGHT_PANEL_LABEL}
        onClick={onToggleRightPanel}
        pressed={rightPanelOpen}
        title={agentControlTooltip(TOGGLE_RIGHT_PANEL_LABEL, chords.rightPanel)}
      />
    </div>
  );
}

export interface AgentPanelWindowControlsProps {
  readonly maximize: AgentPanelMaximizeControl;
  onClose(): void;
}

export function AgentPanelWindowControls({ maximize, onClose }: AgentPanelWindowControlsProps) {
  const label = maximize.maximized ? AGENT_PANEL_RESTORE_LABEL : AGENT_PANEL_MAXIMIZE_LABEL;
  const Icon = maximize.maximized ? Minimize2 : Maximize2;
  return (
    <div className="cv-panel-window-controls" data-panel-window-controls="">
      <IconButton icon={<Icon size={16} />} label={label} onClick={maximize.onToggle} />
      <IconButton icon={<X size={16} />} label={AGENT_PANEL_CLOSE_LABEL} onClick={onClose} />
    </div>
  );
}
