import { useId, useLayoutEffect, type KeyboardEvent } from "react";
import { ChevronDown, Play, SlidersHorizontal, Square } from "lucide-react";
import {
  AGENT_SCRIPT_BUSY_REASON,
  type AgentThreadScriptEntry,
  type AgentThreadScriptRunState,
  type AgentThreadScriptsSurface,
} from "../../application/useAgentThreadScripts";
import { focusMenuItem, useAgentPopover } from "./agentPopover";
import {
  AGENT_SCRIPT_ELSEWHERE_SUFFIX,
  AGENT_SCRIPT_NONE_LABEL,
} from "./agentThreadHeaderPresentation";

export interface AgentScriptRunControlProps {
  readonly scripts: AgentThreadScriptsSurface;
  onOpenScriptsView: (() => void) | null;
}

export function AgentScriptRunControl({ onOpenScriptsView, scripts }: AgentScriptRunControlProps) {
  const menuId = useId();
  const run = scripts.run;
  const running = run.kind === "running";
  const stoppable = run.kind === "running" && run.stoppable;
  const foreign = run.kind === "running" && !run.stoppable;
  const preferred = scripts.preferred;
  const menuEmpty = scripts.entries.length === 0 && onOpenScriptsView === null;
  const popover = useAgentPopover("end", menuEmpty);
  const primaryLabel = stoppable
    ? `Stop ${run.kind === "running" ? run.label : ""}`.trim()
    : foreign
      ? `${run.kind === "running" ? run.label : ""} ${AGENT_SCRIPT_ELSEWHERE_SUFFIX}`.trim()
      : preferred === null
        ? AGENT_SCRIPT_NONE_LABEL
        : `Run ${preferred.label}`;
  const primaryBlocked =
    !stoppable && (foreign || preferred === null || preferred.availability.kind === "blocked");
  const primaryTitle = primaryTitleFor(run, preferred);

  const onPrimary = (): void => {
    if (stoppable) {
      scripts.stopScript();
      return;
    }
    if (foreign) return;
    if (preferred === null) return;
    scripts.runScript(preferred.key);
  };

  const choose = (entry: AgentThreadScriptEntry): void => {
    popover.hide(true);
    scripts.runScript(entry.key);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Tab") return;
    popover.hide(false);
  };

  const { open, popoverRef } = popover;
  useLayoutEffect(() => {
    if (!open) return;
    focusMenuItem(popoverRef.current, 0);
  }, [open, popoverRef]);

  return (
    <div
      className={`agent-split${popover.open ? " agent-split--open" : ""}`}
      data-placement={popover.open ? popover.placement : undefined}
      data-running={running ? "true" : undefined}
      data-run-owner={foreign ? "elsewhere" : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-label={primaryLabel}
        className={`agent-split__main${stoppable ? " agent-split__main--stop" : ""}`}
        disabled={primaryBlocked}
        onClick={onPrimary}
        title={primaryTitle}
        type="button"
      >
        {stoppable ? (
          <Square aria-hidden="true" size={12} />
        ) : (
          <Play aria-hidden="true" size={12} />
        )}
        <span className="agent-split__label agent-num">
          {run.kind === "running" ? run.label : (preferred?.label ?? "Scripts")}
        </span>
      </button>
      <button
        aria-controls={popover.open ? menuId : undefined}
        aria-expanded={popover.open}
        aria-haspopup="menu"
        aria-label="Choose a script"
        className="agent-split__chevron"
        disabled={menuEmpty}
        onClick={popover.toggle}
        ref={popover.triggerRef}
        title="Choose a script"
        type="button"
      >
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {popover.open && (
        <div
          aria-label="Scripts"
          className="agent-menu agent-menu--scripts"
          id={menuId}
          onKeyDown={onMenuKeyDown}
          ref={popover.popoverRef}
          role="menu"
          style={popover.style}
        >
          {scripts.entries.map((entry) => (
            <ScriptItem
              disabled={running || entry.availability.kind === "blocked"}
              entry={entry}
              key={entry.key}
              onSelect={() => choose(entry)}
              preferred={entry.key === preferred?.key}
            />
          ))}
          {scripts.entries.length === 0 && (
            <p className="agent-menu__note">No package scripts in this repository.</p>
          )}
          {scripts.truncated && (
            <p className="agent-menu__note">Only the first entries are listed.</p>
          )}
          {onOpenScriptsView !== null && (
            <>
              <div aria-hidden="true" className="agent-menu__separator" />
              <button
                className="agent-menu__item"
                onClick={() => {
                  popover.hide(true);
                  onOpenScriptsView();
                }}
                role="menuitem"
                tabIndex={-1}
                type="button"
              >
                <span aria-hidden="true" className="agent-menu__icon">
                  <SlidersHorizontal size={13} />
                </span>
                Open Scripts and Tasks
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptItem({
  disabled,
  entry,
  onSelect,
  preferred,
}: {
  readonly disabled: boolean;
  readonly entry: AgentThreadScriptEntry;
  readonly preferred: boolean;
  onSelect(): void;
}) {
  const reason = entry.availability.kind === "blocked" ? entry.availability.reason : null;
  return (
    <button
      aria-current={preferred ? "true" : undefined}
      className={`agent-menu__item${preferred ? " agent-menu__item--current" : ""}`}
      data-script-key={entry.key}
      disabled={disabled}
      onClick={onSelect}
      role="menuitem"
      tabIndex={-1}
      title={reason ?? undefined}
      type="button"
    >
      <span aria-hidden="true" className="agent-menu__icon">
        <Play size={12} />
      </span>
      <span className="agent-menu__text">
        <span className="agent-menu__label agent-num">{entry.label}</span>
        {entry.detail !== null && <span className="agent-menu__detail">{entry.detail}</span>}
        {reason !== null && <span className="agent-menu__reason">{reason}</span>}
      </span>
    </button>
  );
}

function primaryTitleFor(
  run: AgentThreadScriptRunState,
  preferred: AgentThreadScriptEntry | null,
): string {
  if (run.kind === "running" && run.stoppable) return "Stop the running script";
  if (run.kind === "running") return run.reason ?? AGENT_SCRIPT_BUSY_REASON;
  if (preferred === null) return "No package scripts in this repository";
  if (preferred.availability.kind === "blocked") return preferred.availability.reason;
  return `Run ${preferred.label} in the terminal panel`;
}
