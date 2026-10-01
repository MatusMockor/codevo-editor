import { CircleAlert, RotateCcw, SquarePen, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  agentComposerDraftStore,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentTurnRetry } from "../../application/useAgentTurnRetry";
import type { AgentTurnRetryReadyPlan } from "../../domain/agentTurnRetry";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import {
  agentRetryLaunchNote,
  agentRetryModeLabel,
  agentThreadErrorBannerModel,
  type AgentThreadErrorBannerModel,
} from "./agentThreadErrorBannerPresentation";
import { agentComposerDraftKey, focusAgentComposerPrompt } from "./useAgentComposerState";
import {
  carryAgentDraftIntoRecovery,
  type AgentComposerRecovery,
  type AgentComposerRecoveryOutcome,
} from "./useAgentComposerRecovery";
import "./agentThreadErrorBanner.css";

const MAX_DISMISSED = 64;
export const RETRY_CONFIRM_DELAY_MS = 350;
export const NEW_THREAD_DRAFT_TOO_LARGE_MESSAGE =
  "The combined draft is too large. Shorten either draft and try again. Both drafts are unchanged.";
export const NEW_THREAD_UNAVAILABLE_MESSAGE =
  "A new thread could not be started here. Start one from the sidebar.";
export const NEW_THREAD_HINT =
  "Your unsent text is copied. Attachments and the previous conversation are not carried over.";

interface ArmedRetry {
  readonly key: string;
  readonly armedAtEpochMs: number;
}

interface NewThreadRefusal {
  readonly key: string;
  readonly outcome: Exclude<AgentComposerRecoveryOutcome, "started">;
}

export interface AgentThreadErrorBannerProps {
  readonly agents: Pick<AgentThreadsSurface, "threads" | "sendFollowUp" | "lastUsedLaunch">;
  readonly view: AgentThreadView | null;
  readonly recovery?: AgentComposerRecovery | null;
  readonly drafts?: AgentComposerDraftStore;
}

export function AgentThreadErrorBanner({
  agents,
  view,
  recovery = null,
  drafts = agentComposerDraftStore,
}: AgentThreadErrorBannerProps) {
  const retry = useAgentTurnRetry(agents);
  const [dismissed, setDismissed] = useState<ReadonlyArray<string>>([]);
  const [armed, setArmed] = useState<ArmedRetry | null>(null);
  const [refusal, setRefusal] = useState<NewThreadRefusal | null>(null);
  const threadId = view?.thread.threadId ?? null;
  const [refusalThreadId, setRefusalThreadId] = useState(threadId);
  if (refusalThreadId !== threadId) {
    setRefusalThreadId(threadId);
    setRefusal(null);
  }
  const fallback = view === null ? null : agents.lastUsedLaunch(view.thread.owner.rootKey);
  const model = useMemo(() => agentThreadErrorBannerModel(view, fallback), [fallback, view]);
  if (view === null || model === null || dismissed.includes(model.key)) return null;
  const dismiss = (): void =>
    setDismissed((current) => [...current, model.key].slice(-MAX_DISMISSED));
  if (model.remedy === "startNewThread") {
    const lease = newThreadLease(recovery, view);
    const startNewThread = (): void => {
      if (lease === null) return;
      const draft = drafts.readDraft(agentComposerDraftKey(view, null) ?? "");
      const outcome = carryAgentDraftIntoRecovery(drafts, lease, draft);
      setRefusal(outcome === "started" ? null : { key: model.key, outcome });
      if (outcome === "started") focusAgentComposerPrompt(drafts.readDraft(lease.draftKey).length);
    };
    return (
      <NewThreadAlert
        model={model}
        onDismiss={dismiss}
        onStartNewThread={lease === null ? null : startNewThread}
        refusal={refusal?.key === model.key ? refusal.outcome : null}
      />
    );
  }
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
          <DismissButton onDismiss={dismiss} />
        </div>
      </div>
    </div>
  );
}

function NewThreadAlert({
  model,
  onDismiss,
  onStartNewThread,
  refusal,
}: {
  readonly model: AgentThreadErrorBannerModel;
  readonly onDismiss: () => void;
  readonly onStartNewThread: (() => void) | null;
  readonly refusal: Exclude<AgentComposerRecoveryOutcome, "started"> | null;
}) {
  const hintId = useId();
  return (
    <div className="cv-thread-alert-wrap">
      <div className="cv-thread-alert" role="alert">
        <CircleAlert aria-hidden="true" className="cv-thread-alert__icon" size={16} />
        <div className="cv-thread-alert__text">
          <b>{model.title}</b>
          {model.detail === "" ? null : <span>{model.detail}</span>}
          {onStartNewThread === null ? null : <span id={hintId}>{NEW_THREAD_HINT}</span>}
          {refusal === null ? null : (
            <span className="cv-thread-alert__failure">{refusalMessage(refusal)}</span>
          )}
        </div>
        <div className="cv-thread-alert__actions">
          {onStartNewThread === null ? null : (
            <Button
              aria-describedby={hintId}
              icon={<SquarePen size={14} />}
              onClick={onStartNewThread}
              size="sm"
              variant="primary"
            >
              Start new thread
            </Button>
          )}
          <DismissButton onDismiss={onDismiss} />
        </div>
      </div>
    </div>
  );
}

function DismissButton({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <IconButton
      icon={<X size={14} />}
      label="Dismiss error"
      onClick={onDismiss}
      size="xs"
      title="Dismiss"
    />
  );
}

function newThreadLease(
  recovery: AgentComposerRecovery | null,
  view: AgentThreadView,
): AgentComposerRecovery | null {
  if (recovery?.reason !== "conversationImagesTooLarge") return null;
  return recovery.threadId === view.thread.threadId ? recovery : null;
}

function refusalMessage(refusal: Exclude<AgentComposerRecoveryOutcome, "started">): string {
  switch (refusal) {
    case "draftTooLarge":
      return NEW_THREAD_DRAFT_TOO_LARGE_MESSAGE;
    case "unavailable":
      return NEW_THREAD_UNAVAILABLE_MESSAGE;
    default:
      return unsupportedRefusal(refusal);
  }
}

function unsupportedRefusal(refusal: never): never {
  throw new TypeError(`Unsupported new thread refusal: ${String(refusal)}.`);
}

function retryLabel(pending: boolean, confirmMode: string | null): string {
  if (pending) return "Retrying…";
  if (confirmMode === null) return "Retry";
  return `Confirm retry with ${confirmMode}`;
}
