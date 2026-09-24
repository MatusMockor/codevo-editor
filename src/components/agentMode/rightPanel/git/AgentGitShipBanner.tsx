import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import { agentShipStatus, type AgentShipState } from "../../../../domain/agentShip";
import type { GitShipStatus } from "../../../../domain/gitIntegration";
import { Button } from "../../../../ui/foundation/Button";
import { StatusLabel } from "../../../../ui/foundation/StatusLabel";
import {
  agentShipAvailability,
  agentShipConflictFiles,
  agentShipDefaultIntegrationMode,
  agentShipFailureActions,
  agentShipFailureLabel,
  agentShipFailureStepLabel,
  agentShipRelationLabel,
  agentShipStepLabel,
} from "../../agentModePresentation";
import type { AgentShipActions } from "../../useAgentShipActions";

type FailedShip = Extract<AgentShipState, { kind: "failed" }>;

export interface AgentGitShipBannerProps {
  readonly thread: AgentThreadView;
  readonly actions: AgentShipActions;
}

export function AgentGitShipBanner({ actions, thread }: AgentGitShipBannerProps) {
  const ship = thread.ship;
  const status = agentShipStatus(ship);
  const busyLabel = agentShipStepLabel(ship);
  const failed = ship.kind === "failed" && ship.failure.step !== "commit" ? ship : null;
  const facts = shipFacts(ship, status);
  if (busyLabel === null && failed === null && facts.length === 0) return null;
  return (
    <div className="cv-git-banner">
      {busyLabel !== null && (
        <StatusLabel kind="work" spinner>
          {busyLabel}
        </StatusLabel>
      )}
      {failed !== null && <ShipFailure actions={actions} ship={failed} thread={thread} />}
      {facts.map((fact) => (
        <p className={`cv-git-banner__${fact.tone}`} key={fact.text}>
          {fact.text}
        </p>
      ))}
    </div>
  );
}

function ShipFailure(props: {
  readonly thread: AgentThreadView;
  readonly ship: FailedShip;
  readonly actions: AgentShipActions;
}) {
  const { actions, ship, thread } = props;
  const threadId = thread.thread.threadId;
  const conflicts = agentShipConflictFiles(ship.failure);
  const { guidance, retryLabel } = agentShipFailureActions(ship.failure);
  return (
    <div className="cv-git-banner cv-git-banner--failed" role="alert">
      <p className="cv-git-banner__text">
        <b>{agentShipFailureStepLabel(ship.failure)}</b> {agentShipFailureLabel(ship.failure)}
      </p>
      {conflicts.files.length > 0 && (
        <ul aria-label="Conflicted files" className="cv-git-banner__files">
          {conflicts.files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
      {conflicts.hiddenCount > 0 && (
        <p className="cv-git-banner__quiet">+{conflicts.hiddenCount} more conflicted files</p>
      )}
      {conflicts.truncated && (
        <p className="cv-git-banner__warning">More conflicted files exist than git reported.</p>
      )}
      {guidance !== null && <p className="cv-git-banner__warning">{guidance}</p>}
      <div className="cv-git-banner__actions">
        {retryLabel !== null && (
          <Button aria-label={retryLabel} onClick={() => retry(actions, thread, ship)} size="sm">
            {retryLabel}
          </Button>
        )}
        <Button
          aria-label="Dismiss"
          onClick={() => actions.onDismissFailure(threadId)}
          size="sm"
          variant="ghost"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

interface ShipFact {
  readonly text: string;
  readonly tone: "quiet" | "warning";
}

function shipFacts(ship: AgentShipState, status: GitShipStatus | null): ReadonlyArray<ShipFact> {
  const facts: ShipFact[] = [];
  if (status !== null) facts.push({ text: agentShipRelationLabel(status), tone: "quiet" });
  if (status?.primary.dirty === true) {
    facts.push({ text: "The main checkout has uncommitted changes.", tone: "warning" });
  }
  if (status !== null && status.primary.branch === null) {
    facts.push({ text: "The main checkout is detached.", tone: "warning" });
  }
  const receipt = receiptFact(ship);
  if (receipt !== null) facts.push({ text: receipt, tone: "quiet" });
  return facts;
}

function receiptFact(ship: AgentShipState): string | null {
  if (ship.kind === "committed") return `Committed ${ship.commitSha.slice(0, 8)}.`;
  if (ship.kind === "pushed") return `Pushed ${ship.receipt.branch} to ${ship.receipt.remote}.`;
  if (ship.kind === "integrated") {
    return `Merged ${ship.mergeSha.slice(0, 8)} into ${ship.intoBranch}.`;
  }
  return null;
}

function retry(actions: AgentShipActions, thread: AgentThreadView, ship: FailedShip): void {
  const threadId = thread.thread.threadId;
  switch (ship.failure.step) {
    case "commit":
      actions.onDismissFailure(threadId);
      return;
    case "push":
      void actions.onPush(threadId);
      return;
    case "integrate":
      actions.onIntegrate(threadId, agentShipDefaultIntegrationMode(ship.status));
      return;
    case "removeWorktree":
      actions.onRemoveWorktree(threadId, {
        deleteBranch: agentShipAvailability(thread).deleteBranch.kind === "available",
      });
      return;
    default: {
      const exhaustive: never = ship.failure;
      return exhaustive;
    }
  }
}
