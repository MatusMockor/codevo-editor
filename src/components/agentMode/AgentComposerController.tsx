import { memo } from "react";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";
import { agentLaunchOptionsEqual } from "../../domain/agentLaunch";
import { AgentComposer } from "./AgentComposer";
import {
  useAgentComposerPromptState,
  type AgentComposerControllerProps as AgentComposerPresentation,
  type AgentComposerPromptController,
} from "./useAgentComposerState";

export interface AgentComposerControllerProps {
  readonly compactionOffer?: AgentContextCompactionOffer | null;
  readonly composerProps: AgentComposerPresentation;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly submissionBlocked: boolean;
  readonly submit: AgentComposerPromptController["submit"];
  onOpenProviderSettings(): void;
}

export const AgentComposerController = memo(function AgentComposerController({
  compactionOffer = null,
  composerProps,
  modelFavoritesPersistence = null,
  onOpenProviderSettings,
  providerManagement,
  providerEnabled,
  submissionBlocked,
  submit,
}: AgentComposerControllerProps) {
  const controlledProps = useAgentComposerPromptState({
    composerProps,
    submissionBlocked,
    submit,
  });
  const compactContext = (submission: Parameters<typeof submit>[1]): void => {
    void submit("/compact", submission);
  };
  return (
    <AgentComposer
      {...controlledProps}
      compactionOffer={compactionOffer}
      modelFavoritesPersistence={modelFavoritesPersistence}
      onOpenProviderSettings={onOpenProviderSettings}
      onCompactContext={compactContext}
      providerEnabled={providerEnabled}
      providerManagement={providerManagement}
    />
  );
}, agentComposerControllerPropsEqual);

function agentComposerControllerPropsEqual(
  left: AgentComposerControllerProps,
  right: AgentComposerControllerProps,
): boolean {
  const leftProps = left.composerProps;
  const rightProps = right.composerProps;
  return (
    left.compactionOffer?.key === right.compactionOffer?.key &&
    left.modelFavoritesPersistence === right.modelFavoritesPersistence &&
    left.onOpenProviderSettings === right.onOpenProviderSettings &&
    left.providerManagement === right.providerManagement &&
    left.providerEnabled === right.providerEnabled &&
    left.submissionBlocked === right.submissionBlocked &&
    left.submit === right.submit &&
    leftProps.dangerousConfirmed === rightProps.dangerousConfirmed &&
    leftProps.dispatching === rightProps.dispatching &&
    leftProps.isolation === rightProps.isolation &&
    leftProps.isolationReason === rightProps.isolationReason &&
    leftProps.launchProvider === rightProps.launchProvider &&
    leftProps.unsafeConfirmed === rightProps.unsafeConfirmed &&
    leftProps.worktreeOnly === rightProps.worktreeOnly &&
    leftProps.worktreeOnlyReason === rightProps.worktreeOnlyReason &&
    leftProps.onDangerousConfirmedChange === rightProps.onDangerousConfirmedChange &&
    leftProps.onIsolationChange === rightProps.onIsolationChange &&
    leftProps.onLaunchChange === rightProps.onLaunchChange &&
    leftProps.onNewThread === rightProps.onNewThread &&
    leftProps.onSelectRepository === rightProps.onSelectRepository &&
    leftProps.onUnsafeConfirmedChange === rightProps.onUnsafeConfirmedChange &&
    sameComposerMode(leftProps.mode, rightProps.mode) &&
    sameComposerTarget(leftProps.target, rightProps.target) &&
    sameGuard(leftProps.guard, rightProps.guard) &&
    agentLaunchOptionsEqual(leftProps.launch, rightProps.launch)
  );
}

function sameComposerMode(
  left: AgentComposerPresentation["mode"],
  right: AgentComposerPresentation["mode"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "new" || right.kind === "new") return true;
  return left.threadTitle === right.threadTitle && left.blockedReason === right.blockedReason;
}

function sameComposerTarget(
  left: AgentComposerPresentation["target"],
  right: AgentComposerPresentation["target"],
): boolean {
  if (left === null || right === null) return left === right;
  if (left.projectLabel !== right.projectLabel) return false;
  if (left.selectedRepositoryRoot !== right.selectedRepositoryRoot) return false;
  if (left.repositoryOptions.length !== right.repositoryOptions.length) return false;
  return left.repositoryOptions.every((option, index) => {
    const candidate = right.repositoryOptions[index];
    return (
      candidate !== undefined &&
      option.repositoryRoot === candidate.repositoryRoot &&
      option.label === candidate.label
    );
  });
}

function sameGuard(
  left: AgentComposerPresentation["guard"],
  right: AgentComposerPresentation["guard"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "safe" || right.kind === "safe") return true;
  if (left.reasons.length !== right.reasons.length) return false;
  return left.reasons.every((reason, index) => reason === right.reasons[index]);
}
