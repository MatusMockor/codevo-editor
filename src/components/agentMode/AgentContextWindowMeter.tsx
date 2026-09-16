import { useId, useLayoutEffect } from "react";
import { useAgentPopover } from "./agentPopover";
import "./agentContextWindowMeter.css";

export interface AgentContextWindowUsage {
  readonly usedTokens: number;
  readonly contextWindow: number;
}

export interface AgentContextWindowMeterProps {
  readonly usage: AgentContextWindowUsage | null;
  readonly ownerKey: string;
}

export function AgentContextWindowMeter({ usage, ownerKey }: AgentContextWindowMeterProps) {
  if (
    usage === null ||
    !Number.isSafeInteger(usage.usedTokens) ||
    usage.usedTokens < 0 ||
    !Number.isSafeInteger(usage.contextWindow) ||
    usage.contextWindow <= 0
  ) {
    return null;
  }
  return <ContextWindowMeter key={ownerKey} usage={usage} />;
}

function ContextWindowMeter({ usage }: { readonly usage: AgentContextWindowUsage }) {
  const popover = useAgentPopover("end");
  const descriptionId = useId();
  const percent = Math.round((usage.usedTokens / usage.contextWindow) * 100);
  const label = `Context window: ${percent}% used`;
  const { open, popoverRef } = popover;
  useLayoutEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open, popoverRef]);

  return (
    <div className="agent-context-meter" onBlur={popover.onBlur} ref={popover.rootRef}>
      <button
        aria-controls={open ? descriptionId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="agent-context-meter__trigger"
        data-high-usage={percent >= 90 ? "true" : undefined}
        onClick={popover.toggle}
        ref={popover.triggerRef}
        title={label}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle className="agent-context-meter__track" cx="12" cy="12" r="9" />
          <circle
            className="agent-context-meter__fill"
            cx="12"
            cy="12"
            pathLength="100"
            r="9"
            strokeDasharray={`${Math.min(100, percent)} 100`}
          />
        </svg>
        <span aria-hidden="true" className="agent-context-meter__percent">
          {percent}%
        </span>
      </button>
      {open && (
        <div
          aria-label="Context window"
          className="agent-context-meter__details"
          id={descriptionId}
          ref={popoverRef}
          role="dialog"
          style={popover.style}
          tabIndex={-1}
        >
          <strong>Context window</strong>
          <span>{percent}% used</span>
          <span>
            {usage.usedTokens.toLocaleString("en-US")} /{" "}
            {usage.contextWindow.toLocaleString("en-US")} tokens
          </span>
          <p>Latest provider-reported usage. This is not compaction progress.</p>
        </div>
      )}
    </div>
  );
}
