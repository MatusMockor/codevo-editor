import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, X } from "lucide-react";
import { MAX_AGENT_TASK_PROMPT_BYTES, type AgentTaskIsolation } from "../../domain/agentTask";
import {
  gitRepositoryDisplayName,
  type ResolvedGitRepository,
} from "../../domain/gitRepositoryMapping";
import {
  agentIsolationReasonLabel,
  agentPromptByteLength,
  type AgentTasksNotice,
  type AgentTasksSurface,
} from "../../application/useAgentTasks";
import { useAgentThreadPins } from "../../application/useAgentThreadPins";
import { AgentComposer } from "./AgentComposer";
import { AgentThreadInfoColumn } from "./AgentThreadInfoColumn";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentRepositoryGroups } from "./agentModePresentation";

export interface AgentModeViewProps {
  readonly agents: AgentTasksSurface;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly workspaceRoot: string | null;
  readonly nowTickMs?: number;
}

const DEFAULT_NOW_TICK_MS = 30_000;

export function AgentModeView({
  agents,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  repositories,
  workspaceRoot,
}: AgentModeViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsedRepositoryRoots, setCollapsedRepositoryRoots] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [repositoryRoot, setRepositoryRoot] = useState<string>("");
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
    () =>
      agentRepositoryGroups(
        repositories,
        agents.tasks,
        agents.orphanedWorktrees,
        workspaceRoot,
        pinnedTaskIds,
      ),
    [agents.orphanedWorktrees, agents.tasks, pinnedTaskIds, repositories, workspaceRoot],
  );

  const selectedThread =
    agents.tasks.find((task) => task.record.owner.taskId === selectedTaskId) ?? null;

  const composerRoot = selectedRepositoryRoot(repositories, repositoryRoot);
  const composerLabel =
    groups.find((group) => group.repositoryRoot === composerRoot)?.label ?? null;
  const preview = composerRoot === null ? null : agents.isolationPreview(composerRoot);
  const refreshIsolationStatus = agents.refreshIsolationStatus;
  useEffect(() => {
    if (composerRoot === null) return;
    void refreshIsolationStatus(composerRoot);
  }, [composerRoot, refreshIsolationStatus]);
  const recommended: AgentTaskIsolation =
    preview === null || preview.recommended.kind === "in-place" ? "in-place" : "worktree";
  const isolation: AgentTaskIsolation =
    isolationChoice !== null && isolationChoice.repositoryRoot === composerRoot
      ? isolationChoice.isolation
      : recommended;
  const guard = preview?.inPlaceGuard ?? { kind: "safe" as const };
  const confirmed =
    preview?.confirmationKey !== null && unsafeConfirmed === preview?.confirmationKey;
  const promptBytes = agentPromptByteLength(prompt);
  const submitBlocked =
    agents.dispatching ||
    composerRoot === null ||
    prompt.trim() === "" ||
    promptBytes > MAX_AGENT_TASK_PROMPT_BYTES ||
    (isolation === "in-place" && guard.kind === "unsafe" && !confirmed);

  const composerOptions = useMemo(
    () =>
      repositories.map((repository) => ({
        repositoryRoot: repository.repositoryRoot,
        label: gitRepositoryDisplayName(
          repository.mapping.rootRelativePath,
          workspaceRoot ?? repository.repositoryRoot,
        ),
      })),
    [repositories, workspaceRoot],
  );

  const toggleGroup = useCallback((root: string) => {
    setCollapsedRepositoryRoots((current) => {
      const next = new Set(current);
      if (next.has(root)) {
        next.delete(root);
        return next;
      }
      next.add(root);
      return next;
    });
  }, []);

  const startNewThread = useCallback((root: string) => {
    setSelectedTaskId(null);
    setRepositoryRoot(root);
  }, []);

  const submit = useCallback(() => {
    if (composerRoot === null) return;
    void agents
      .dispatch({
        repositoryRoot: composerRoot,
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
  }, [agents, composerRoot, confirmed, isolation, preview?.confirmationKey, prompt]);

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
          collapsedRepositoryRoots={collapsedRepositoryRoots}
          groups={groups}
          liveTaskCount={agents.liveTaskCount}
          maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
          now={now}
          onNewThread={startNewThread}
          onPruneOrphans={(root) => void agents.pruneOrphanedWorktrees(root)}
          onRemoveOrphan={(worktreePath) => void agents.removeOrphanedWorktree(worktreePath)}
          onSelectThread={setSelectedTaskId}
          onToggleGroup={toggleGroup}
          onTogglePin={onTogglePin}
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
            onSelectRepository={(root) => {
              setRepositoryRoot(root);
              setUnsafeConfirmed(null);
            }}
            onSubmit={submit}
            onUnsafeConfirmedChange={(next) =>
              setUnsafeConfirmed(next ? (preview?.confirmationKey ?? null) : null)
            }
            prompt={prompt}
            promptBytes={promptBytes}
            repositories={composerOptions}
            selectedRepositoryRoot={composerRoot}
            submitBlocked={submitBlocked}
            unsafeConfirmed={confirmed}
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

function selectedRepositoryRoot(
  repositories: ReadonlyArray<ResolvedGitRepository>,
  repositoryRoot: string,
): string | null {
  const selected = repositories.find((repository) => repository.repositoryRoot === repositoryRoot);
  if (selected) return selected.repositoryRoot;
  return repositories[0]?.repositoryRoot ?? null;
}
