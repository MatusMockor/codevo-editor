import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import {
  remoteThreadSelectionBlocksComposer,
  type RemoteThreadSelection,
} from "../../../domain/remoteThreadSelection";
import type { RemoteRunnerContextValue } from "../../remoteRunner/remoteRunnerContext";
import { agentComposerThreadLocation } from "../agentComposerThreadLocation";
import { newThreadEnvironmentProjectRootKey } from "../agentEnvironmentProjects";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentComposerControllerState } from "../useAgentComposerState";
import { useAgentOwnedStartingThreads } from "../useAgentOwnedStartingThreads";
import { agentProjectGroupIsLinked } from "../useAgentProjectThreadCommands";
import { useAgentQueuedFollowUpEdit } from "../useAgentQueuedFollowUpEdit";
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
} from "../useAgentQueuedEditImagePreviews";
import { useAgentSessionBackgroundControls } from "../useAgentSessionBackgroundControls";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import { useAgentStableValue } from "./useAgentStableValue";
import {
  NO_REMOTE_SERVERS,
  type AgentModeAgents,
  type AgentModeNoticeReporter,
} from "./agentModeViewProps";
import type { AgentModeProjects } from "./useAgentModeProjects";
import {
  remoteThreadComposerBlockedReason,
  useAgentModeRemoteThreadRecovery,
} from "./useAgentModeRemoteThreadRecovery";
import type { AgentModeScope } from "./useAgentModeScope";

const COMPOSER_PROPS_DEPTH = 4;

export interface AgentModeComposerOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly scope: AgentModeScope;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThreadId: string | null;
  readonly selectedThread: AgentThreadView | null;
  readonly sessionThread: AgentThreadView | null;
  readonly selectedServerId: string | null;
  readonly effectiveProviderEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly remoteThreadSelection: RemoteThreadSelection;
  readonly remoteContext: RemoteRunnerContextValue | null;
  readonly setLocalNotice: AgentModeNoticeReporter;
  readonly setProjectSelectionIntent: Dispatch<SetStateAction<number>>;
  onSelectProjectEnvironment(rootKey: string): void;
}

export function useAgentModeComposer({
  agents,
  chrome,
  navigation,
  projectsState,
  scope,
  projects,
  selectedThreadId,
  selectedThread,
  sessionThread,
  selectedServerId,
  effectiveProviderEnabled,
  remoteThreadSelection,
  remoteContext,
  setLocalNotice,
  setProjectSelectionIntent,
  onSelectProjectEnvironment,
}: AgentModeComposerOptions) {
  const { groups, projectRename } = projectsState;
  const { draft, composerScope, composerProjects } = scope;
  const queuedEdit = useAgentQueuedFollowUpEdit(agents, selectedThreadId);
  const previewedQueuedEdit = useAgentQueuedEditImagePreviews(
    queuedEdit.edit,
    agents.attachmentImages,
    queuedEditImageOwner(selectedThread),
  );
  const requestEndSessionRef = useRef<(threadId: string) => void>(() => undefined);
  const sessionBackground = useAgentSessionBackgroundControls(
    agents,
    sessionThread,
    setLocalNotice,
    requestEndSessionRef,
  );
  const composer = useAgentComposerControllerState({
    agents,
    sessionStop: sessionBackground.sessionStop,
    groups: projectRename.executionGroups,
    queuedEdit: previewedQueuedEdit,
    projects: composerProjects,
    providerEnabled: effectiveProviderEnabled,
    railScope: composerScope,
    selectedThread,
    onClearSelectedThread: navigation.clearSelectedThread,
    onThreadStarted: navigation.selectStartedThread,
    onSelectProjectEnvironment,
  });
  const startingThreads = useAgentOwnedStartingThreads(composer.startingThreads, projects);
  const submitComposer = useAgentLatestCallback(composer.submit);
  const changeIsolation = useAgentLatestCallback(composer.composerProps.onIsolationChange);
  const changeLaunch = useAgentLatestCallback(composer.composerProps.onLaunchChange);
  const resetDraftLaunch = useAgentLatestCallback((projectRootKey: string | null) => {
    composer.resetDraftLaunch(
      newThreadEnvironmentProjectRootKey(
        projectRootKey,
        groups,
        projects,
        selectedServerId,
        navigation.composerScope,
      ),
    );
  });
  const resetProjectDraftLaunch = useAgentLatestCallback((projectRootKey: string) => {
    composer.resetDraftLaunch(
      newThreadEnvironmentProjectRootKey(projectRootKey, groups, projects, selectedServerId),
    );
  });
  const clearComposer = useAgentLatestCallback(() => {
    resetDraftLaunch(draft.rootKey ?? navigation.newThreadTarget()?.projectRootKey ?? null);
    composer.clearSelection();
  });
  const startRemoteFallbackThread = useAgentLatestCallback(() => {
    const projectRootKey = navigation.newThreadTarget()?.projectRootKey ?? draft.rootKey ?? null;
    if (projectRootKey !== null && !agentProjectGroupIsLinked(groups, projectRootKey))
      onSelectProjectEnvironment(projectRootKey);
    resetDraftLaunch(projectRootKey);
    composer.clearSelection();
  });
  const remoteThreadBanner = useAgentModeRemoteThreadRecovery({
    selection: remoteThreadSelection,
    selectedThreadId,
    remoteContext,
    startNewThread: startRemoteFallbackThread,
  });
  const resolvingRemoteThread = remoteThreadSelectionBlocksComposer(remoteThreadSelection);
  const remoteThreadBlockedReason = remoteThreadComposerBlockedReason(remoteThreadSelection);
  const selectComposerRepository = useAgentLatestCallback((repositoryRoot: string) => {
    chrome.addProject?.cancelSelection?.();
    setProjectSelectionIntent((current) => current + 1);
    composer.composerProps.onSelectRepository(repositoryRoot);
  });
  const liveThreadLocation = useMemo(
    () =>
      agentComposerThreadLocation(
        selectedThread,
        remoteContext?.servers ?? NO_REMOTE_SERVERS,
        chrome.liveCheckoutBranches,
      ),
    [chrome.liveCheckoutBranches, remoteContext?.servers, selectedThread],
  );
  const composerThreadLocation = useAgentStableValue(liveThreadLocation);
  const {
    onIsolationChange: _isolationChange,
    onLaunchChange: _launchChange,
    onNewThread: _newThread,
    onSelectRepository: _selectRepository,
    ...liveComposerFields
  } = composer.composerProps;
  const baseComposerProps = useAgentStableValue(liveComposerFields, COMPOSER_PROPS_DEPTH);
  const remoteExecution = selectedThread?.execution?.kind === "remote";
  const remoteTaskSteering = selectedThread?.execution?.taskSteering === true;
  const composerProps = useMemo(
    () => ({
      ...baseComposerProps,
      immediateBlockedReason: remoteExecution
        ? remoteTaskSteering
          ? null
          : "Update the server to send messages during a run. Queued messages remain available."
        : baseComposerProps.immediateBlockedReason,
      ...(resolvingRemoteThread
        ? {
            mode: {
              kind: "followUp" as const,
              blockedReason: remoteThreadBlockedReason,
            },
            draftKey: selectedThreadId,
            promptOwnerKey: selectedThreadId!,
            target: null,
            attachments: null,
            isolation: "worktree" as const,
          }
        : {}),
      threadLocation: composerThreadLocation,
      onIsolationChange: changeIsolation,
      onLaunchChange: changeLaunch,
      onNewThread: clearComposer,
      onSelectRepository: selectComposerRepository,
    }),
    [
      baseComposerProps,
      changeIsolation,
      changeLaunch,
      clearComposer,
      composerThreadLocation,
      remoteExecution,
      remoteTaskSteering,
      remoteThreadBlockedReason,
      resolvingRemoteThread,
      selectComposerRepository,
      selectedThreadId,
    ],
  );
  return {
    queuedEdit,
    requestEndSessionRef,
    sessionBackground,
    composer,
    startingThreads,
    submitComposer,
    resetDraftLaunch,
    resetProjectDraftLaunch,
    composerProps,
    remoteThreadBanner,
  };
}

export type AgentModeComposer = ReturnType<typeof useAgentModeComposer>;
