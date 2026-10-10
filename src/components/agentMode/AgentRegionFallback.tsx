import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { ErrorBoundaryFailure } from "../ErrorBoundary";
import {
  agentRegionFailureDetails,
  agentRegionFailureTitle,
  type AgentRegion,
} from "./agentRegionFailurePresentation";

type CopyState = "idle" | "copied" | "failed";
type CopyOutcome = Exclude<CopyState, "idle">;

const COPY_FEEDBACK_MS = 1_600;

const COPY_LABELS: Readonly<Record<CopyState, string>> = {
  idle: "Copy details",
  copied: "Copied",
  failed: "Couldn't copy",
};

export interface AgentRegionFallbackProps {
  readonly region: AgentRegion;
  readonly failure: ErrorBoundaryFailure;
  readonly clipboard: TextClipboardGateway | null;
  readonly hidden: boolean;
}

export function AgentRegionFallback({
  region,
  failure,
  clipboard,
  hidden,
}: AgentRegionFallbackProps) {
  const notice = (
    <AgentRegionFailureNotice clipboard={clipboard} failure={failure} region={region} />
  );
  return <AgentRegionFrame hidden={hidden} notice={notice} region={region} />;
}

function AgentRegionFrame({
  region,
  hidden,
  notice,
}: {
  readonly region: AgentRegion;
  readonly hidden: boolean;
  readonly notice: ReactNode;
}) {
  switch (region) {
    case "sidebar":
      return (
        <aside aria-label="Agent threads" className="agent-rail">
          {notice}
        </aside>
      );
    case "rightPanel":
      return (
        <div
          aria-hidden={hidden || undefined}
          className="agent-surface-host"
          data-slot="surface"
          hidden={hidden}
        >
          <aside aria-label="Thread surface" className="agent-surface" data-editor-slot="none">
            {notice}
          </aside>
        </div>
      );
    case "conversation":
    case "composer":
      return notice;
    default:
      return unsupportedRegion(region);
  }
}

function unsupportedRegion(region: never): never {
  throw new Error(`Unsupported agent region: ${String(region)}`);
}

function AgentRegionFailureNotice({
  region,
  failure,
  clipboard,
}: {
  readonly region: AgentRegion;
  readonly failure: ErrorBoundaryFailure;
  readonly clipboard: TextClipboardGateway | null;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const attemptRef = useRef(0);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      attemptRef.current += 1;
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  const copyDetails = async (gateway: TextClipboardGateway): Promise<void> => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const outcome = await writeDetails(
      gateway,
      agentRegionFailureDetails({
        region,
        error: failure.error,
        componentStack: failure.componentStack,
      }),
    );
    if (attempt !== attemptRef.current) return;
    setCopyState(outcome);
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setCopyState("idle");
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div
      className={`agent-region-fallback agent-region-fallback--${region}`}
      data-region={region}
      role="alert"
    >
      <p className="agent-region-fallback__title">{agentRegionFailureTitle(region)}</p>
      <div className="agent-region-fallback__actions">
        <button
          className="agent-region-fallback__action agent-region-fallback__action--primary"
          data-action="retry"
          onClick={failure.retry}
          type="button"
        >
          Try again
        </button>
        {clipboard !== null && (
          <button
            className="agent-region-fallback__action"
            data-action="copy-details"
            data-copy-state={copyState}
            onClick={() => void copyDetails(clipboard)}
            type="button"
          >
            {COPY_LABELS[copyState]}
          </button>
        )}
      </div>
    </div>
  );
}

async function writeDetails(clipboard: TextClipboardGateway, text: string): Promise<CopyOutcome> {
  if (!clipboard.canWriteText()) return "failed";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
