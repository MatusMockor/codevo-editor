import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, X } from "lucide-react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { MAX_AGENT_TASK_PROMPT_BYTES, type AgentTaskIsolation } from "../../domain/agentTask";
import {
  agentIsolationReasonLabel,
  agentPromptByteLength,
  type AgentTasksNotice,
  type AgentTasksSurface,
} from "../../application/useAgentTasks";
import { useAgentThreadPins } from "../../application/useAgentThreadPins";
import { AgentComposer, type AgentComposerProjectOption } from "./AgentComposer";
import { AgentThreadInfoColumn } from "./AgentThreadInfoColumn";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import {
  agentProjectGroups,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
} from "./agentModePresentation";

export interface AgentModeViewProps {
  readonly agents: AgentTasksSurface;
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
  workspaceRoot,
}: AgentModeViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsedProjectRootKeys, setCollapsedProjectRootKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedRepositoryRoots, setCollapsedRepositoryRoots] = useState<ReadonlySet<string>>(
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

  const pinnableTaskIds = useMemo(
    () => agents.tasks.map((task) => task.record.owner.taskId),
    [agents.tasks],
  );
  const pins = useAgentThreadPins(workspaceRoot, pinnableTaskIds);
  const pinnedTaskIds = pins.pinnedTaskIds;
  const pinnedTaskIdSet = useMemo(() => new Set(pinnedTaskIds), [pinnedTaskIds]);
  const togglePin = pins.toggle;
  const onTogglePin = useCallback(
    (taskId: string) => {
      togglePin(taskId);
    },
    [togglePin],
  );

  const groups = useMemo(
    () => agentProjectGroups(projects, agents.tasks, agents.orphanedWorktrees, pinnedTaskIds),
    [projects, agents.orphanedWorktrees, agents.tasks, pinnedTaskIds],
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
  const submitBlocked =
    agents.dispatching ||
    target === null ||
    prompt.trim() === "" ||
    promptBytes > MAX_AGENT_TASK_PROMPT_BYTES ||
    (isolation === "in-place" && guard.kind === "unsafe" && !confirmed);

  const toggleProject = useCallback((projectRootKey: string) => {
    setCollapsedProjectRootKeys((current) => toggled(current, projectRootKey));
  }, []);

  const toggleGroup = useCallback((repositoryRoot: string) => {
    setCollapsedRepositoryRoots((current) => toggled(current, repositoryRoot));
  }, []);

  const startNewThread = useCallback((projectRootKey: string, repositoryRoot: string) => {
    setSelectedTaskId(null);
    setSelection({ projectRootKey, repositoryRoot });
    setUnsafeConfirmed(null);
  }, []);

  const submit = useCallback(() => {
    if (target === null) return;
    void agents
      .dispatch({
        projectRootKey: target.projectRootKey,
        repositoryRoot: target.repositoryRoot,
        prompt,
        isolation,
        unsafeInPlaceConfirmationKey: confirmed ? (preview?.confirmationKey ?? null) : null,
      })
      .then((dispatched) => {
        if (!dispatched) return;
        setPrompt("");
        setUnsafeConfirmed(null);
        setSelectedTaskId(dispatched.taskId);
      });
  }, [agents, confirmed, isolation, preview?.confirmationKey, prompt, target]);

  const selectedThread =
    agents.tasks.find((task) => task.record.owner.taskId === selectedTaskId) ?? null;

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
          groups={groups}
          liveTaskCount={agents.liveTaskCount}
          maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
          now={now}
          onNewThread={startNewThread}
          onPruneOrphans={(root) => void agents.pruneOrphanedWorktrees(root)}
          onReleaseProject={onReleaseProject}
          onRemoveOrphan={(worktreePath) => void agents.removeOrphanedWorktree(worktreePath)}
          onSelectThread={setSelectedTaskId}
          onToggleGroup={toggleGroup}
          onToggleProject={toggleProject}
          onTogglePin={onTogglePin}
          onTrustProject={onTrustProject}
          overflowRootPaths={overflowRootPaths}
          pinnedTaskIds={pinnedTaskIdSet}
          selectedTaskId={selectedThread?.record.owner.taskId ?? null}
        />

        <div className="agent-mode__center">
          <AgentThreadSession
            composerRepositoryLabel={composerLabel}
            now={now}
            onHideChanges={(taskId) => agents.hideChanges(taskId)}
            onHideFileDiff={(taskId) => agents.hideFileDiff(taskId)}
            onRefreshChanges={(taskId) => void agents.showChanges(taskId)}
            onShowFileDiff={(taskId, change) => void agents.showFileDiff(taskId, change)}
            thread={selectedThread}
          />
          <AgentComposer
            dispatching={agents.dispatching}
            guard={guard}
            isolation={isolation}
            isolationReason={
              preview === null ? null : agentIsolationReasonLabel(preview.recommended)
            }
            onIsolationChange={(next) => {
              if (composerRoot === null) return;
              setIsolationChoice({ repositoryRoot: composerRoot, isolation: next });
              setUnsafeConfirmed(null);
            }}
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
          onDismiss={(taskId) => agents.dismiss(taskId)}
          onRemoveWorktree={(taskId) => void agents.removeWorktree(taskId)}
          onShowChanges={(taskId) => void agents.showChanges(taskId)}
          onStop={(taskId) => void agents.stop(taskId)}
          onTogglePin={onTogglePin}
          pinned={
            selectedThread !== null && pinnedTaskIdSet.has(selectedThread.record.owner.taskId)
          }
          thread={selectedThread}
        />
      </div>
    </section>
  );
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
