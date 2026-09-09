import { Suspense, lazy, useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { TerminalTheme } from "../../domain/settings";
import {
  DEFAULT_TERMINAL_LAUNCH_TARGET,
  terminalLaunchTargetForRepository,
  type TerminalGateway,
} from "../../domain/terminal";
import { agentSurfaceTargetGone } from "./agentModePresentation";
import {
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  agentSurfaceTerminalLaunchTargetFor,
  agentSurfaceTerminalOwnerKey,
  agentSurfaceTerminalRootMismatch,
  withTerminalLaunchTarget,
} from "./agentSurfacePolicy";

export const SURFACE_TERMINAL_GONE_MESSAGE = "This thread's checkout is gone.";
export const SURFACE_TERMINAL_UNTRUSTED_MESSAGE =
  "Project unavailable. Reopen it or check its workspace settings.";
export const SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE = SURFACE_FOREIGN_ROOT_TERMINAL_REASON;

const LazyTerminalTabsPanel = lazy(() =>
  import("../TerminalTabsPanel").then((module) => ({ default: module.TerminalTabsPanel })),
);

export interface AgentSurfaceTerminalProps {
  readonly thread: AgentThreadView | null;
  readonly isActive: boolean;
  readonly layoutRevision: number;
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
  isActive,
  layoutRevision,
  onOpenLink,
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
  const threadId = thread?.thread.threadId ?? null;
  const repositoryRoot = thread?.thread.owner.repositoryRoot ?? workspaceRoot;
  const isolation = thread?.thread.target.isolation ?? "in-place";
  const gone = thread !== null && agentSurfaceTargetGone(thread);
  const foreignRoot = thread !== null && agentSurfaceTerminalRootMismatch(thread, workspaceRoot);
  const ownerKey =
    threadId === null
      ? `${workspaceId}:agent-surface:project`
      : agentSurfaceTerminalOwnerKey(workspaceId, threadId);
  const gateway = useMemo(
    () =>
      withTerminalLaunchTarget(
        terminalGateway,
        threadId === null || foreignRoot
          ? DEFAULT_TERMINAL_LAUNCH_TARGET
          : repositoryRoot !== workspaceRoot
            ? terminalLaunchTargetForRepository(
                repositoryRoot.slice(workspaceRoot.length + 1),
                isolation === "worktree" ? threadId : undefined,
              )
            : agentSurfaceTerminalLaunchTargetFor(threadId, isolation),
      ),
    [foreignRoot, isolation, repositoryRoot, terminalGateway, threadId, workspaceRoot],
  );

  if (gone) {
    return (
      <section
        aria-label={thread === null ? "Project terminal" : "Thread terminal"}
        className="agent-surface-terminal"
      >
        <p className="agent-note agent-note--warning">{SURFACE_TERMINAL_GONE_MESSAGE}</p>
      </section>
    );
  }

  if (foreignRoot) {
    return (
      <section
        aria-label={thread === null ? "Project terminal" : "Thread terminal"}
        className="agent-surface-terminal"
      >
        <p className="agent-note agent-note--warning">{SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE}</p>
      </section>
    );
  }

  if (!workspaceTrusted) {
    return (
      <section
        aria-label={thread === null ? "Project terminal" : "Thread terminal"}
        className="agent-surface-terminal"
      >
        <p className="agent-note agent-note--warning">{SURFACE_TERMINAL_UNTRUSTED_MESSAGE}</p>
      </section>
    );
  }

  return (
    <section
      aria-label={thread === null ? "Project terminal" : "Thread terminal"}
      className="agent-surface-terminal"
      data-agent-surface-terminal={ownerKey}
      data-isolation={isolation}
    >
      <Suspense fallback={<p className="agent-note">Loading the terminal…</p>}>
        <LazyTerminalTabsPanel
          isActive={isActive}
          key={ownerKey}
          layoutRevision={layoutRevision}
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
