import { memo } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentWorkspaceLocation } from "../../domain/agentWorkspaceLocation";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import type { AgentComposerTarget } from "./agentComposerCheckout";
import {
  AgentComposerLockedCheckout,
  AgentComposerLockedMachine,
  AgentRepositoryPicker,
} from "./AgentComposerControls";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import { agentComposerStrip, type AgentComposerStripRunOn } from "./agentComposerStrip";
import { AgentEnvironmentCheckoutPicker } from "./AgentEnvironmentCheckoutPicker";
import { AgentRunOnPicker } from "./AgentRunOnPicker";

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
  readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null;
  readonly threadLocation?: AgentWorkspaceLocation | null;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onRefreshIsolation?(): void;
  onSelectRepository(repositoryRoot: string): void;
  onOpenEnvironmentSettings?(): void;
}

const UNKNOWN_SERVER_NAME = "Server";

export const AgentComposerDrawerStart = memo(function AgentComposerDrawerStart({
  checkoutDisabled,
  executionServerId,
  followUp,
  isolation,
  onIsolationChange,
  onOpenEnvironmentSettings,
  onRefreshIsolation,
  onSelectRepository,
  previousWorktree = null,
  remote,
  target,
  threadLocation = null,
  worktreeAvailable,
  worktreeOnly,
}: AgentComposerDrawerStartProps) {
  const runner = useRemoteRunnerContext();
  const servers = runner?.servers ?? [];
  const serverName =
    executionServerId === null
      ? null
      : (servers.find((server) => server.id === executionServerId)?.name ?? UNKNOWN_SERVER_NAME);
  const strip = agentComposerStrip(
    followUp
      ? { kind: "started", location: threadLocation, isolation, serverName }
      : {
          kind: "draft",
          isolation,
          serverName,
          serversConfigured: servers.length > 0,
          previousWorktreeSelected: previousWorktree?.selected ?? false,
        },
  );
  const runOnPicker = strip.runOn.kind === "picker";
  const runOn = (
    <RunOn
      disabled={checkoutDisabled}
      onOpenEnvironmentSettings={onOpenEnvironmentSettings}
      runOn={strip.runOn}
    />
  );
  const divider =
    strip.runOn.kind === "hidden" ? null : (
      <span aria-hidden="true" className="agent-composer__divider" />
    );
  if (strip.checkout.kind === "label") {
    return (
      <>
        {runOn}
        {divider}
        <AgentComposerLockedCheckout checkout={strip.checkout.checkout} />
      </>
    );
  }
  return (
    <>
      {runOn}
      {divider}
      <AgentEnvironmentCheckoutPicker
        checkout={strip.checkout.checkout}
        disabled={checkoutDisabled}
        isolation={isolation}
        onIsolationChange={onIsolationChange}
        onOpenEnvironmentSettings={runOnPicker ? undefined : onOpenEnvironmentSettings}
        onRefreshIsolation={onRefreshIsolation}
        previousWorktree={previousWorktree}
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

function RunOn({
  disabled,
  onOpenEnvironmentSettings,
  runOn,
}: {
  readonly disabled: boolean;
  readonly runOn: AgentComposerStripRunOn;
  onOpenEnvironmentSettings?(): void;
}) {
  switch (runOn.kind) {
    case "hidden":
      return null;
    case "label":
      return <AgentComposerLockedMachine machine={runOn.machine} />;
    case "picker":
      return (
        <AgentRunOnPicker
          disabled={disabled}
          machine={runOn.machine}
          onOpenEnvironmentSettings={onOpenEnvironmentSettings}
        />
      );
  }
}
