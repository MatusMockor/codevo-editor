import { PanelLeftOpen, SquarePen } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import { TopBarSeparator } from "../../ui/shell/TopBar";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export const EXPAND_SIDEBAR_LABEL = "Expand sidebar";
export const COLLAPSE_SIDEBAR_LABEL = "Collapse sidebar";
export const NEW_THREAD_LABEL = "New thread";

export interface AgentSidebarRevealProps {
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly detail?: string | null;
  onExpand(): void;
  onNewThread(): void;
}

export function AgentSidebarReveal({
  detail = null,
  onExpand,
  onNewThread,
  shortcuts,
}: AgentSidebarRevealProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const expandTitle = agentControlTooltip(EXPAND_SIDEBAR_LABEL, chords.sidebar);
  return (
    <>
      <IconButton
        aria-expanded={false}
        icon={<PanelLeftOpen size={16} />}
        label={EXPAND_SIDEBAR_LABEL}
        onClick={onExpand}
        title={detail === null ? expandTitle : `${expandTitle} · ${detail}`}
      />
      <IconButton
        icon={<SquarePen size={16} />}
        label={NEW_THREAD_LABEL}
        onClick={onNewThread}
        title={agentControlTooltip(NEW_THREAD_LABEL, chords.newThread)}
      />
      <TopBarSeparator />
    </>
  );
}
