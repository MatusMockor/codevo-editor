import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { memo, useMemo, useState, type ReactNode } from "react";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import { agentPendingRequestAvailability } from "../../application/agentPendingRequestReachability";
import { agentQuestionOwner } from "../../application/agentQuestionOwner";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";
import { agentLaunchOptionsEqual } from "../../domain/agentLaunch";
import { AgentComposer } from "./AgentComposer";
import { AgentCommandCatalogProjectContext } from "./useAgentCommandCatalogStore";
import { agentWorkspaceLocationEqual } from "./agentComposerThreadLocation";
import type { AgentEndSessionConfirmationView } from "./useAgentEndSessionCommand";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import {
  AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
  AGENT_QUESTION_REMOTE_ATTACHMENTS_UNAVAILABLE,
  type AgentComposerInteraction,
  type AgentComposerQuestionAttachmentTarget,
} from "./composer/agentComposerInteraction";
import { AgentComposerInteractionSource } from "./composer/AgentComposerInteractionSource";
import {
  useAgentComposerPromptState,
  type AgentComposerControllerProps as AgentComposerPresentation,
  type AgentComposerPromptController,
} from "./useAgentComposerState";

export interface AgentComposerInteractionsInput {
  readonly gateway: AgentQuestionGateway | null;
  readonly thread: AgentThreadView | null;
}

export interface AgentComposerControllerProps {
  readonly followUpBehavior?: AgentFollowUpBehavior;
  readonly executionServerId?: string | null;
  readonly compactionOffer?: AgentContextCompactionOffer | null;
  readonly composerProps: AgentComposerPresentation;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly submissionBlocked: boolean;
  readonly submit: AgentComposerPromptController["submit"];
  onOpenProviderSettings(): void;
  onOpenEnvironmentSettings?(): void;
  onShowUsageLimits?(): void;
  onOpenMcpServers?(): void;
  readonly banners?: ReactNode;
  readonly endSessionConfirmation?: AgentEndSessionConfirmationView | null;
  readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;
  readonly interactions?: AgentComposerInteractionsInput;
}

export const AgentComposerController = memo(function AgentComposerController({
  followUpBehavior = "queue",
  executionServerId = null,
  compactionOffer = null,
  composerProps,
  modelFavoritesPersistence = null,
  onOpenProviderSettings,
  onOpenEnvironmentSettings,
  onShowUsageLimits,
  onOpenMcpServers,
  providerManagement,
  providerEnabled,
  submissionBlocked,
  submit,
  banners,
  endSessionConfirmation = null,
  renderDrawerEnd,
  interactions,
}: AgentComposerControllerProps) {
  const controlledProps = useAgentComposerPromptState({
    composerProps,
    drafts: agentComposerDraftStore,
    submissionBlocked,
    submit,
  });
  const [interaction, setInteraction] = useState<AgentComposerInteraction | null>(null);
  const owner = interactions === undefined ? null : agentQuestionOwner(interactions.thread);
  const ownerKey = JSON.stringify(owner);
  const attachmentThreadId =
    owner?.kind === "local" ? (interactions?.thread?.thread.threadId ?? null) : null;
  const questionAttachments = useMemo(
    () => questionAttachmentTarget(owner?.kind ?? null, attachmentThreadId),
    [owner?.kind, attachmentThreadId],
  );
  const compactContext = (submission: Parameters<typeof submit>[1]): Promise<boolean> =>
    submit("/compact", submission, "compaction");
  return (
    <>
      {interactions !== undefined && (
        <AgentComposerInteractionSource
          availability={agentPendingRequestAvailability(interactions.thread)}
          gateway={interactions.gateway}
          key={ownerKey}
          onChange={setInteraction}
          owner={owner}
          questionAttachments={questionAttachments}
          running={interactions.thread?.lifecycle === "running"}
        />
      )}
      <AgentCommandCatalogProjectContext.Provider
        value={composerProps.commandCatalogProject ?? null}
      >
        <AgentComposer
          {...controlledProps}
          interaction={interactions === undefined ? null : interaction}
          followUpBehavior={followUpBehavior}
          executionServerId={executionServerId}
          compactionOffer={compactionOffer}
          modelFavoritesPersistence={modelFavoritesPersistence}
          onOpenProviderSettings={onOpenProviderSettings}
          onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          onShowUsageLimits={onShowUsageLimits}
          onOpenMcpServers={onOpenMcpServers}
          onCompactContext={compactContext}
          providerEnabled={providerEnabled}
          providerManagement={providerManagement}
          banners={banners}
          endSessionConfirmation={endSessionConfirmation}
          renderDrawerEnd={renderDrawerEnd}
        />
      </AgentCommandCatalogProjectContext.Provider>
    </>
  );
}, agentComposerControllerPropsEqual);

function agentComposerControllerPropsEqual(
  left: AgentComposerControllerProps,
  right: AgentComposerControllerProps,
): boolean {
  const leftProps = left.composerProps;
  const rightProps = right.composerProps;
  return (
    left.banners === right.banners &&
    (left.endSessionConfirmation ?? null) === (right.endSessionConfirmation ?? null) &&
    left.renderDrawerEnd === right.renderDrawerEnd &&
    sameInteractions(left.interactions, right.interactions) &&
    left.followUpBehavior === right.followUpBehavior &&
    left.executionServerId === right.executionServerId &&
    left.compactionOffer?.key === right.compactionOffer?.key &&
    left.modelFavoritesPersistence === right.modelFavoritesPersistence &&
    left.onOpenProviderSettings === right.onOpenProviderSettings &&
    left.onOpenEnvironmentSettings === right.onOpenEnvironmentSettings &&
    left.onShowUsageLimits === right.onShowUsageLimits &&
    left.onOpenMcpServers === right.onOpenMcpServers &&
    left.providerManagement === right.providerManagement &&
    left.providerEnabled === right.providerEnabled &&
    left.submissionBlocked === right.submissionBlocked &&
    left.submit === right.submit &&
    leftProps.draftKey === rightProps.draftKey &&
    leftProps.recovery === rightProps.recovery &&
    leftProps.queuedEdit === rightProps.queuedEdit &&
    leftProps.attachmentTargetKey === rightProps.attachmentTargetKey &&
    sameComposerAttachments(leftProps.attachments, rightProps.attachments) &&
    leftProps.dispatching === rightProps.dispatching &&
    leftProps.running === rightProps.running &&
    leftProps.sessionTasksStoppable === rightProps.sessionTasksStoppable &&
    leftProps.immediateBlockedReason === rightProps.immediateBlockedReason &&
    leftProps.promptOwnerKey === rightProps.promptOwnerKey &&
    leftProps.onStop === rightProps.onStop &&
    leftProps.onStopNow === rightProps.onStopNow &&
    leftProps.stopConfirmation === rightProps.stopConfirmation &&
    leftProps.sessionRestartConfirmation === rightProps.sessionRestartConfirmation &&
    sameGuard(leftProps.guard, rightProps.guard) &&
    leftProps.isolation === rightProps.isolation &&
    leftProps.isolationReason === rightProps.isolationReason &&
    leftProps.launchProvider === rightProps.launchProvider &&
    leftProps.worktreeAvailable === rightProps.worktreeAvailable &&
    leftProps.worktreeOnly === rightProps.worktreeOnly &&
    leftProps.worktreeOnlyReason === rightProps.worktreeOnlyReason &&
    leftProps.onIsolationChange === rightProps.onIsolationChange &&
    leftProps.onWorktreeBaseChange === rightProps.onWorktreeBaseChange &&
    sameWorktreeBase(leftProps.worktreeBase, rightProps.worktreeBase) &&
    (leftProps.remoteGit ?? null) === (rightProps.remoteGit ?? null) &&
    sameCommandCatalogProject(leftProps.commandCatalogProject, rightProps.commandCatalogProject) &&
    leftProps.onRefreshIsolation === rightProps.onRefreshIsolation &&
    leftProps.onLaunchChange === rightProps.onLaunchChange &&
    leftProps.onNewThread === rightProps.onNewThread &&
    leftProps.onSelectRepository === rightProps.onSelectRepository &&
    sameComposerMode(leftProps.mode, rightProps.mode) &&
    sameComposerTarget(leftProps.target, rightProps.target) &&
    agentWorkspaceLocationEqual(leftProps.threadLocation, rightProps.threadLocation) &&
    samePreviousWorktree(leftProps.previousWorktree, rightProps.previousWorktree) &&
    agentLaunchOptionsEqual(leftProps.launch, rightProps.launch)
  );
}

function sameCommandCatalogProject(
  left: AgentComposerPresentation["commandCatalogProject"],
  right: AgentComposerPresentation["commandCatalogProject"],
): boolean {
  const current = left ?? null;
  const next = right ?? null;
  if (current === null || next === null) return current === next;
  return (
    current.serverId === next.serverId &&
    current.runnerId === next.runnerId &&
    current.projectId === next.projectId
  );
}

function samePreviousWorktree(
  left: AgentComposerPresentation["previousWorktree"],
  right: AgentComposerPresentation["previousWorktree"],
): boolean {
  const current = left ?? null;
  const next = right ?? null;
  if (current === null || next === null) return current === next;
  return (
    current.selected === next.selected &&
    current.onSelect === next.onSelect &&
    current.available.threadId === next.available.threadId &&
    current.available.worktreePath === next.available.worktreePath &&
    current.available.branch === next.available.branch
  );
}

function questionAttachmentTarget(
  ownerKind: "local" | "remote" | null,
  threadId: string | null,
): AgentComposerQuestionAttachmentTarget {
  if (threadId !== null) return { kind: "thread", threadId };
  if (ownerKind === "remote") {
    return { kind: "unavailable", reason: AGENT_QUESTION_REMOTE_ATTACHMENTS_UNAVAILABLE };
  }
  return { kind: "unavailable", reason: AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE };
}

function sameInteractions(
  left: AgentComposerInteractionsInput | undefined,
  right: AgentComposerInteractionsInput | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.gateway !== right.gateway) return false;
  if (left.thread?.lifecycle !== right.thread?.lifecycle) return false;
  if (
    agentPendingRequestAvailability(left.thread) !== agentPendingRequestAvailability(right.thread)
  )
    return false;
  return (
    JSON.stringify(agentQuestionOwner(left.thread)) ===
    JSON.stringify(agentQuestionOwner(right.thread))
  );
}

function sameComposerAttachments(
  left: AgentComposerPresentation["attachments"],
  right: AgentComposerPresentation["attachments"],
): boolean {
  const current = left ?? null;
  const next = right ?? null;
  if (current === null || next === null) return current === next;
  return current.drafts === next.drafts && current.refusal === next.refusal;
}

function sameComposerMode(
  left: AgentComposerPresentation["mode"],
  right: AgentComposerPresentation["mode"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "steer" && right.kind === "steer") return left.threadId === right.threadId;
  if (left.kind !== "followUp" || right.kind !== "followUp") return true;
  return left.blockedReason === right.blockedReason;
}

function sameComposerTarget(
  left: AgentComposerPresentation["target"],
  right: AgentComposerPresentation["target"],
): boolean {
  if (left === null || right === null) return left === right;
  if (left.projectLabel !== right.projectLabel) return false;
  if (left.projectRoot !== right.projectRoot) return false;
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

function sameWorktreeBase(
  left: AgentComposerPresentation["worktreeBase"],
  right: AgentComposerPresentation["worktreeBase"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind === "ref" && right.kind === "ref") return left.ref === right.ref;
  return left.kind === right.kind;
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
