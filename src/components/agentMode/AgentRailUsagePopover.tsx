import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AgentTurnLogFactsSource } from "../../application/agentTurnLogStatusStore";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import { focusUsageSuccessor } from "./agentRailUsageFocus";
import { AgentUsagePanel } from "./AgentUsagePanel";

export interface AgentRailUsagePopoverProps {
  readonly open: boolean;
  readonly railRef: RefObject<HTMLElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly threads: ReadonlyArray<AgentThread>;
  readonly turnLog: AgentTurnLogFactsSource | null;
  onClose(): void;
}

export function AgentRailUsagePopover({
  accountUsage,
  evidenceOf,
  onClose,
  open,
  projectLabels,
  railRef,
  threads,
  triggerRef,
  turnLog,
}: AgentRailUsagePopoverProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (dialog?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('button[aria-label="Open Usage"]') !== null
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      if (dialog?.contains(document.activeElement) !== true) return;
      queueMicrotask(() => focusUsageSuccessor(trigger));
    };
  }, [onClose, open, triggerRef]);

  if (!open) return null;
  return createPortal(
    <div className="agent-usage-layer">
      <div
        aria-label="Usage details"
        className="agent-usage-popover"
        id="agent-usage-panel-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="agent-usage-popover__header">
          <h2>Usage</h2>
          <button
            aria-label="Close Usage"
            className="agent-iconbutton agent-usage-popover__close"
            onClick={onClose}
            title="Close Usage"
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </header>
        <div className="agent-usage-popover__scroll">
          <AgentUsagePanel
            accountUsage={accountUsage}
            evidenceOf={evidenceOf}
            projectLabels={projectLabels}
            threads={threads}
            turnLog={turnLog}
          />
        </div>
      </div>
    </div>,
    railRef.current?.closest(".workbench-frame") ?? document.body,
  );
}
