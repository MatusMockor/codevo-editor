import { useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Menu } from "../../../ui/foundation/Menu";
import type { PopoverPlacement } from "../../../ui/foundation/popoverPosition";
import { useAgentControlOpenRequest } from "../useAgentControlOpenRequest";
import "./agentPickers.css";

export interface ComposerMenuPickerTrigger {
  readonly ref: (element: HTMLButtonElement | null) => void;
  readonly open: boolean;
  show(): void;
  toggle(): void;
}

export interface ComposerMenuPickerProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly openRequest?: object | null;
  readonly placement?: PopoverPlacement;
  readonly children: ReactNode;
  renderTrigger(trigger: ComposerMenuPickerTrigger): ReactNode;
  onOpen?(): void;
  onOpenRequestHandled?(): void;
}

export function ComposerMenuPicker({
  children,
  disabled,
  label,
  onOpen,
  onOpenRequestHandled,
  openRequest = null,
  placement = "top-start",
  renderTrigger,
}: ComposerMenuPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);
  const show = (): void => {
    if (disabled) return;
    triggerRef.current?.focus();
    if (!open) onOpen?.();
    setOpen(true);
  };
  useAgentControlOpenRequest(openRequest, show, onOpenRequestHandled);
  const outsideRoot = (target: EventTarget | null): boolean =>
    target instanceof Node && !(rootRef.current?.contains(target) ?? false);
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (!(next instanceof Element)) return;
    if (outsideRoot(next) && next.closest('[role="menu"]') === null) return;
    event.stopPropagation();
  };
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (!outsideRoot(event.target)) return;
    event.stopPropagation();
  };
  return (
    <div
      className={open ? "agent-picker agent-picker--open" : "agent-picker"}
      onBlur={handleBlur}
      onMouseDown={handleMouseDown}
      ref={rootRef}
    >
      {renderTrigger({
        open,
        show,
        ref: (element) => {
          triggerRef.current = element;
        },
        toggle: () => {
          if (open) {
            setOpen(false);
            return;
          }
          show();
        },
      })}
      <Menu
        anchorRef={triggerRef}
        label={label}
        onClose={() => setOpen(false)}
        open={open}
        placement={placement}
      >
        {children}
      </Menu>
    </div>
  );
}
