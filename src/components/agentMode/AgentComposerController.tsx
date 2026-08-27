import { memo } from "react";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import { agentLaunchOptionsEqual } from "../../domain/agentLaunch";
import { AgentComposer } from "./AgentComposer";
import {
  useAgentComposerPromptState,
  type AgentComposerControllerProps as AgentComposerPresentation,
  type AgentComposerPromptController,
} from "./useAgentComposerState";

export interface AgentComposerControllerProps {
  readonly composerProps: AgentComposerPresentation;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly submissionBlocked: boolean;
  readonly submit: AgentComposerPromptController["submit"];
}

export const AgentComposerController = memo(function AgentComposerController({
  composerProps,
  modelFavoritesPersistence = null,
  submissionBlocked,
  submit,
}: AgentComposerControllerProps) {
  const controlledProps = useAgentComposerPromptState({
    composerProps,
    submissionBlocked,
    submit,
  });
  return (
    <AgentComposer {...controlledProps} modelFavoritesPersistence={modelFavoritesPersistence} />
  );
}, agentComposerControllerPropsEqual);

function agentComposerControllerPropsEqual(
  left: AgentComposerControllerProps,
  right: AgentComposerControllerProps,
): boolean {
  const leftProps = left.composerProps;
  const rightProps = right.composerProps;
  return (
    left.modelFavoritesPersistence === right.modelFavoritesPersistence &&
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
