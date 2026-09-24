import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./classNames";
import type { PopoverPlacement } from "./popoverPosition";
import { useDismiss } from "./useDismiss";
import { usePopoverPosition } from "./usePopoverPosition";
import { useRestoreFocus } from "./useRestoreFocus";
import "./overlays.css";

export interface PopoverProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly placement?: PopoverPlacement;
  readonly className?: string;
  readonly children: ReactNode;
  onClose(): void;
}

export function Popover(props: PopoverProps) {
  if (!props.open) return null;
  return createPortal(<PopoverSurface {...props} />, document.body);
}

function PopoverSurface({
  anchorRef,
  children,
  className,
  label,
  onClose,
  placement = "bottom-start",
}: PopoverProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const position = usePopoverPosition(anchorRef, surfaceRef, placement);
  useRestoreFocus(anchorRef);
  useDismiss(true, surfaceRef, anchorRef, onClose);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <div
      aria-label={label}
      className={cx("cv-popover", className)}
      data-placement={position.placement}
      onKeyDown={handleKeyDown}
      ref={surfaceRef}
      role="dialog"
      style={{ left: position.left, top: position.top }}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
