import { useState } from "react";
import { ExternalLink, GitMerge, RefreshCw, Trash2, Upload } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  agentShipStatus,
  type AgentShipAvailability,
  type AgentShipIntegrationMode,
  type AgentShipState,
} from "../../domain/agentShip";
import type { GitShipStatus } from "../../domain/gitIntegration";
import {
  agentPromptByteLength,
  agentShipAvailability,
  agentShipBranchLabel,
  agentShipCommitMessageAvailability,
  agentShipConflictFiles,
  agentShipDefaultCommitMessage,
  agentShipDefaultIntegrationMode,
  agentShipFailureActions,
  agentShipFailureLabel,
  agentShipFailureStepLabel,
  agentShipRelationLabel,
  agentShipRemoteLabel,
  agentShipStepLabel,
  compareHostLabel,
} from "./agentModePresentation";

export interface AgentShipActions {
  onRefreshShipStatus(threadId: string): void;
  onCommit(threadId: string, message: string): void;
  onPush(threadId: string): void;
  onOpenCompareUrl(threadId: string): void;
  onIntegrate(threadId: string, mode: AgentShipIntegrationMode): void;
  onRemoveWorktree(threadId: string, options: { readonly deleteBranch: boolean }): void;
  onDiscardWorktree(threadId: string): void;
  onDismissFailure(threadId: string): void;
}

export interface AgentShipPanelProps {
  readonly thread: AgentThreadView;
  readonly actions: AgentShipActions;
  readonly initialMessage?: string | null;
  onMessageChange?(message: string): void;
}

interface ThreadScopedValue<TValue> {
  readonly threadId: string;
  readonly value: TValue;
}

export function AgentShipPanel({
  actions,
  initialMessage = null,
  onMessageChange,
  thread,
}: AgentShipPanelProps) {
  const [messageDraft, setMessageDraft] = useState<ThreadScopedValue<string> | null>(
    initialMessage === null ? null : { threadId: thread.thread.threadId, value: initialMessage },
  );
  const [modeChoice, setModeChoice] = useState<ThreadScopedValue<AgentShipIntegrationMode> | null>(
    null,
  );
  const [deleteBranchChoice, setDeleteBranchChoice] = useState<ThreadScopedValue<boolean> | null>(
    null,
  );

  const threadId = thread.thread.threadId;
  const ship = thread.ship;
  const status = agentShipStatus(ship);
  const availability = agentShipAvailability(thread);
  const worktree = thread.thread.target.isolation === "worktree";
  const busyLabel = agentShipStepLabel(ship);

  const message = scoped(messageDraft, threadId) ?? agentShipDefaultCommitMessage(thread.thread);
  const messageAvailability = agentShipCommitMessageAvailability(message);
  const commitAvailability = firstBlocked(availability.commit, messageAvailability);
  const mode = scoped(modeChoice, threadId) ?? agentShipDefaultIntegrationMode(status);
  const deleteBranch =
    availability.deleteBranch.kind === "available" &&
    (scoped(deleteBranchChoice, threadId) ?? true);
  const integrateAvailability =
    mode === "fastForward" ? availability.fastForward : availability.merge;

  return (
    <section aria-label={`Ship agent ${threadId}`} className="agent-ship">
      <ShipStatusSection
        onRefresh={() => actions.onRefreshShipStatus(threadId)}
        ship={ship}
        status={status}
        threadId={threadId}
      />

      {busyLabel !== null && (
        <p aria-live="polite" className="agent-ship__busy" role="status">
          <span aria-hidden="true" className="agent-dot agent-dot--running" />
          {busyLabel}
        </p>
      )}

      {ship.kind === "failed" && (
        <ShipFailureSection
          onDismiss={() => actions.onDismissFailure(threadId)}
          onRetry={() => retry(actions, threadId, ship, { message, mode, deleteBranch })}
          ship={ship}
          threadId={threadId}
        />
      )}

      <section className="agent-info__section agent-ship__row">
        <span className="agent-microlabel">commit</span>
        <label className="agent-visually-hidden" htmlFor={`agent-ship-message-${threadId}`}>
          Commit message
        </label>
        <textarea
          className="agent-ship__message"
          id={`agent-ship-message-${threadId}`}
          onChange={(event) => {
            setMessageDraft({ threadId, value: event.target.value });
            onMessageChange?.(event.target.value);
          }}
          rows={2}
          value={message}
        />
        <p className="agent-ship__count agent-num">
          {agentPromptByteLength(message)} / {MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES} bytes
        </p>
        <ShipAction
          availability={commitAvailability}
          label={commitLabel(status)}
          onActivate={() => actions.onCommit(threadId, message)}
          variant="main"
        />
        {ship.kind === "committed" && (
          <p className="agent-note">Committed {ship.commitSha.slice(0, 8)}.</p>
        )}
      </section>

      <section className="agent-info__section agent-ship__row">
        <span className="agent-microlabel">push</span>
        <ShipAction
          availability={availability.push}
          icon={<Upload aria-hidden="true" size={12} />}
          label="Push branch"
          onActivate={() => actions.onPush(threadId)}
          variant="main"
        />
        {ship.kind === "pushed" && (
          <PushedReceipt onOpen={() => actions.onOpenCompareUrl(threadId)} receipt={ship.receipt} />
        )}
      </section>

      <section className="agent-info__section agent-ship__row">
        <span className="agent-microlabel">integrate</span>
        {worktree && (
          <fieldset className="agent-ship__modes">
            <legend className="agent-visually-hidden">Integration mode</legend>
            <ShipModeOption
              checked={mode === "fastForward"}
              label="Fast-forward"
              onSelect={() => setModeChoice({ threadId, value: "fastForward" })}
              threadId={threadId}
              value="fastForward"
            />
            <ShipModeOption
              checked={mode === "merge"}
              label="Merge commit"
              onSelect={() => setModeChoice({ threadId, value: "merge" })}
              threadId={threadId}
              value="merge"
            />
          </fieldset>
        )}
        <ShipAction
          availability={integrateAvailability}
          icon={<GitMerge aria-hidden="true" size={12} />}
          label={`Integrate into ${status?.primary.branch ?? "the main checkout"}`}
          onActivate={() => actions.onIntegrate(threadId, mode)}
          variant="main"
        />
        {worktree && ship.kind === "integrated" && (
          <p className="agent-note">
            Merged {ship.mergeSha.slice(0, 8)} into {ship.intoBranch}.
          </p>
        )}
      </section>

      {worktree && (
        <section className="agent-info__section agent-ship__row">
          <span className="agent-microlabel">clean up</span>
          <label className="agent-ship__check">
            <input
              checked={deleteBranch}
              disabled={availability.deleteBranch.kind === "blocked"}
              onChange={(event) => setDeleteBranchChoice({ threadId, value: event.target.checked })}
              type="checkbox"
            />
            Delete branch {agentShipBranchLabel(ship) ?? "for this thread"}
          </label>
          {availability.deleteBranch.kind === "blocked" && (
            <p className="agent-ship__reason">{availability.deleteBranch.reason}</p>
          )}
          <ShipAction
            availability={availability.removeWorktree}
            icon={<Trash2 aria-hidden="true" size={12} />}
            label="Remove worktree"
            onActivate={() => actions.onRemoveWorktree(threadId, { deleteBranch })}
            variant="danger"
          />
          <button
            aria-label={`Discard the worktree of agent ${threadId}`}
            className="agent-linkbutton"
            onClick={() => actions.onDiscardWorktree(threadId)}
            type="button"
          >
            Discard without integrating
          </button>
        </section>
      )}
    </section>
  );
}

function ShipStatusSection({
  onRefresh,
  ship,
  status,
  threadId,
}: {
  readonly ship: AgentShipState;
  readonly status: GitShipStatus | null;
  readonly threadId: string;
  onRefresh(): void;
}) {
  return (
    <section className="agent-info__section agent-ship__row">
      <header className="agent-ship__head">
        <span className="agent-microlabel">ship</span>
        <span className="agent-session__spacer" />
        <button
          aria-label={`Refresh the branch status of agent ${threadId}`}
          className="agent-linkbutton"
          disabled={ship.kind === "idle" && ship.loadingStatus}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={11} /> Refresh
        </button>
      </header>
      {status === null && <p className="agent-note">The branch status has not been read yet.</p>}
      {status !== null && (
        <div className="agent-ship__facts">
          <p className="agent-info__value">{status.worktree.branch}</p>
          <p className="agent-info__value agent-info__value--dim agent-num">
            {agentShipRelationLabel(status)}
          </p>
          <p className="agent-info__value agent-info__value--dim">{agentShipRemoteLabel(status)}</p>
        </div>
      )}
      {status?.primary.dirty === true && (
        <p className="agent-note agent-note--warning">The main checkout has uncommitted changes.</p>
      )}
      {status !== null && status.primary.branch === null && (
        <p className="agent-note agent-note--warning">The main checkout is detached.</p>
      )}
    </section>
  );
}

function ShipFailureSection({
  onDismiss,
  onRetry,
  ship,
  threadId,
}: {
  readonly ship: Extract<AgentShipState, { kind: "failed" }>;
  readonly threadId: string;
  onDismiss(): void;
  onRetry(): void;
}) {
  const conflicts = agentShipConflictFiles(ship.failure);
  const { guidance, retryLabel } = agentShipFailureActions(ship.failure);

  return (
    <section
      aria-label={`Ship failure for agent ${threadId}`}
      className="agent-finale agent-finale--bad agent-ship__failure"
      role="alert"
    >
      <span className="agent-microlabel agent-microlabel--bad">
        {agentShipFailureStepLabel(ship.failure)}
      </span>
      <p className="agent-finale__body">{agentShipFailureLabel(ship.failure)}</p>
      {conflicts.files.length > 0 && (
        <ul aria-label="Conflicted files" className="agent-ship__conflicts">
          {conflicts.files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
      {conflicts.hiddenCount > 0 && (
        <p className="agent-note">+{conflicts.hiddenCount} more conflicted files</p>
      )}
      {conflicts.truncated && (
        <p className="agent-note agent-note--warning">
          More conflicted files exist than git reported.
        </p>
      )}
      {guidance !== null && <p className="agent-note agent-note--warning">{guidance}</p>}
      <div className="agent-ship__failure-actions">
        {retryLabel !== null && (
          <button
            aria-label={`${retryLabel} for agent ${threadId}`}
            className="agent-linkbutton"
            onClick={onRetry}
            type="button"
          >
            {retryLabel}
          </button>
        )}
        <button
          aria-label={`Dismiss the ship failure of agent ${threadId}`}
          className="agent-linkbutton"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

function PushedReceipt({
  onOpen,
  receipt,
}: {
  readonly receipt: Extract<AgentShipState, { kind: "pushed" }>["receipt"];
  onOpen(): void;
}) {
  const compareUrl = receipt.compareUrl;
  const hostLabel = compareUrl === null ? null : compareHostLabel(compareUrl);

  return (
    <div className="agent-ship__receipt">
      <p className="agent-note">
        Pushed {receipt.branch} to {receipt.remote}.
      </p>
      {compareUrl !== null && (
        <button
          aria-label={`Open the compare page for ${receipt.branch}`}
          className="agent-linkbutton"
          onClick={onOpen}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={11} />{" "}
          {hostLabel === null ? "Open compare page" : `Open compare page on ${hostLabel}`}
        </button>
      )}
      {compareUrl === null && (
        <p className="agent-note">Open a pull request for this branch on your hosting site.</p>
      )}
    </div>
  );
}

function ShipModeOption({
  checked,
  label,
  onSelect,
  threadId,
  value,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly threadId: string;
  readonly value: AgentShipIntegrationMode;
  onSelect(): void;
}) {
  return (
    <label className="agent-ship__mode">
      <input
        checked={checked}
        name={`agent-ship-mode-${threadId}`}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      {label}
    </label>
  );
}

function ShipAction({
  availability,
  icon,
  label,
  onActivate,
  variant,
}: {
  readonly availability: AgentShipAvailability;
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly variant: "main" | "danger";
  onActivate(): void;
}) {
  const blocked = availability.kind === "blocked";

  return (
    <div className="agent-ship__action">
      <div className="agent-info__actions">
        <button
          aria-label={label}
          className={
            variant === "danger" ? "agent-info__action--danger" : "agent-info__action--main"
          }
          disabled={blocked}
          onClick={onActivate}
          title={blocked ? availability.reason : undefined}
          type="button"
        >
          {icon}
          {label}
        </button>
      </div>
      {blocked && <p className="agent-ship__reason">{availability.reason}</p>}
    </div>
  );
}

function commitLabel(status: GitShipStatus | null): string {
  if (status === null) return "Commit changes";
  if (status.worktree.changeCount === 1) return "Commit 1 file";
  return `Commit ${status.worktree.changeCount} files`;
}

function retry(
  actions: AgentShipActions,
  threadId: string,
  ship: Extract<AgentShipState, { kind: "failed" }>,
  choices: {
    readonly message: string;
    readonly mode: AgentShipIntegrationMode;
    readonly deleteBranch: boolean;
  },
): void {
  switch (ship.failure.step) {
    case "commit":
      actions.onCommit(threadId, choices.message);
      return;
    case "push":
      actions.onPush(threadId);
      return;
    case "integrate":
      actions.onIntegrate(threadId, choices.mode);
      return;
    case "removeWorktree":
      actions.onRemoveWorktree(threadId, { deleteBranch: choices.deleteBranch });
      return;
    default:
      return unsupportedFailureStep(ship.failure);
  }
}

function firstBlocked(
  primary: AgentShipAvailability,
  secondary: AgentShipAvailability,
): AgentShipAvailability {
  if (primary.kind === "blocked") return primary;
  return secondary;
}

function scoped<TValue>(held: ThreadScopedValue<TValue> | null, threadId: string): TValue | null {
  if (held === null || held.threadId !== threadId) return null;
  return held.value;
}

function unsupportedFailureStep(failure: never): never {
  throw new TypeError(`Unsupported agent ship failure: ${JSON.stringify(failure)}.`);
}
