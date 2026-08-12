import { useState, type CSSProperties, type FormEvent } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  Play,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentTaskIsolation,
  type AgentTaskStatus,
} from "../domain/agentTask";
import type { GitChangeStatus } from "../domain/git";
import {
  gitRepositoryDisplayName,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import {
  MAX_AGENT_TASK_CHANGE_ROWS,
  agentIsolationReasonLabel,
  agentPromptByteLength,
  inPlaceGuardReasonLabel,
  type AgentTaskChangeSummary,
  type AgentTaskView,
  type AgentTasksNotice,
  type AgentTasksSurface,
} from "../application/useAgentTasks";

export interface AgentsPanelProps {
  readonly className?: string;
  readonly agents: AgentTasksSurface;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly workspaceRoot: string | null;
}

interface IsolationChoice {
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
}

const MAX_RENDERED_PROMPT_CHARACTERS = 280;

const styles: Record<string, CSSProperties> = {
  panel: { display: "flex", flexDirection: "column", minHeight: 0 },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--color-border)",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    padding: "8px 10px",
  },
  headerTitle: { alignItems: "center", display: "flex", gap: 6 },
  meta: { color: "var(--color-text-muted)" },
  notice: {
    alignItems: "flex-start",
    borderBottom: "1px solid var(--color-border)",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    padding: "8px 10px",
  },
  noticeActions: { display: "flex", flexShrink: 0, gap: 6 },
  form: {
    borderBottom: "1px solid var(--color-border)",
    display: "grid",
    gap: 8,
    padding: 10,
  },
  field: { display: "grid", gap: 4 },
  label: { color: "var(--color-text-muted)" },
  textarea: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    color: "inherit",
    font: "inherit",
    minHeight: 84,
    padding: 6,
    resize: "vertical",
  },
  counter: { color: "var(--color-text-muted)", margin: 0, textAlign: "right" },
  counterOverflow: { color: "var(--color-warning)", margin: 0, textAlign: "right" },
  checkboxRow: { alignItems: "center", display: "flex", gap: 6 },
  hint: { color: "var(--color-text-muted)", margin: 0 },
  unsafe: {
    border: "1px solid var(--color-warning)",
    borderRadius: 4,
    display: "grid",
    gap: 6,
    padding: 8,
  },
  unsafeTitle: { alignItems: "center", color: "var(--color-warning)", display: "flex", gap: 6 },
  reasonList: { margin: 0, paddingInlineStart: 20 },
  submitRow: { display: "flex", gap: 8, justifyContent: "flex-end" },
  empty: { color: "var(--color-text-muted)", margin: 0, padding: 12 },
  orphans: {
    borderBottom: "1px solid var(--color-border)",
    display: "grid",
    gap: 6,
    padding: 10,
  },
  orphanTitle: { alignItems: "center", color: "var(--color-warning)", display: "flex", gap: 6 },
  orphanList: {
    display: "grid",
    gap: 6,
    listStyle: "none",
    margin: 0,
    maxHeight: 160,
    overflow: "auto",
    padding: 0,
  },
  orphanRow: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  orphanPath: { minWidth: 0, overflowWrap: "anywhere" },
  taskList: { listStyle: "none", margin: 0, overflow: "auto", padding: 0 },
  task: { borderBottom: "1px solid var(--color-border)", display: "grid", gap: 6, padding: 10 },
  taskHeader: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  badges: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 },
  badge: {
    border: "1px solid var(--color-border)",
    borderRadius: 999,
    padding: "1px 8px",
    whiteSpace: "nowrap",
  },
  taskActions: { display: "flex", flexShrink: 0, gap: 6 },
  prompt: { margin: 0, overflowWrap: "anywhere" },
  path: { color: "var(--color-text-muted)", overflowWrap: "anywhere" },
  output: {
    background: "var(--color-surface)",
    height: 140,
    margin: 0,
    overflow: "auto",
    padding: 8,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  truncation: { color: "var(--color-warning)", margin: 0 },
  changes: {
    borderTop: "1px solid var(--color-border)",
    display: "grid",
    gap: 6,
    paddingTop: 6,
  },
  changesActions: { display: "flex", flexWrap: "wrap", gap: 6 },
  fileList: { listStyle: "none", margin: 0, maxHeight: 180, overflow: "auto", padding: 0 },
  fileRow: { alignItems: "center", display: "flex", gap: 6 },
  fileButton: {
    background: "none",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    overflowWrap: "anywhere",
    padding: "2px 0",
    textAlign: "left",
  },
  fileStatus: { color: "var(--color-text-muted)", width: 14 },
  diffGrid: { display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" },
  diffPane: {
    background: "var(--color-surface)",
    margin: 0,
    maxHeight: 220,
    overflow: "auto",
    padding: 8,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  error: { color: "var(--color-danger)", margin: 0 },
};

export function AgentsPanel({ agents, className, repositories, workspaceRoot }: AgentsPanelProps) {
  const [repositoryRoot, setRepositoryRoot] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [unsafeConfirmed, setUnsafeConfirmed] = useState<string | null>(null);

  const selectedRoot = selectedRepositoryRoot(repositories, repositoryRoot);
  const preview = selectedRoot === null ? null : agents.isolationPreview(selectedRoot);
  const recommendedIsolation: AgentTaskIsolation =
    preview === null || preview.recommended.kind === "in-place" ? "in-place" : "worktree";
  const isolation: AgentTaskIsolation =
    isolationChoice !== null && isolationChoice.repositoryRoot === selectedRoot
      ? isolationChoice.isolation
      : recommendedIsolation;
  const guard = preview?.inPlaceGuard ?? { kind: "safe" as const };
  const unsafeInPlace = isolation === "in-place" && guard.kind === "unsafe";
  const confirmed = unsafeConfirmed === selectedRoot;
  const promptBytes = agentPromptByteLength(prompt);
  const promptTooLong = promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const submitBlocked =
    agents.dispatching ||
    selectedRoot === null ||
    prompt.trim() === "" ||
    promptTooLong ||
    (unsafeInPlace && !confirmed);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (selectedRoot === null) return;
    const dispatched = await agents.dispatch({
      repositoryRoot: selectedRoot,
      prompt,
      isolation,
      unsafeInPlaceConfirmed: confirmed,
    });
    if (!dispatched) return;
    setPrompt("");
    setUnsafeConfirmed(null);
  };

  return (
    <section aria-label="Agents" className={className} style={styles.panel}>
      <header style={styles.header}>
        <strong style={styles.headerTitle}>
          <Bot aria-hidden="true" size={14} />
          Agents
        </strong>
        <small style={styles.meta}>
          {agents.liveTaskCount} of {agents.maxConcurrentAgentTasks} running
        </small>
      </header>

      {agents.notice && (
        <NoticeBar
          notice={agents.notice}
          onConfigure={() => agents.configureAgentCli()}
          onDismiss={() => agents.dismissNotice()}
        />
      )}

      <form onSubmit={(event) => void onSubmit(event)} style={styles.form}>
        <div style={styles.field}>
          <label htmlFor="agent-repository" style={styles.label}>
            Repository
          </label>
          <select
            id="agent-repository"
            onChange={(event) => setRepositoryRoot(event.target.value)}
            value={selectedRoot ?? ""}
          >
            {repositories.length === 0 && <option value="">No Git repository detected</option>}
            {repositories.map((repository) => (
              <option key={repository.repositoryRoot} value={repository.repositoryRoot}>
                {gitRepositoryDisplayName(
                  repository.mapping.rootRelativePath,
                  workspaceRoot ?? repository.repositoryRoot,
                )}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label htmlFor="agent-prompt" style={styles.label}>
            Prompt
          </label>
          <textarea
            id="agent-prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the change you want the agent to make"
            style={styles.textarea}
            value={prompt}
          />
          <small style={promptTooLong ? styles.counterOverflow : styles.counter}>
            {promptBytes} of {MAX_AGENT_TASK_PROMPT_BYTES} bytes
          </small>
        </div>

        <div style={styles.field}>
          <div style={styles.checkboxRow}>
            <input
              checked={isolation === "worktree"}
              id="agent-isolation"
              onChange={(event) => {
                if (selectedRoot === null) return;
                setIsolationChoice({
                  repositoryRoot: selectedRoot,
                  isolation: event.target.checked ? "worktree" : "in-place",
                });
                setUnsafeConfirmed(null);
              }}
              type="checkbox"
            />
            <label htmlFor="agent-isolation">Run in an isolated worktree</label>
          </div>
          {preview && (
            <small style={styles.hint}>{agentIsolationReasonLabel(preview.recommended)}</small>
          )}
        </div>

        {unsafeInPlace && guard.kind === "unsafe" && (
          <div style={styles.unsafe}>
            <strong style={styles.unsafeTitle}>
              <TriangleAlert aria-hidden="true" size={14} />
              Running in place can overwrite your work
            </strong>
            <ul style={styles.reasonList}>
              {guard.reasons.map((reason) => (
                <li key={reason}>{inPlaceGuardReasonLabel(reason)}</li>
              ))}
            </ul>
            <div style={styles.checkboxRow}>
              <input
                checked={confirmed}
                id="agent-unsafe-confirm"
                onChange={(event) => setUnsafeConfirmed(event.target.checked ? selectedRoot : null)}
                type="checkbox"
              />
              <label htmlFor="agent-unsafe-confirm">
                Start in this repository anyway and accept the risk
              </label>
            </div>
          </div>
        )}

        <div style={styles.submitRow}>
          <button disabled={submitBlocked} type="submit">
            <Play aria-hidden="true" size={12} /> {agents.dispatching ? "Starting…" : "Start agent"}
          </button>
        </div>
      </form>

      {agents.orphanedWorktrees.length > 0 && <OrphanedWorktreeList agents={agents} />}

      {agents.tasks.length === 0 ? (
        <p style={styles.empty}>No agent has been started in this workspace yet.</p>
      ) : (
        <ul aria-label="Agent tasks" style={styles.taskList}>
          {agents.tasks.map((task) => (
            <AgentTaskItem agents={agents} key={task.record.owner.taskId} task={task} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrphanedWorktreeList({ agents }: { readonly agents: AgentTasksSurface }) {
  return (
    <section aria-label="Orphaned worktrees" style={styles.orphans}>
      <strong style={styles.orphanTitle}>
        <TriangleAlert aria-hidden="true" size={14} />
        Orphaned worktrees
      </strong>
      <small style={styles.hint}>
        These agent worktrees have no task in this session. Remove them to free the repository
        worktree limit. Branches are kept.
      </small>
      <ul style={styles.orphanList}>
        {agents.orphanedWorktrees.map((orphan) => (
          <li key={orphan.worktreePath} style={styles.orphanRow}>
            <span style={styles.orphanPath}>
              {orphan.worktreePath}
              {orphan.branch && <small style={styles.meta}> {orphan.branch}</small>}
            </span>
            {orphan.prunable ? (
              <button
                aria-label={`Prune stale worktrees for ${orphan.repositoryRoot}`}
                onClick={() => void agents.pruneOrphanedWorktrees(orphan.repositoryRoot)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={12} /> Prune
              </button>
            ) : (
              <button
                aria-label={`Remove orphaned worktree ${orphan.worktreePath}`}
                disabled={orphan.removing}
                onClick={() => void agents.removeOrphanedWorktree(orphan.worktreePath)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={12} /> {orphan.removing ? "Removing…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoticeBar({
  notice,
  onConfigure,
  onDismiss,
}: {
  readonly notice: AgentTasksNotice;
  readonly onConfigure: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div aria-live="polite" role="status" style={{ ...styles.notice, color: noticeColor(notice) }}>
      <span>{notice.message}</span>
      <div style={styles.noticeActions}>
        {notice.action === "configure-agent-cli" && (
          <button aria-label="Open agent settings" onClick={onConfigure} type="button">
            <Settings aria-hidden="true" size={12} /> Settings
          </button>
        )}
        <button aria-label="Dismiss agent notice" onClick={onDismiss} type="button">
          <X aria-hidden="true" size={12} />
        </button>
      </div>
    </div>
  );
}

function AgentTaskItem({
  agents,
  task,
}: {
  readonly agents: AgentTasksSurface;
  readonly task: AgentTaskView;
}) {
  const { record } = task;
  const taskId = record.owner.taskId;
  const reviewable = task.terminal && record.isolation === "worktree" && !task.worktreeRemoved;

  return (
    <li style={styles.task}>
      <div style={styles.taskHeader}>
        <div style={styles.badges}>
          <span style={{ ...styles.badge, color: statusColor(record.status) }}>
            {agentTaskStatusLabel(record.status)}
          </span>
          <span style={styles.badge}>
            {record.isolation === "worktree" ? (
              <GitBranch aria-hidden="true" size={11} />
            ) : (
              <FolderGit2 aria-hidden="true" size={11} />
            )}{" "}
            {record.isolation === "worktree" ? "Worktree" : "In place"}
          </span>
          <small style={styles.meta}>{task.repositoryLabel}</small>
        </div>
        <div style={styles.taskActions}>
          {!task.terminal && (
            <button
              aria-label={`Stop agent ${taskId}`}
              onClick={() => void agents.stop(taskId)}
              type="button"
            >
              <Square aria-hidden="true" size={12} /> Stop
            </button>
          )}
          {task.terminal && (
            <button
              aria-label={`Dismiss agent ${taskId}`}
              onClick={() => agents.dismiss(taskId)}
              type="button"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {record.status.kind === "failed" && <p style={styles.error}>{record.status.message}</p>}

      <p style={styles.prompt}>{renderedPrompt(record.prompt)}</p>

      {record.worktreePath && <small style={styles.path}>{record.worktreePath}</small>}

      <pre aria-label={`Agent output ${taskId}`} style={styles.output}>
        {record.outputTail === "" ? "No output yet." : record.outputTail}
      </pre>
      {record.outputTruncated && (
        <small style={styles.truncation}>Earlier output was dropped to bound memory.</small>
      )}

      {task.worktreeRemoved && (
        <small style={styles.meta}>The worktree was removed. Its branch was kept.</small>
      )}

      {reviewable && (
        <AgentTaskChanges agents={agents} summary={task.changeSummary} taskId={taskId} />
      )}
    </li>
  );
}

function AgentTaskChanges({
  agents,
  summary,
  taskId,
}: {
  readonly agents: AgentTasksSurface;
  readonly summary: AgentTaskChangeSummary | null;
  readonly taskId: string;
}) {
  if (summary === null) {
    return (
      <div style={styles.changes}>
        <div style={styles.changesActions}>
          <button
            aria-expanded={false}
            aria-label={`Show changes for agent ${taskId}`}
            onClick={() => void agents.showChanges(taskId)}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={12} /> Show changes
          </button>
          <button
            aria-label={`Remove worktree for agent ${taskId}`}
            onClick={() => void agents.removeWorktree(taskId)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={12} /> Remove worktree
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.changes}>
      <div style={styles.changesActions}>
        <button
          aria-expanded
          aria-label={`Hide changes for agent ${taskId}`}
          onClick={() => agents.hideChanges(taskId)}
          type="button"
        >
          <ChevronDown aria-hidden="true" size={12} /> Hide changes
        </button>
        <button
          aria-label={`Refresh changes for agent ${taskId}`}
          disabled={summary.loading}
          onClick={() => void agents.showChanges(taskId)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={12} /> Refresh
        </button>
        <button
          aria-label={`Remove worktree for agent ${taskId}`}
          disabled={summary.removing}
          onClick={() => void agents.removeWorktree(taskId)}
          type="button"
        >
          <Trash2 aria-hidden="true" size={12} />{" "}
          {summary.removing ? "Removing…" : "Remove worktree"}
        </button>
      </div>

      {summary.loading && <small style={styles.meta}>Reading the worktree changes…</small>}
      {summary.error && <p style={styles.error}>{summary.error}</p>}

      {!summary.loading && summary.error === null && summary.files.length === 0 && (
        <small style={styles.meta}>The agent left no uncommitted changes.</small>
      )}

      {summary.files.length > 0 && (
        <ul aria-label={`Changed files for agent ${taskId}`} style={styles.fileList}>
          {summary.files.map((file) => (
            <li key={`${file.relativePath} ${file.isStaged}`} style={styles.fileRow}>
              <span style={styles.fileStatus}>{gitChangeStatusLetter(file.status)}</span>
              <button
                onClick={() => void agents.showFileDiff(taskId, file)}
                style={styles.fileButton}
                type="button"
              >
                {file.relativePath}
              </button>
            </li>
          ))}
        </ul>
      )}

      {summary.truncated && (
        <small style={styles.truncation}>
          Only the first {MAX_AGENT_TASK_CHANGE_ROWS} changed files are listed.
        </small>
      )}

      {summary.diff && (
        <AgentTaskDiff diff={summary.diff} onClose={() => agents.hideFileDiff(taskId)} />
      )}
    </div>
  );
}

function AgentTaskDiff({
  diff,
  onClose,
}: {
  readonly diff: NonNullable<AgentTaskChangeSummary["diff"]>;
  readonly onClose: () => void;
}) {
  return (
    <section aria-label={`Diff for ${diff.relativePath}`} style={styles.changes}>
      <div style={styles.taskHeader}>
        <strong>{diff.relativePath}</strong>
        <button aria-label="Close file diff" onClick={onClose} type="button">
          <X aria-hidden="true" size={12} />
        </button>
      </div>
      {diff.loading && <small style={styles.meta}>Reading the file diff…</small>}
      {diff.error && <p style={styles.error}>{diff.error}</p>}
      {diff.unavailableReason && (
        <small style={styles.truncation}>
          {diff.unavailableReason === "binary"
            ? "This file is binary, so no text diff is shown."
            : "This file is too large to preview."}
        </small>
      )}
      {!diff.loading && diff.error === null && diff.unavailableReason === null && (
        <div style={styles.diffGrid}>
          <DiffPane label="Before" side={diff.original} />
          <DiffPane label="After" side={diff.modified} />
        </div>
      )}
    </section>
  );
}

function DiffPane({
  label,
  side,
}: {
  readonly label: string;
  readonly side: { readonly text: string; readonly truncated: boolean };
}) {
  return (
    <div>
      <small style={styles.meta}>{label}</small>
      <pre aria-label={`${label} content`} style={styles.diffPane}>
        {side.text === "" ? "Empty file." : side.text}
      </pre>
      {side.truncated && (
        <small style={styles.truncation}>This side was truncated to stay bounded.</small>
      )}
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

function renderedPrompt(prompt: string): string {
  if (prompt.length <= MAX_RENDERED_PROMPT_CHARACTERS) return prompt;
  return `${prompt.slice(0, MAX_RENDERED_PROMPT_CHARACTERS)}…`;
}

function agentTaskStatusLabel(status: AgentTaskStatus): string {
  switch (status.kind) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "exited":
      return status.exitCode === 0 ? "Finished" : `Exited ${status.exitCode}`;
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return unsupportedStatus(status);
  }
}

function statusColor(status: AgentTaskStatus): string {
  switch (status.kind) {
    case "pending":
      return "var(--color-text-muted)";
    case "running":
      return "var(--color-accent)";
    case "exited":
      return status.exitCode === 0 ? "var(--color-success)" : "var(--color-warning)";
    case "failed":
      return "var(--color-danger)";
    case "stopped":
      return "var(--color-text-muted)";
    default:
      return unsupportedStatus(status);
  }
}

function noticeColor(notice: AgentTasksNotice): string {
  switch (notice.kind) {
    case "info":
      return "var(--color-text-muted)";
    case "warning":
      return "var(--color-warning)";
    case "error":
      return "var(--color-danger)";
    default:
      return unsupportedNoticeKind(notice.kind);
  }
}

function gitChangeStatusLetter(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "conflicted":
      return "C";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return unsupportedChangeStatus(status);
  }
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent task status: ${JSON.stringify(status)}.`);
}

function unsupportedNoticeKind(kind: never): never {
  throw new TypeError(`Unsupported agent notice kind: ${String(kind)}.`);
}

function unsupportedChangeStatus(status: never): never {
  throw new TypeError(`Unsupported Git change status: ${String(status)}.`);
}
