import { useAgentControlOpenRequest } from "./useAgentControlOpenRequest";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { useAgentPopover } from "./agentPopover";
import { focusFirstInPopover, trapPopoverTab } from "./agentPopoverFocus";

export interface AgentComposerCompactMenuProps {
  readonly disabled: boolean;
  readonly openRequest?: object | null;
  readonly children: ReactNode;
}

export function AgentComposerCompactMenu({
  children,
  disabled,
  openRequest = null,
}: AgentComposerCompactMenuProps) {
  const popover = useAgentPopover("start", disabled);
  const { open, popoverRef } = popover;
  const focusFirst = useRef(true);
  useAgentControlOpenRequest(openRequest, () => {
    focusFirst.current = false;
    popover.show();
  });

  useLayoutEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirstInPopover(popoverRef.current);
  }, [open, popoverRef]);

  return (
    <div className="agent-composer__compact" onBlur={popover.onBlur} ref={popover.rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More composer controls"
        className="agent-composer__compact-trigger"
        disabled={disabled}
        onClick={() => {
          focusFirst.current = true;
          popover.toggle();
        }}
        ref={popover.triggerRef}
        title="More composer controls"
        type="button"
      >
        <Ellipsis aria-hidden="true" size={14} />
      </button>

      {open && (
        <div
          aria-label="Composer controls"
          className="agent-composer__compact-panel"
          data-placement={popover.placement}
          onKeyDown={trapPopoverTab}
          ref={popoverRef}
          role="group"
          style={{ ...popover.style, overflowY: "auto" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
