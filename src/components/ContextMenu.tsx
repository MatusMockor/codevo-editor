import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  onSelect(): void;
}

export interface ContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuProps {
  readonly ariaLabel: string;
  readonly items: readonly ContextMenuItem[];
  readonly position: ContextMenuPosition;
  onClose(reason: "cancel" | "select"): void;
}

const VIEWPORT_MARGIN = 8;

export function ContextMenu({ ariaLabel, items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [clampedPosition, setClampedPosition] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    setClampedPosition({
      x: clamp(position.x, VIEWPORT_MARGIN, window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN),
      y: clamp(
        position.y,
        VIEWPORT_MARGIN,
        window.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN,
      ),
    });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [items, position]);

  useEffect(() => {
    const close = () => onClose("cancel");
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose("cancel");
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const menuItems = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + menuItems.length) % menuItems.length;
    menuItems[nextIndex]?.focus();
  };

  return createPortal(
    <div
      aria-label={ariaLabel}
      className="context-menu"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: clampedPosition.x, top: clampedPosition.y }}
    >
      {items.map((item) => (
        <button
          className="context-menu-item"
          key={item.id}
          onClick={() => {
            onClose("select");
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}
