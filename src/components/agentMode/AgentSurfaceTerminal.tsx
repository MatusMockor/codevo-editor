import { Suspense, lazy, useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { TerminalTheme } from "../../domain/settings";
import type { TerminalGateway } from "../../domain/terminal";
import { agentSurfaceTargetGone } from "./agentModePresentation";
import {
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  agentSurfaceTerminalLaunchTargetFor,
  agentSurfaceTerminalOwnerKey,
  agentSurfaceTerminalRootMismatch,
  withTerminalLaunchTarget,
} from "./agentSurfacePolicy";

export const SURFACE_TERMINAL_GONE_MESSAGE = "This thread's checkout is gone.";
export const SURFACE_TERMINAL_UNTRUSTED_MESSAGE = "Trust the workspace to start a terminal.";
export const SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE = SURFACE_FOREIGN_ROOT_TERMINAL_REASON;

const LazyTerminalTabsPanel = lazy(() =>
  import("../TerminalTabsPanel").then((module) => ({ default: module.TerminalTabsPanel })),
);

export interface AgentSurfaceTerminalProps {
  readonly thread: AgentThreadView;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly workspaceTrusted: boolean;
  readonly terminalGateway: TerminalGateway;
  readonly terminalTheme: TerminalTheme;
  readonly profileId: string | null;
  readonly profileLabel: string | null;
  readonly shellIntegrationEnabled: boolean;
  onTrustWorkspace?(): void;
  onOpenLink?(path: string, line?: number, column?: number): void;
}

export function AgentSurfaceTerminal({
  onOpenLink,
  onTrustWorkspace,
  profileId,
  profileLabel,
  shellIntegrationEnabled,
  terminalGateway,
  terminalTheme,
  thread,
  workspaceId,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfaceTerminalProps) {
  const threadId = thread.thread.threadId;
  const isolation = thread.thread.target.isolation;
  const gone = agentSurfaceTargetGone(thread);
  const foreignRoot = agentSurfaceTerminalRootMismatch(thread, workspaceRoot);
  const ownerKey = agentSurfaceTerminalOwnerKey(workspaceId, threadId);
  const gateway = useMemo(
    () =>
      withTerminalLaunchTarget(
        terminalGateway,
        agentSurfaceTerminalLaunchTargetFor(threadId, isolation),
      ),
    [isolation, terminalGateway, threadId],
  );

  if (gone) {
    return (
      <section aria-label="Thread terminal" className="agent-surface-terminal">
        <p className="agent-note agent-note--warning">{SURFACE_TERMINAL_GONE_MESSAGE}</p>
      </section>
    );
  }

  if (foreignRoot) {
    return (
      <section aria-label="Thread terminal" className="agent-surface-terminal">
        <p className="agent-note agent-note--warning">{SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE}</p>
      </section>
    );
  }

  if (!workspaceTrusted) {
    return (
      <section aria-label="Thread terminal" className="agent-surface-terminal">
        <p className="agent-note agent-note--warning">
          {SURFACE_TERMINAL_UNTRUSTED_MESSAGE}
          {onTrustWorkspace !== undefined && (
            <button
              aria-label="Trust the workspace"
              className="agent-linkbutton"
              onClick={onTrustWorkspace}
              type="button"
            >
              Trust
            </button>
          )}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Thread terminal"
      className="agent-surface-terminal"
      data-agent-surface-terminal={ownerKey}
      data-isolation={isolation}
    >
      <Suspense fallback={<p className="agent-note">Loading the terminal…</p>}>
        <LazyTerminalTabsPanel
          isActive
          key={ownerKey}
          onOpenLink={onOpenLink}
          ownerKey={ownerKey}
          profileId={profileId}
          profileLabel={profileLabel}
          rootPath={workspaceRoot}
          shellIntegrationEnabled={shellIntegrationEnabled}
          terminalGateway={gateway}
          terminalTheme={terminalTheme}
        />
      </Suspense>
    </section>
  );
}
