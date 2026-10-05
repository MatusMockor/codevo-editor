import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type { WorkspaceTrustOrigin } from "../../domain/trust";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import { AgentComposer, type AgentComposerSubmission } from "./AgentComposer";
import { CloneProgressBanner } from "../projects/CloneProgressBanner";
import { ProjectTrustBanner } from "../projects/ProjectTrustBanner";
import { cloneBannerModel, clonePlaceholder } from "../projects/cloneBannerModel";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentComposerPromptBytes,
  useAgentComposerControllerState,
  type AgentComposerSurface,
} from "./useAgentComposerState";
import type { useAgentProjectCreation } from "./useAgentProjectCreation";
import type { AgentEndSessionConfirmationView } from "./useAgentEndSessionCommand";

interface Props {
  readonly creation: Pick<
    ReturnType<typeof useAgentProjectCreation>,
    | "pending"
    | "pendingClone"
    | "attachmentsStore"
    | "completedProject"
    | "draft"
    | "launch"
    | "isolation"
    | "changeDraft"
    | "changeLaunch"
    | "changeIsolation"
    | "dismiss"
    | "hidePending"
    | "activateCompleted"
    | "cancel"
    | "retry"
    | "canRetry"
    | "error"
    | "localCloneDetail"
  >;
  readonly agents: AgentComposerSurface;
  readonly projects: readonly AgentProjectDescriptor[];
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly modelFavoritesPersistence: AgentModelFavoritesPersistence | null;
  readonly endSessionConfirmation?: AgentEndSessionConfirmationView | null;
  onThreadStarted(threadId: string): void;
  onOpenProviderSettings(): void;
  onOpenEnvironmentSettings?(): void;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
}
const NOOP = () => undefined;

/** A clone draft uses the same composer, launch controls and dispatch guards as any new thread. */
export function AgentCloneComposer({
  creation,
  agents,
  projects,
  providerEnabled,
  providerManagement,
  modelFavoritesPersistence,
  endSessionConfirmation = null,
  onThreadStarted,
  onOpenProviderSettings,
  onOpenEnvironmentSettings,
  onTrustProject,
}: Props) {
  const [dispatching, setDispatching] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = creation.pending!;
  const clone = creation.pendingClone!;
  const key = pending.draftKey ?? `clone:${pending.environment ?? "local"}:${pending.id}`;
  const store = creation.attachmentsStore;
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const attachments = store.forClone(key, pending.environment === null ? "local" : "remote");
  const retainedProject = creation.completedProject;
  const candidate =
    projects.find(
      (candidate) =>
        retainedProject !== null &&
        candidate.rootKey === retainedProject.rootKey &&
        candidate.ownerId === retainedProject.ownerId &&
        candidate.generation === retainedProject.generation,
    ) ?? null;
  const stableProject = useRef<AgentProjectDescriptor | null>(null);
  if (!sameCloneProject(stableProject.current, candidate)) stableProject.current = candidate;
  const project = stableProject.current;
  const bannerModel = cloneBannerModel({
    status: clone.status,
    name: pending.name,
    error: creation.error ?? clone.error,
    environment: pending.environment === null ? "local" : "remote",
    projectReady: project !== null,
    canRetry: creation.canRetry,
    detail: creation.localCloneDetail,
  });
  const source = creation.localCloneDetail?.source ?? null;
  const awaitingTrust = project !== null && project.trust !== "trusted";
  const reviewTrust = () => {
    if (project === null) return;
    onTrustProject(
      project.rootKey,
      source === null ? { kind: "local" } : { kind: "clone", host: source.host, path: source.path },
    );
  };
  const authority = useRef({ key, project, attachments: agents.attachments });
  authority.current = { key, project, attachments: agents.attachments };
  useLayoutEffect(() => {
    const forDraft = authority.current.attachments.forDraft;
    if (project === null || forDraft === undefined) {
      store.bind(key, null);
      return;
    }
    const captured = project;
    store.bind(key, {
      projectKey: captured.rootKey,
      getTarget: () => forDraft(`clone-ready:${key}`),
      isCurrent: () => authority.current.key === key && authority.current.project === captured,
    });
    return () => store.bind(key, null);
  }, [key, project, store]);
  const clonedProjects = useMemo(() => (project === null ? [] : [project]), [project]);
  const groups = useMemo(() => agentProjectGroups(clonedProjects, [], []), [clonedProjects]);
  const cloneAgents = { ...agents, attachments };
  const started = useCallback(
    (threadId: string) => {
      if (!mounted.current) return;
      creation.changeDraft("");
      creation.dismiss();
      store.removeClone(key);
      onThreadStarted(threadId);
    },
    [creation, key, onThreadStarted, store],
  );
  const controller = useAgentComposerControllerState({
    agents: cloneAgents,
    groups,
    projects: clonedProjects,
    providerEnabled,
    selectedThread: null,
    railScope:
      project === null
        ? { kind: "missing", projectRootKey: key, repositoryRoot: key }
        : {
            kind: "project",
            projectRootKey: project.rootKey,
            repositoryRoot: project.rootPath,
            ownerId: project.ownerId,
            generation: project.generation,
          },
    onClearSelectedThread: NOOP,
    onThreadStarted: started,
  });
  const state = controller.composerProps;
  const launch = creation.launch ?? state.launch;
  const isolation = state.worktreeOnly ? "worktree" : creation.isolation;
  useLayoutEffect(() => {
    if (creation.launch === null) creation.changeLaunch(launch);
  }, [creation, launch]);
  const changeControllerIsolation = state.onIsolationChange;
  useLayoutEffect(() => {
    if (project !== null) changeControllerIsolation(isolation);
  }, [project, isolation, changeControllerIsolation]);
  useLayoutEffect(() => {
    if (pending.target !== null && creation.completedProject === null) creation.activateCompleted();
  }, [creation, pending.target]);
  const promptBytes = agentComposerPromptBytes(creation.draft, attachments);
  const draftEmpty =
    creation.draft.trim() === "" && attachments.drafts.every((draft) => draft.state !== "ready");
  const blocked =
    dispatching ||
    project === null ||
    controller.submissionBlocked ||
    attachments.blocked ||
    state.isolation !== isolation ||
    promptBytes > MAX_AGENT_TASK_PROMPT_BYTES ||
    draftEmpty;
  const submit = (submission: AgentComposerSubmission) => {
    if (awaitingTrust) {
      if (!draftEmpty) reviewTrust();
      return;
    }
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setDispatching(true);
    void controller.submit(creation.draft, submission).finally(() => {
      inFlight.current = false;
      if (mounted.current) setDispatching(false);
    });
  };
  return (
    <div className="agent-clone-composer">
      <AgentComposer
        {...state}
        banners={
          awaitingTrust ? (
            <ProjectTrustBanner onReview={reviewTrust} />
          ) : (
            <CloneProgressBanner
              model={bannerModel}
              onCancel={creation.cancel}
              onHide={creation.hidePending}
              onRemove={creation.dismiss}
              onRetry={creation.retry}
            />
          )
        }
        endSessionConfirmation={endSessionConfirmation}
        placeholder={clonePlaceholder(bannerModel)}
        mode={{ kind: "new" }}
        executionServerId={pending.environment}
        target={
          state.target ?? {
            projectLabel: pending.name,
            projectRoot: pending.name,
            selectedRepositoryRoot: pending.name,
            repositoryOptions: [],
          }
        }
        attachments={attachments}
        attachmentTargetKey={project?.rootKey ?? key}
        promptOwnerKey={key}
        prompt={creation.draft}
        promptBytes={promptBytes}
        onPromptChange={creation.changeDraft}
        launch={launch}
        launchProvider={launch.provider}
        onLaunchChange={creation.changeLaunch}
        isolation={isolation}
        onIsolationChange={creation.changeIsolation}
        onSelectRepository={NOOP}
        onNewThread={creation.hidePending}
        dispatching={state.dispatching || dispatching}
        submitBlocked={awaitingTrust ? draftEmpty : blocked}
        onSubmit={submit}
        providerEnabled={providerEnabled}
        providerManagement={providerManagement}
        modelFavoritesPersistence={modelFavoritesPersistence}
        onOpenProviderSettings={onOpenProviderSettings}
        onOpenEnvironmentSettings={onOpenEnvironmentSettings}
      />
    </div>
  );
}

function sameCloneProject(
  left: AgentProjectDescriptor | null,
  right: AgentProjectDescriptor | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation &&
    left.rootPath === right.rootPath &&
    left.trust === right.trust &&
    left.isolationPolicy === right.isolationPolicy
  );
}
