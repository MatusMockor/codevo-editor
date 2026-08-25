import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { ChevronDown, GitCommitHorizontal, GitMerge, Upload } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentShipStatus } from "../../domain/agentShip";
import {
  agentShipDefaultCommitMessage,
  agentShipDefaultIntegrationMode,
} from "./agentModePresentation";
import { focusMenuItem, useAgentPopover } from "./agentPopover";
import { focusFirstInPopover, trapPopoverTab } from "./agentPopoverFocus";
import { AgentShipPanel, type AgentShipActions } from "./AgentShipPanel";
import {
  agentShipQuickAction,
  type AgentShipQuickActionKind,
} from "./agentThreadHeaderPresentation";

export interface AgentCommitMenuProps {
  readonly thread: AgentThreadView;
  readonly actions: AgentShipActions;
  readonly openSignal?: number;
}

export const MAX_AGENT_COMMIT_DRAFTS = 32;

export function AgentCommitMenu({ actions, openSignal = 0, thread }: AgentCommitMenuProps) {
  const popoverId = useId();
  const threadId = thread.thread.threadId;
  const quick = agentShipQuickAction(thread);
  const blocked = quick.availability.kind === "blocked" ? quick.availability.reason : null;
  const popover = useAgentPopover("end");
  const { hide, open, popoverRef, show } = popover;
  const drafts = useRef<Map<string, string>>(new Map());
  const handledOpenSignal = useRef(openSignal);

  useEffect(() => {
    hide(false);
  }, [hide, threadId]);

  useEffect(() => {
    if (openSignal === handledOpenSignal.current) return;
    handledOpenSignal.current = openSignal;
    show();
  }, [openSignal, show]);

  useLayoutEffect(() => {
    if (!open) return;
    focusFirstInPopover(popoverRef.current);
  }, [open, popoverRef]);

  const rememberDraft = useCallback(
    (message: string) => {
      const map = drafts.current;
      map.delete(threadId);
      map.set(threadId, message);
      while (map.size > MAX_AGENT_COMMIT_DRAFTS) {
        const oldest = map.keys().next();
        if (oldest.done === true) return;
        map.delete(oldest.value);
      }
    },
    [threadId],
  );

  const onPrimary = (): void => {
    switch (quick.kind) {
      case "commit":
        actions.onCommit(
          threadId,
          drafts.current.get(threadId) ?? agentShipDefaultCommitMessage(thread.thread),
        );
        return;
      case "push":
        actions.onPush(threadId);
        return;
      case "integrate":
        actions.onIntegrate(
          threadId,
          agentShipDefaultIntegrationMode(agentShipStatus(thread.ship)),
        );
        return;
      case "none":
        return;
      default:
        return unsupportedQuickAction(quick.kind);
    }
  };

  return (
    <div
      className={`agent-split${open ? " agent-split--open" : ""}`}
      data-placement={open ? popover.placement : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-label={quick.label}
        className="agent-split__main"
        disabled={blocked !== null}
        onClick={onPrimary}
        title={blocked ?? quick.label}
        type="button"
      >
        <QuickIcon kind={quick.kind} />
        <span className="agent-split__label">{quick.label}</span>
      </button>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Ship options"
        className="agent-split__chevron"
        onClick={() => {
          popover.toggle();
          queueMicrotask(() => focusMenuItem(popoverRef.current, 0));
        }}
        ref={popover.triggerRef}
        title="Ship options"
        type="button"
      >
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {open && (
        <div
          aria-label={`Ship ${thread.thread.title}`}
          className="agent-popover agent-popover--ship"
          id={popoverId}
          onKeyDown={trapPopoverTab}
          ref={popoverRef}
          role="dialog"
          style={popover.style}
        >
          <AgentShipPanel
            actions={actions}
            initialMessage={drafts.current.get(threadId) ?? null}
            onMessageChange={rememberDraft}
            thread={thread}
          />
        </div>
      )}
    </div>
  );
}

function QuickIcon({ kind }: { readonly kind: AgentShipQuickActionKind }) {
  if (kind === "push") return <Upload aria-hidden="true" size={13} />;
  if (kind === "integrate") return <GitMerge aria-hidden="true" size={13} />;
  return <GitCommitHorizontal aria-hidden="true" size={13} />;
}

function unsupportedQuickAction(kind: never): never {
  throw new TypeError(`Unsupported ship quick action: ${String(kind)}.`);
}
