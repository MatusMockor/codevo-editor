import { memo } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import type { AgentComposerTarget } from "./agentComposerCheckout";
import { AgentComposerLockedCheckout, AgentRepositoryPicker } from "./AgentComposerControls";
import { AgentEnvironmentCheckoutPicker } from "./AgentEnvironmentCheckoutPicker";

export interface AgentComposerDrawerStartProps {
  readonly followUp: boolean;
  readonly remote: boolean;
  readonly dispatching: boolean;
  readonly checkoutDisabled: boolean;
  readonly executionServerId: string | null;
  readonly isolation: AgentTaskIsolation;
  readonly target: AgentComposerTarget | null;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onRefreshIsolation?(): void;
  onSelectRepository(repositoryRoot: string): void;
  onOpenEnvironmentSettings?(): void;
}

export const AgentComposerDrawerStart = memo(function AgentComposerDrawerStart({
  checkoutDisabled,
  executionServerId,
  followUp,
  isolation,
  onIsolationChange,
  onOpenEnvironmentSettings,
  onRefreshIsolation,
  onSelectRepository,
  remote,
  target,
  worktreeAvailable,
  worktreeOnly,
}: AgentComposerDrawerStartProps) {
  const runner = useRemoteRunnerContext();
  if (followUp) {
    return (
      <AgentComposerLockedCheckout
        executionServerName={
          executionServerId === null
            ? null
            : (runner?.servers.find((server) => server.id === executionServerId)?.name ?? "Server")
        }
        isolation={isolation}
        remote={remote}
      />
    );
  }
  return (
    <>
      <AgentEnvironmentCheckoutPicker
        disabled={checkoutDisabled}
        isolation={isolation}
        onIsolationChange={onIsolationChange}
        onOpenEnvironmentSettings={onOpenEnvironmentSettings}
        onRefreshIsolation={onRefreshIsolation}
        remote={remote}
        worktreeAvailable={worktreeAvailable}
        worktreeOnly={worktreeOnly}
      />
      <AgentRepositoryPicker
        disabled={checkoutDisabled}
        onRefreshIsolation={onRefreshIsolation}
        onSelectRepository={onSelectRepository}
        target={target}
      />
    </>
  );
});
