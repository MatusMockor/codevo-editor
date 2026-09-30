import type { MouseEvent } from "react";
import { PanelLeftOpen, SquarePen } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import { TopBarSeparator } from "../../ui/shell/TopBar";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";
import { agentNewThreadTooltip } from "./agentNewThreadRequest";

export const EXPAND_SIDEBAR_LABEL = "Expand sidebar";
export const COLLAPSE_SIDEBAR_LABEL = "Collapse sidebar";
export const NEW_THREAD_LABEL = "New thread";

export interface AgentSidebarRevealProps {
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly detail?: string | null;
  readonly projectCount?: number;
  readonly currentProjectLabel?: string | null;
  onExpand(): void;
  onNewThread(shiftKey: boolean): void;
}

export function AgentSidebarReveal({
  currentProjectLabel = null,
  detail = null,
  onExpand,
  onNewThread,
  projectCount = 1,
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
        onClick={(event: MouseEvent<HTMLButtonElement>) => onNewThread(event.shiftKey)}
        title={agentNewThreadTooltip(
          agentControlTooltip(NEW_THREAD_LABEL, chords.newThread),
          projectCount,
          currentProjectLabel,
        )}
      />
      <TopBarSeparator />
    </>
  );
}
