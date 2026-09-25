import type { ReactNode } from "react";
import type { AgentTaskIsolation } from "../../../domain/agentTask";
import type { AgentWorktreeBase } from "../../../domain/agentWorktreeBase";
import "./agentComposerFrame.css";

export type AgentComposerLayout = "dock" | "hero";

export interface AgentComposerDrawerContext {
  readonly repositoryRoot: string | null;
  readonly isolation: AgentTaskIsolation;
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly remote: boolean;
  readonly worktreeBase: AgentWorktreeBase;
  onWorktreeBaseChange(base: AgentWorktreeBase): void;
}

export interface AgentComposerFrameProps {
  readonly layout: AgentComposerLayout;
  readonly banners: ReactNode;
  readonly slab: ReactNode;
  readonly drawerStart: ReactNode;
  readonly drawerEnd: ReactNode;
}

export function AgentComposerFrame({
  banners,
  drawerEnd,
  drawerStart,
  layout,
  slab,
}: AgentComposerFrameProps) {
  return (
    <div className="cv-composer-dock" data-layout={layout}>
      <div className="cv-composer cv-conversation-column">
        <div className="cv-composer__banners">{banners}</div>
        {slab}
        <div className="cv-composer__drawer agent-composer__footer">
          <div className="cv-composer__drawer-start">{drawerStart}</div>
          <div className="cv-composer__drawer-end">{drawerEnd}</div>
        </div>
      </div>
    </div>
  );
}
