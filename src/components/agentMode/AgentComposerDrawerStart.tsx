import { memo } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { agentComposerNestedTargetLabel, type AgentComposerTarget } from "./agentComposerCheckout";
import { AgentComposerCheckout, AgentComposerLockedCheckout } from "./AgentComposerControls";
import { AgentExecutionEnvironmentPicker } from "./AgentExecutionEnvironmentPicker";

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
  dispatching,
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
  const nestedTargetLabel = agentComposerNestedTargetLabel(target);
  return (
    <>
      {onOpenEnvironmentSettings !== undefined && (
        <>
          <AgentExecutionEnvironmentPicker
            disabled={dispatching}
            locked={followUp}
            executionServerId={executionServerId}
            onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          />
          <span aria-hidden="true" className="agent-composer__divider" />
        </>
      )}
      {followUp && <AgentComposerLockedCheckout isolation={isolation} remote={remote} />}
      {!followUp && (
        <AgentComposerCheckout
          remote={remote}
          disabled={checkoutDisabled}
          isolation={isolation}
          onIsolationChange={onIsolationChange}
          onRefreshIsolation={onRefreshIsolation}
          onSelectRepository={onSelectRepository}
          target={target}
          worktreeAvailable={worktreeAvailable && !worktreeOnly}
          worktreeOnly={worktreeOnly}
        />
      )}
      {!followUp && nestedTargetLabel !== null && (
        <span className="agent-composer__target" data-agent-composer-target>
          <span className="agent-visually-hidden">Repository:</span>
          in {nestedTargetLabel}
        </span>
      )}
    </>
  );
});
