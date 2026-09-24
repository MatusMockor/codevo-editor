import { CircleAlert, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentTurnRetry } from "../../application/useAgentTurnRetry";
import type { AgentTurnRetryReadyPlan } from "../../domain/agentTurnRetry";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import {
  agentRetryLaunchNote,
  agentRetryModeLabel,
  agentThreadErrorBannerModel,
} from "./agentThreadErrorBannerPresentation";
import "./agentThreadErrorBanner.css";

const MAX_DISMISSED = 64;
export const RETRY_CONFIRM_DELAY_MS = 350;

interface ArmedRetry {
  readonly key: string;
  readonly armedAtEpochMs: number;
}

export interface AgentThreadErrorBannerProps {
  readonly agents: Pick<AgentThreadsSurface, "threads" | "sendFollowUp" | "lastUsedLaunch">;
  readonly view: AgentThreadView | null;
}

export function AgentThreadErrorBanner({ agents, view }: AgentThreadErrorBannerProps) {
  const retry = useAgentTurnRetry(agents);
  const [dismissed, setDismissed] = useState<ReadonlyArray<string>>([]);
  const [armed, setArmed] = useState<ArmedRetry | null>(null);
  const fallback = view === null ? null : agents.lastUsedLaunch(view.thread.owner.rootKey);
  const model = useMemo(() => agentThreadErrorBannerModel(view, fallback), [fallback, view]);
  if (model === null || dismissed.includes(model.key)) return null;
  const plan = model.retry;
  const pending = retry.pendingTurnId === model.failedTurnId;
  const confirming = plan.kind === "ready" && plan.dangerous && armed?.key === model.key;
  const launchNote = plan.kind === "ready" ? agentRetryLaunchNote(plan) : null;
  const failure = retry.failure?.failedTurnId === model.failedTurnId ? retry.failure : null;
  const press = (ready: AgentTurnRetryReadyPlan): void => {
    if (!ready.dangerous) {
      void retry.retry(ready);
      return;
    }
    const now = Date.now();
    if (armed?.key !== model.key) {
      setArmed({ key: model.key, armedAtEpochMs: now });
      return;
    }
    if (now - armed.armedAtEpochMs < RETRY_CONFIRM_DELAY_MS) return;
    setArmed(null);
    void retry.retry(ready, true);
  };
  return (
    <div className="cv-thread-alert-wrap">
      <div className="cv-thread-alert" role="alert">
        <CircleAlert aria-hidden="true" className="cv-thread-alert__icon" size={16} />
        <div className="cv-thread-alert__text">
          <b>{model.title}</b>
          {model.detail === "" ? null : <span>{model.detail}</span>}
          {plan.kind === "unavailable" && (
            <span className="cv-thread-alert__reason">{plan.reason}</span>
          )}
          {launchNote === null ? null : (
            <span className="cv-thread-alert__reason">{launchNote}</span>
          )}
          {failure === null ? null : (
            <span className="cv-thread-alert__failure">{failure.message}</span>
          )}
        </div>
        <div className="cv-thread-alert__actions">
          <Button
            disabled={plan.kind !== "ready" || pending}
            icon={<RotateCcw size={14} />}
            onClick={() => {
              if (plan.kind === "ready") press(plan);
            }}
            size="sm"
            title={plan.kind === "unavailable" ? plan.reason : undefined}
            variant={confirming ? "danger" : "default"}
          >
            {retryLabel(pending, confirming ? agentRetryModeLabel(plan) : null)}
          </Button>
          <IconButton
            icon={<X size={14} />}
            label="Dismiss error"
            onClick={() => setDismissed((current) => [...current, model.key].slice(-MAX_DISMISSED))}
            size="xs"
            title="Dismiss"
          />
        </div>
      </div>
    </div>
  );
}

function retryLabel(pending: boolean, confirmMode: string | null): string {
  if (pending) return "Retrying…";
  if (confirmMode === null) return "Retry";
  return `Confirm retry with ${confirmMode}`;
}
