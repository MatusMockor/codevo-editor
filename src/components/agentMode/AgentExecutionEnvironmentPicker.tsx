import { useId, useLayoutEffect, type KeyboardEvent } from "react";
import { Check, ChevronDown, Monitor, Server, Settings2 } from "lucide-react";
import { useAgentPopover } from "./agentPopover";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import "./agentExecutionEnvironmentPicker.css";

export interface AgentExecutionEnvironmentPickerProps {
  readonly executionServerId?: string | null;
  readonly disabled: boolean;
  readonly locked: boolean;
  onOpenEnvironmentSettings(): void;
}

export function AgentExecutionEnvironmentPicker({
  disabled,
  locked,
  executionServerId = null,
  onOpenEnvironmentSettings,
}: AgentExecutionEnvironmentPickerProps) {
  const remote = useRemoteRunnerContext();
  const selectedServer = remote?.servers.find((server) => server.id === remote.selectedServerId);
  const serverSelected = remote?.selectedServerId != null;
  const selectedName = serverSelected
    ? (selectedServer?.name ?? "Server unavailable")
    : "This computer";
  const id = useId();
  const popover = useAgentPopover("start", disabled || locked);
  const { open, popoverRef } = popover;

  useLayoutEffect(() => {
    if (open)
      popoverRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, popoverRef]);

  if (locked) {
    const name =
      executionServerId === null
        ? "This computer"
        : (remote?.servers.find((server) => server.id === executionServerId)?.name ?? "Server");
    return (
      <span className="agent-environment__locked" title={`This task runs on ${name}`}>
        {executionServerId === null ? (
          <Monitor aria-hidden="true" size={14} />
        ) : (
          <Server aria-hidden="true" size={14} />
        )}
        <span>{name}</span>
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
        aria-label={`Run on: ${selectedName}`}
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
        {serverSelected ? (
          <Server aria-hidden="true" className="agent-picker__icon" size={14} />
        ) : (
          <Monitor aria-hidden="true" className="agent-picker__icon" size={14} />
        )}
        <span className="agent-picker__value">{selectedName}</span>
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
            aria-checked={!serverSelected}
            className="agent-picker__option agent-environment__row"
            onClick={() => {
              remote?.selectServer(null);
              popover.hide(true);
            }}
          >
            <Monitor aria-hidden="true" size={14} />
            <span className="agent-picker__text">
              <span className="agent-picker__label">This computer</span>
              <span className="agent-picker__description">Default for new tasks</span>
            </span>
            {!serverSelected && (
              <Check aria-hidden="true" className="agent-environment__check" size={14} />
            )}
          </button>
          {remote?.servers.map((server) => (
            <button
              key={server.id}
              type="button"
              role="menuitemradio"
              aria-checked={selectedServer?.id === server.id}
              disabled={!server.connected}
              className="agent-picker__option agent-environment__row"
              onClick={() => {
                remote.selectServer(server.id);
                popover.hide(true);
              }}
            >
              <Server aria-hidden="true" size={14} />
              <span className="agent-picker__text">
                <span className="agent-picker__label">{server.name}</span>
                <span className="agent-picker__description">
                  {server.connected ? "Run on server" : "Connect in settings"}
                </span>
              </span>
              {selectedServer?.id === server.id && (
                <Check aria-hidden="true" className="agent-environment__check" size={14} />
              )}
            </button>
          ))}
          {!remote && (
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
          )}
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
