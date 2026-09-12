import { useId, useLayoutEffect, type KeyboardEvent } from "react";
import { Check, ChevronDown, Monitor, Server, Settings2 } from "lucide-react";
import { useAgentPopover } from "./agentPopover";
import "./agentExecutionEnvironmentPicker.css";

export interface AgentExecutionEnvironmentPickerProps {
  readonly disabled: boolean;
  readonly locked: boolean;
  onOpenEnvironmentSettings(): void;
}

export function AgentExecutionEnvironmentPicker({
  disabled,
  locked,
  onOpenEnvironmentSettings,
}: AgentExecutionEnvironmentPickerProps) {
  const id = useId();
  const popover = useAgentPopover("start", disabled || locked);
  const { open, popoverRef } = popover;

  useLayoutEffect(() => {
    if (open)
      popoverRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, popoverRef]);

  if (locked) {
    return (
      <span className="agent-environment__locked" title="This task runs on this computer">
        <Monitor aria-hidden="true" size={14} />
        <span>This computer</span>
      </span>
    );
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      popover.hide(true);
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Home") return items[0]?.focus();
    if (event.key === "End") return items[items.length - 1]?.focus();
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div
      className={`agent-picker agent-environment${open ? " agent-picker--open" : ""}`}
      data-placement={open ? popover.placement : undefined}
      ref={popover.rootRef}
      onBlur={popover.onBlur}
    >
      <button
        type="button"
        className="agent-picker__trigger agent-picker__trigger--ghost"
        aria-label="Run on: This computer"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        ref={popover.triggerRef}
        onClick={popover.toggle}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          popover.show();
        }}
      >
        <Monitor aria-hidden="true" className="agent-picker__icon" size={14} />
        <span className="agent-picker__value">This computer</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label="Run on"
          className="agent-picker__menu agent-environment__menu"
          ref={popoverRef}
          style={popover.style}
          onKeyDown={onMenuKeyDown}
        >
          <div className="agent-picker__group">Run on</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked="true"
            className="agent-picker__option agent-environment__row"
            onClick={() => popover.hide(true)}
          >
            <Monitor aria-hidden="true" size={14} />
            <span className="agent-picker__text">
              <span className="agent-picker__label">This computer</span>
              <span className="agent-picker__description">Default for new tasks</span>
            </span>
            <Check aria-hidden="true" className="agent-environment__check" size={14} />
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked="false"
            disabled
            className="agent-picker__option agent-environment__row"
          >
            <Server aria-hidden="true" size={14} />
            <span className="agent-picker__text">
              <span className="agent-picker__label">Remote server</span>
              <span className="agent-picker__description">Coming soon</span>
            </span>
          </button>
          <div role="separator" className="agent-environment__separator" />
          <button
            type="button"
            role="menuitem"
            className="agent-picker__option agent-environment__row"
            onClick={() => {
              popover.hide(true);
              onOpenEnvironmentSettings();
            }}
          >
            <Settings2 aria-hidden="true" size={14} />
            <span className="agent-picker__label">Manage environments</span>
          </button>
        </div>
      )}
    </div>
  );
}
