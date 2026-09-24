import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useMenuContext } from "./menuContext";
import { MenuSurface } from "./MenuSurface";

export interface SubmenuProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Submenu({ children, icon, label }: SubmenuProps) {
  const parent = useMenuContext();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const open = parent.openSubmenuId === id;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!open || trigger === null) return;
    return () => {
      if (!trigger.isConnected) return;
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      trigger.focus();
    };
  }, [open]);

  const close = (): void => {
    parent.openSubmenu(null);
    triggerRef.current?.focus();
  };
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    parent.openSubmenu(id);
  };
  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="cv-menu__item"
        data-cv-menu={parent.menuId}
        onClick={() => parent.openSubmenu(id)}
        onKeyDown={handleTriggerKeyDown}
        onPointerEnter={() => parent.openSubmenu(id)}
        ref={triggerRef}
        role="menuitem"
        tabIndex={-1}
        type="button"
      >
        {icon === undefined ? null : (
          <span aria-hidden="true" className="cv-menu__icon">
            {icon}
          </span>
        )}
        <span className="cv-menu__text">{label}</span>
        <span aria-hidden="true" className="cv-menu__end">
          <ChevronRight size={14} />
        </span>
      </button>
      {open ? (
        <MenuSurface
          anchorRef={triggerRef}
          closeAll={parent.closeAll}
          label={label}
          onKeyDown={handleSurfaceKeyDown}
          placement="right-start"
          surfaceRef={surfaceRef}
        >
          {children}
        </MenuSurface>
      ) : null}
    </>
  );
}
