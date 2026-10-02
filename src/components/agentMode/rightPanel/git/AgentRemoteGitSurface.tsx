import { CloudUpload, ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import type { AgentShipStepResult } from "../../../../domain/agentShip";
import { Button } from "../../../../ui/foundation/Button";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { StatusLabel } from "../../../../ui/foundation/StatusLabel";
import {
  agentShipFailureStepLabel,
  agentShipStepLabel,
  compareHostLabel,
} from "../../agentModePresentation";
import type { AgentShipActions } from "../../useAgentShipActions";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import {
  REMOTE_SHIP_LOADING,
  agentRemoteShipFailureLabel,
  agentRemoteShipView,
} from "./agentRemoteShipPresentation";
import "./agentGit.css";

export function AgentRemoteGitSurface() {
  const { shipActions, thread } = useAgentRightPanelContext();
  if (thread === null || shipActions === null) {
    return <p className="cv-rp-note">Select a server conversation to commit its changes.</p>;
  }
  return <RemoteGitShip actions={shipActions} key={thread.thread.threadId} thread={thread} />;
}

type Notice = Readonly<{ kind: "ok" | "error"; text: string }>;

function RemoteGitShip({
  actions,
  thread,
}: {
  readonly actions: AgentShipActions;
  readonly thread: AgentThreadView;
}) {
  const threadId = thread.thread.threadId;
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const view = agentRemoteShipView(thread);
  const busy = agentShipStepLabel(thread.ship);
  const loading = view.branch === null && busy !== null;
  const settle = (result: AgentShipStepResult, done: string): boolean => {
    if (result.kind === "succeeded") {
      setNotice({ kind: "ok", text: done });
      return true;
    }
    setNotice(result.kind === "notRun" ? { kind: "error", text: result.message } : null);
    return false;
  };
  const commit = async (): Promise<void> => {
    setNotice(null);
    const result = await actions.onCommit(threadId, message);
    if (settle(result, "Committed on the server.")) setMessage("");
  };
  const push = async (): Promise<void> => {
    setNotice(null);
    settle(await actions.onPush(threadId), "Pushed to origin.");
  };
  const commitReason = view.commit.kind === "blocked" ? view.commit.reason : null;
  const commitDisabled = commitReason !== null || message.trim() === "";
  const pushReason = view.push.kind === "blocked" ? view.push.reason : null;

  return (
    <section aria-label="Git" className="cv-git">
      <div className="cv-rp-sub">
        <div className="cv-rp-sub__grow cv-git-remote__branch">
          <GitBranch aria-hidden="true" size={14} />
          <span className="cv-git-remote__name">{view.branch ?? "Server branch"}</span>
          {view.base === null ? null : (
            <span className="cv-git-remote__base">from {view.base}</span>
          )}
        </div>
        <div className="cv-rp-sub__tools">
          {view.counts === null ? null : (
            <span className="cv-git-sync" title={view.countsTitle ?? undefined}>
              {view.counts}
            </span>
          )}
          <IconButton
            icon={<RefreshCw size={14} />}
            label="Refresh status"
            onClick={() => actions.onRefreshShipStatus(threadId)}
            size="xs"
          />
        </div>
      </div>
      <div className="cv-git__body">
        {busy !== null && (
          <div className="cv-git-banner">
            <StatusLabel kind="work" spinner>
              {loading ? REMOTE_SHIP_LOADING : busy}
            </StatusLabel>
          </div>
        )}
        <ShipFailure actions={actions} pushReason={pushReason} thread={thread} />
        {view.changes !== null && <p className="cv-git-remote__fact">{view.changes}</p>}
        {view.published !== null && <p className="cv-git-remote__fact">{view.published}</p>}
        {view.compareUrl !== null && (
          <p className="cv-git-hint">
            <button
              className="cv-git-hint__action"
              onClick={() => actions.onOpenCompareUrl(threadId)}
              type="button"
            >
              <ExternalLink aria-hidden="true" size={12} />
              {compareLabel(view.compareUrl)}
            </button>
          </p>
        )}
      </div>
      <div className="cv-git__foot">
        <div className="cv-git-box">
          <textarea
            aria-label="Commit message"
            className="cv-git-box__message"
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder="Commit message"
            rows={3}
            value={message}
          />
          <div className="cv-git-box__foot">
            <span className="cv-git-remote__hint">Commits all changes on the server</span>
            <span className="cv-git-box__end">
              <Button
                disabled={commitDisabled}
                onClick={() => void commit()}
                size="sm"
                title={commitReason ?? undefined}
              >
                Commit
              </Button>
              <Button
                disabled={pushReason !== null}
                icon={<CloudUpload size={14} />}
                onClick={() => void push()}
                size="sm"
                title={pushReason ?? undefined}
                variant="primary"
              >
                Push
              </Button>
            </span>
          </div>
        </div>
        {notice !== null && (
          <p
            className={`cv-git-notice cv-git-notice--${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
}

function ShipFailure({
  actions,
  pushReason,
  thread,
}: {
  readonly actions: AgentShipActions;
  readonly pushReason: string | null;
  readonly thread: AgentThreadView;
}) {
  const ship = thread.ship;
  if (ship.kind !== "failed") return null;
  const threadId = thread.thread.threadId;
  const retryPush = ship.failure.step === "push";
  return (
    <div className="cv-git-banner cv-git-banner--failed" role="alert">
      <p className="cv-git-banner__text">
        <b>{agentShipFailureStepLabel(ship.failure)}</b>{" "}
        {agentRemoteShipFailureLabel(thread, ship.failure)}
      </p>
      <div className="cv-git-banner__actions">
        {retryPush && (
          <Button
            disabled={pushReason !== null}
            onClick={() => void actions.onPush(threadId)}
            size="sm"
            title={pushReason ?? undefined}
          >
            Retry push
          </Button>
        )}
        <Button onClick={() => actions.onDismissFailure(threadId)} size="sm" variant="ghost">
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function compareLabel(url: string): string {
  const host = compareHostLabel(url);
  return host === null ? "Open compare page" : `Open compare page on ${host}`;
}
