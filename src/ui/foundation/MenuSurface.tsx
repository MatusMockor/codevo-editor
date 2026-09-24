import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { MenuContext } from "./menuContext";
import { focusMenuItem, menuItems } from "./menuItems";
import type { PopoverPlacement } from "./popoverPosition";
import { usePopoverPosition } from "./usePopoverPosition";
import "./overlays.css";

export interface MenuSurfaceProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly placement: PopoverPlacement;
  readonly label: string;
  readonly children: ReactNode;
  closeAll(): void;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
}

export function MenuSurface({
  anchorRef,
  children,
  closeAll,
  label,
  onKeyDown,
  placement,
  surfaceRef,
}: MenuSurfaceProps) {
  const menuId = useId();
  const [openSubmenuId, openSubmenu] = useState<string | null>(null);
  const position = usePopoverPosition(anchorRef, surfaceRef, placement);
  const context = useMemo(
    () => ({ menuId, openSubmenuId, openSubmenu, closeAll }),
    [closeAll, menuId, openSubmenuId],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    menuItems(surface, menuId)[0]?.focus();
  }, [menuId, surfaceRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAll();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeAll();
      return;
    }
    const surface = surfaceRef.current;
    if (surface === null) return;
    if (!focusMenuItem(surface, menuId, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <MenuContext.Provider value={context}>
      <div
        aria-label={label}
        className="cv-menu"
        data-placement={position.placement}
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="menu"
        style={{ left: position.left, top: position.top }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}
