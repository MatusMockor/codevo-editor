import { useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MenuSurface } from "./MenuSurface";
import type { PopoverPlacement } from "./popoverPosition";
import { useDismiss } from "./useDismiss";
import { useRestoreFocus } from "./useRestoreFocus";

export interface MenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly placement?: PopoverPlacement;
  readonly children: ReactNode;
  onClose(): void;
}

export function Menu(props: MenuProps) {
  if (!props.open) return null;
  return createPortal(<MenuRoot {...props} />, document.body);
}

function MenuRoot({ anchorRef, children, label, onClose, placement = "bottom-start" }: MenuProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus(anchorRef);
  useDismiss(true, surfaceRef, anchorRef, onClose);
  return (
    <MenuSurface
      anchorRef={anchorRef}
      closeAll={onClose}
      label={label}
      placement={placement}
      surfaceRef={surfaceRef}
    >
      {children}
    </MenuSurface>
  );
}
