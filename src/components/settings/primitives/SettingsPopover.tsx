import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useAgentPopoverPlacement, type AgentPopoverAlign } from "../../agentMode/agentPopover";

export interface SettingsPopoverProps {
  readonly align?: AgentPopoverAlign;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly label: string;
  readonly open: boolean;
  onClose(restoreFocus: boolean): void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function SettingsPopover({
  align = "end",
  anchorRef,
  children,
  label,
  onClose,
  open,
}: SettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const placement = useAgentPopoverPlacement(open, anchorRef, popoverRef, align);
  const labelId = `${useId()}-popover`;

  useEffect(() => {
    if (!open) return;

    focusableItems(popoverRef.current)[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (anchorRef.current?.contains(target) === true) return;

      onClose(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        return;
      }

      if (event.key !== "Tab") return;

      trapFocus(popoverRef.current, event);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return (
    <div
      aria-labelledby={labelId}
      className="settings-popover"
      data-placement={placement.placement}
      ref={popoverRef}
      role="dialog"
      style={placement.style}
    >
      <span className="settings-popover__label" id={labelId}>
        {label}
      </span>
      {children}
    </div>
  );
}

function focusableItems(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];

  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

function trapFocus(root: HTMLElement | null, event: KeyboardEvent): void {
  const items = focusableItems(root);
  const first = items[0];
  const last = items[items.length - 1];

  if (first === undefined || last === undefined) return;

  const active = document.activeElement;
  const inside = root?.contains(active) === true;

  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}
