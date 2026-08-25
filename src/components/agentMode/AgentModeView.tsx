import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, X } from "lucide-react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { MAX_AGENT_TASK_PROMPT_BYTES, type AgentTaskIsolation } from "../../domain/agentTask";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import {
  AgentComposer,
  type AgentComposerMode,
  type AgentComposerProjectOption,
} from "./AgentComposer";
import type { AgentShipActions } from "./AgentShipPanel";
import { AgentThreadInfoColumn } from "./AgentThreadInfoColumn";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import {
  agentFollowUpBlockedReason,
  agentIsolationReasonLabel,
  agentProjectGroups,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
  agentPromptByteLength,
  agentShipStatusUnread,
  agentThreadDisplayTitle,
} from "./agentModePresentation";

export interface AgentModeViewProps {
  readonly agents: AgentThreadsSurface;
  readonly workspaceRoot: string | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly nowTickMs?: number;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
}

interface ComposerTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

const DEFAULT_NOW_TICK_MS = 30_000;

export function AgentModeView({
  agents,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  onReleaseProject,
  onTrustProject,
  overflowRootPaths,
  projects,
}: AgentModeViewProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [collapsedProjectRootKeys, setCollapsedProjectRootKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedRepositoryRoots, setCollapsedRepositoryRoots] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedArchivedRoots, setExpandedArchivedRoots] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selection, setSelection] = useState<ComposerTarget | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [unsafeConfirmed, setUnsafeConfirmed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), nowTickMs);
    return () => clearInterval(timer);
  }, [nowTickMs]);

  const groups = useMemo(
    () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, agents.threads],
  );

  const composerProjects = useMemo<ReadonlyArray<AgentComposerProjectOption>>(
    () =>
      groups
        .filter(
          (group) =>
            group.kind === "project" &&
            group.trust === "trusted" &&
            group.origin !== "closed-tab-live-tasks",
        )
        .map((group) => ({
          projectRootKey: group.projectRootKey,
          label: group.label,
          repositories: group.repos
            .filter((repo) => repo.repositoryResolved)
            .map((repo) => ({
              repositoryRoot: repo.repositoryRoot,
              label: repo.label,
            })),
        }))
        .filter((option) => option.repositories.length > 0),
    [groups],
  );

  const target = resolveComposerTarget(composerProjects, selection);
  const composerRoot = target?.repositoryRoot ?? null;
  const composerProject =
    projects.find((project) => project.rootKey === target?.projectRootKey) ?? null;
  const composerLabel =
    groups.flatMap((group) => group.repos).find((repo) => repo.repositoryRoot === composerRoot)
      ?.label ?? null;
  const worktreeOnly = composerProject !== null && agentProjectWorktreeOnly(composerProject.origin);
  const worktreeOnlyReason =
    composerProject === null ? null : agentProjectWorktreeOnlyReason(composerProject.origin);

  const selectedThread =
    agents.threads.find((view) => view.thread.threadId === selectedThreadId) ?? null;

  const unreadShipThreadId =
    selectedThread !== null && agentShipStatusUnread(selectedThread)
      ? selectedThread.thread.threadId
      : null;
  const refreshShipStatus = agents.refreshShipStatus;
  useEffect(() => {
    if (unreadShipThreadId === null) return;
    void refreshShipStatus(unreadShipThreadId);
  }, [refreshShipStatus, unreadShipThreadId]);

  const preview = composerRoot === null ? null : agents.isolationPreview(composerRoot);
  const refreshIsolationStatus = agents.refreshIsolationStatus;
  useEffect(() => {
    if (composerRoot === null) return;
    void refreshIsolationStatus(composerRoot);
  }, [composerRoot, refreshIsolationStatus]);
  const recommended: AgentTaskIsolation =
    preview === null || preview.recommended.kind === "in-place" ? "in-place" : "worktree";
  const chosen: AgentTaskIsolation =
    isolationChoice !== null && isolationChoice.repositoryRoot === composerRoot
      ? isolationChoice.isolation
      : recommended;
  const isolation: AgentTaskIsolation = worktreeOnly ? "worktree" : chosen;
  const guard = preview?.inPlaceGuard ?? { kind: "safe" as const };
  const confirmed =
    preview?.confirmationKey !== null && unsafeConfirmed === preview?.confirmationKey;
  const promptBytes = agentPromptByteLength(prompt);
  const promptEmpty = prompt.trim() === "" || promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const composerMode = useComposerMode(selectedThread, agents);
  const submitBlocked =
    agents.dispatching ||
    promptEmpty ||
    (selectedThread === null &&
      (target === null || (isolation === "in-place" && guard.kind === "unsafe" && !confirmed)));

  const toggleProject = useCallback((projectRootKey: string) => {
    setCollapsedProjectRootKeys((current) => toggled(current, projectRootKey));
  }, []);

  const toggleGroup = useCallback((repositoryRoot: string) => {
    setCollapsedRepositoryRoots((current) => toggled(current, repositoryRoot));
  }, []);

  const toggleArchived = useCallback((repositoryRoot: string) => {
    setExpandedArchivedRoots((current) => toggled(current, repositoryRoot));
  }, []);

  const startNewThread = useCallback((projectRootKey: string, repositoryRoot: string) => {
    setSelectedThreadId(null);
    setSelection({ projectRootKey, repositoryRoot });
    setUnsafeConfirmed(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedThreadId(null);
    setUnsafeConfirmed(null);
  }, []);

  const sendFollowUp = agents.sendFollowUp;
  const startThread = agents.startThread;
  const followUpThreadId = selectedThread?.thread.threadId ?? null;

  const submit = useCallback(() => {
    if (followUpThreadId !== null) {
      void sendFollowUp({ threadId: followUpThreadId, prompt }).then((sent) => {
        if (!sent) return;
        setPrompt("");
      });
      return;
    }
    if (target === null) return;
    void startThread({
      projectRootKey: target.projectRootKey,
      repositoryRoot: target.repositoryRoot,
      prompt,
      isolation,
      unsafeInPlaceConfirmationKey: confirmed ? (preview?.confirmationKey ?? null) : null,
    }).then((started) => {
      if (started === null) return;
      setPrompt("");
      setUnsafeConfirmed(null);
      setSelectedThreadId(started.threadId);
    });
  }, [
    confirmed,
    followUpThreadId,
    isolation,
    preview?.confirmationKey,
    prompt,
    sendFollowUp,
    startThread,
    target,
  ]);

  const shipActions = useAgentShipActions(agents);

  const remove = useCallback(
    (threadId: string) => {
      agents.remove(threadId);
      setSelectedThreadId((current) => (current === threadId ? null : current));
    },
    [agents],
  );

  return (
    <section aria-label="Agent mode" className="agent-mode">
      {agents.notice && (
        <AgentNoticeBar
          notice={agents.notice}
          onConfigure={() => agents.configureAgentCli()}
          onDismiss={() => agents.dismissNotice()}
        />
      )}
      <div className="agent-mode__grid">
        <AgentThreadsSidebar
          collapsedProjectRootKeys={collapsedProjectRootKeys}
          collapsedRepositoryRoots={collapsedRepositoryRoots}
          expandedArchivedRoots={expandedArchivedRoots}
          groups={groups}
          liveTaskCount={agents.liveTaskCount}
          maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
          now={now}
          onNewThread={startNewThread}
          onPruneOrphans={(root) => void agents.pruneOrphanedWorktrees(root)}
          onReleaseProject={onReleaseProject}
          onRemoveOrphan={(worktreePath) => void agents.removeOrphanedWorktree(worktreePath)}
          onSelectThread={setSelectedThreadId}
          onToggleArchived={toggleArchived}
          onToggleGroup={toggleGroup}
          onToggleProject={toggleProject}
          onTogglePin={(threadId) => agents.togglePin(threadId)}
          onTrustProject={onTrustProject}
          overflowRootPaths={overflowRootPaths}
          selectedThreadId={selectedThread?.thread.threadId ?? null}
        />

        <div className="agent-mode__center">
          <AgentThreadSession
            composerRepositoryLabel={composerLabel}
            now={now}
            onHideChanges={(threadId) => agents.hideChanges(threadId)}
            onHideFileDiff={(threadId) => agents.hideFileDiff(threadId)}
            onOpenChangedFile={(threadId, change) => void agents.openChangedFile(threadId, change)}
            onOpenChangedFileDiff={(threadId, change) =>
              void agents.openChangedFileDiff(threadId, change)
            }
            onRefreshChanges={(threadId) => void agents.showChanges(threadId)}
            onShowFileDiff={(threadId, change) => void agents.showFileDiff(threadId, change)}
            shipActions={shipActions}
            thread={selectedThread}
          />
          <AgentComposer
            dispatching={agents.dispatching}
            guard={guard}
            isolation={isolation}
            isolationReason={
              preview === null ? null : agentIsolationReasonLabel(preview.recommended)
            }
            mode={composerMode}
            onIsolationChange={(next) => {
              if (composerRoot === null) return;
              setIsolationChoice({ repositoryRoot: composerRoot, isolation: next });
              setUnsafeConfirmed(null);
            }}
            onNewThread={clearSelection}
            onPromptChange={setPrompt}
            onSelectProject={(projectRootKey) => {
              setSelection({ projectRootKey, repositoryRoot: "" });
              setUnsafeConfirmed(null);
            }}
            onSelectRepository={(repositoryRoot) => {
              if (target === null) return;
              setSelection({ projectRootKey: target.projectRootKey, repositoryRoot });
              setUnsafeConfirmed(null);
            }}
            onSubmit={submit}
            onUnsafeConfirmedChange={(next) =>
              setUnsafeConfirmed(next ? (preview?.confirmationKey ?? null) : null)
            }
            projects={composerProjects}
            prompt={prompt}
            promptBytes={promptBytes}
            selectedProjectRootKey={target?.projectRootKey ?? null}
            selectedRepositoryRoot={composerRoot}
            submitBlocked={submitBlocked}
            unsafeConfirmed={confirmed}
            worktreeOnly={worktreeOnly}
            worktreeOnlyReason={worktreeOnlyReason}
          />
        </div>

        <AgentThreadInfoColumn
          composerIsolationReason={
            preview === null ? null : agentIsolationReasonLabel(preview.recommended)
          }
          composerRepositoryLabel={composerLabel}
          composerRepositoryRoot={composerRoot}
          liveTaskCount={agents.liveTaskCount}
          maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
          now={now}
          onArchive={(threadId) => agents.archive(threadId)}
          onRemove={remove}
          onRemoveWorktree={(threadId) => void agents.removeWorktree(threadId)}
          onShowChanges={(threadId) => void agents.showChanges(threadId)}
          onStop={(threadId) => void agents.stop(threadId)}
          onTogglePin={(threadId) => agents.togglePin(threadId)}
          thread={selectedThread}
        />
      </div>
    </section>
  );
}

function useAgentShipActions(agents: AgentThreadsSurface): AgentShipActions {
  return useMemo<AgentShipActions>(
    () => ({
      onRefreshShipStatus: (threadId) => void agents.refreshShipStatus(threadId),
      onCommit: (threadId, message) => void agents.commitThreadChanges(threadId, message),
      onPush: (threadId) => void agents.pushThreadBranch(threadId),
      onOpenCompareUrl: (threadId) => void agents.openThreadCompareUrl(threadId),
      onIntegrate: (threadId, mode) => void agents.integrateThreadBranch(threadId, mode),
      onRemoveWorktree: (threadId, options) => void agents.removeThreadWorktree(threadId, options),
      onDiscardWorktree: (threadId) => void agents.removeWorktree(threadId),
      onDismissFailure: (threadId) => agents.resetThreadShip(threadId),
    }),
    [agents],
  );
}

function useComposerMode(
  selectedThread: AgentThreadView | null,
  agents: AgentThreadsSurface,
): AgentComposerMode {
  const { agentCliConfigured, agentCliKind, liveTaskCount, maxConcurrentAgentTasks } = agents;
  return useMemo<AgentComposerMode>(() => {
    if (selectedThread === null) return { kind: "new" };
    return {
      kind: "followUp",
      threadTitle: agentThreadDisplayTitle(selectedThread.thread),
      blockedReason: agentFollowUpBlockedReason(selectedThread, {
        agentCliConfigured,
        agentCliKind,
        liveTaskCount,
        maxConcurrentAgentTasks,
      }),
    };
  }, [agentCliConfigured, agentCliKind, liveTaskCount, maxConcurrentAgentTasks, selectedThread]);
}

interface IsolationChoice {
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
}

function resolveComposerTarget(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  selection: ComposerTarget | null,
): ComposerTarget | null {
  const project =
    projects.find((candidate) => candidate.projectRootKey === selection?.projectRootKey) ??
    projects[0] ??
    null;
  if (project === null) {
    return null;
  }

  const repository =
    project.repositories.find(
      (candidate) => candidate.repositoryRoot === selection?.repositoryRoot,
    ) ??
    project.repositories[0] ??
    null;
  if (repository === null) {
    return null;
  }

  return { projectRootKey: project.projectRootKey, repositoryRoot: repository.repositoryRoot };
}

function toggled(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  next.add(key);
  return next;
}

function AgentNoticeBar({
  notice,
  onConfigure,
  onDismiss,
}: {
  readonly notice: AgentTasksNotice;
  onConfigure(): void;
  onDismiss(): void;
}) {
  return (
    <div aria-live="polite" className={`agent-notice agent-notice--${notice.kind}`} role="status">
      <span>{notice.message}</span>
      <span className="agent-notice__spacer" />
      {notice.action === "configure-agent-cli" && (
        <button
          aria-label="Open agent settings"
          className="agent-linkbutton"
          onClick={onConfigure}
          type="button"
        >
          <Settings aria-hidden="true" size={12} /> Settings
        </button>
      )}
      <button
        aria-label="Dismiss agent notice"
        className="agent-linkbutton"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </div>
  );
}
