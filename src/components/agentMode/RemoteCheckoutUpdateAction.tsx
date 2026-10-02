import { ChevronDown, GitBranch, RefreshCw } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { RemoteProjectGit } from "../../application/useRemoteProjectGit";
import { remoteCheckoutDirty, remoteCheckoutUpdateBlock } from "../../domain/remoteDraftGitBase";
import { remoteGitErrorMessage, type RemoteGitCheckoutStatus } from "../../domain/remoteGitSync";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import { Popover } from "../../ui/foundation/Popover";
import {
  REMOTE_CHECKOUT_LABEL,
  REMOTE_DETACHED_LABEL,
  REMOTE_UPDATE_SUCCEEDED,
  remoteDirtySummary,
  remoteFetchedLabel,
  remoteSyncCounts,
  remoteSyncSummary,
} from "./remoteGitPresentation";
import "./pickers/agentPickers.css";
import "./remoteComposerGit.css";

export interface RemoteCheckoutUpdateActionProps {
  readonly git: RemoteProjectGit;
  readonly disabled: boolean;
  readonly nowMs: number;
}

export function RemoteCheckoutUpdateAction({
  disabled,
  git,
  nowMs,
}: RemoteCheckoutUpdateActionProps) {
  const reasonId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const status = git.checkout.kind === "idle" ? null : git.checkout.value;
  const branch = status === null ? null : (status.branch ?? REMOTE_DETACHED_LABEL);
  const counts = status === null ? null : remoteSyncCounts(status);
  const dirty = status !== null && remoteCheckoutDirty(status);
  const running = git.network.kind === "running";
  const blocked = status === null ? null : remoteCheckoutUpdateBlock(status);
  const reason = blocked === null ? null : remoteGitErrorMessage(blocked);
  const updateDisabled = disabled || running || status === null || reason !== null;

  return (
    <div className="agent-picker agent-branch-picker__anchor">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerAccessibleName(status, branch)}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        onClick={() => {
          if (!open) void git.refresh();
          setOpen(!open);
        }}
        ref={triggerRef}
        title="Server checkout status"
        type="button"
      >
        <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
        <span className="agent-picker__value agent-branch-picker__value">
          {branch ?? REMOTE_CHECKOUT_LABEL}
        </span>
        {counts === null ? null : (
          <span aria-hidden="true" className="remote-git-sync">
            {counts}
          </span>
        )}
        {dirty ? <span aria-hidden="true" className="remote-git-dirty" /> : null}
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      <Popover
        anchorRef={triggerRef}
        className="remote-git-checkout"
        label={REMOTE_CHECKOUT_LABEL}
        onClose={() => setOpen(false)}
        open={open}
        placement="top-end"
      >
        <div className="remote-git-checkout__head">
          <GitBranch aria-hidden="true" size={14} />
          <span className="remote-git-checkout__branch">{branch ?? REMOTE_CHECKOUT_LABEL}</span>
          <IconButton
            disabled={running}
            icon={<RefreshCw size={12} />}
            label="Fetch from origin"
            onClick={() => void git.fetch()}
            size="xs"
          />
        </div>
        {status === null ? (
          <p className="remote-git-checkout__line">
            {git.checkout.kind === "failed" ? git.checkout.message : "Reading the server checkout…"}
          </p>
        ) : (
          <CheckoutFacts nowMs={nowMs} git={git} status={status} />
        )}
        <div className="remote-git-checkout__actions">
          <Button
            aria-describedby={reason === null ? undefined : reasonId}
            disabled={updateDisabled}
            icon={<RefreshCw size={12} />}
            onClick={() => void git.update()}
            size="sm"
          >
            {running && git.network.action === "update" ? "Updating…" : "Update from origin"}
          </Button>
        </div>
        {reason === null ? null : (
          <p className="remote-git-checkout__line remote-git-checkout__reason" id={reasonId}>
            {reason}
          </p>
        )}
        <NetworkOutcome git={git} />
      </Popover>
    </div>
  );
}

function CheckoutFacts(props: {
  readonly git: RemoteProjectGit;
  readonly status: RemoteGitCheckoutStatus;
  readonly nowMs: number;
}) {
  const dirty = remoteDirtySummary(props.status);
  return (
    <>
      <p className="remote-git-checkout__line">{remoteSyncSummary(props.status)}</p>
      {dirty === null ? null : (
        <p className="remote-git-checkout__line remote-git-checkout__warning">{dirty}</p>
      )}
      <p className="remote-git-checkout__line remote-git-checkout__quiet">
        {remoteFetchedLabel(props.status.fetchedAt, props.git.network, props.nowMs)}
      </p>
    </>
  );
}

function NetworkOutcome({ git }: { readonly git: RemoteProjectGit }) {
  const network = git.network;
  if (network.kind === "failed") {
    return (
      <p className="remote-git-checkout__line remote-git-picker__error" role="alert">
        {network.message}
      </p>
    );
  }
  if (network.kind === "succeeded" && network.action === "update") {
    return (
      <p className="remote-git-checkout__line remote-git-checkout__quiet" role="status">
        {REMOTE_UPDATE_SUCCEEDED}
      </p>
    );
  }
  return null;
}

function triggerAccessibleName(
  status: RemoteGitCheckoutStatus | null,
  branch: string | null,
): string {
  if (status === null || branch === null) return REMOTE_CHECKOUT_LABEL;
  const parts = [`${REMOTE_CHECKOUT_LABEL}: ${branch}`, remoteSyncSummary(status)];
  const dirty = remoteDirtySummary(status);
  if (dirty !== null) parts.push(dirty);
  return parts.join(", ");
}
