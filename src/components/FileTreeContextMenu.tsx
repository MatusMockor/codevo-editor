import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

export interface FileTreeContextMenuItem {
  label: string;
  run(): void;
}

interface FileTreeContextMenuProps {
  items: FileTreeContextMenuItem[];
  position: { x: number; y: number };
  onClose(): void;
}

const VIEWPORT_MARGIN = 8;

export function FileTreeContextMenu({
  items,
  position,
  onClose,
}: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [clampedPosition, setClampedPosition] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    setClampedPosition({
      x: clamp(
        position.x,
        VIEWPORT_MARGIN,
        window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN,
      ),
      y: clamp(
        position.y,
        VIEWPORT_MARGIN,
        window.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN,
      ),
    });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [items, position]);

  useEffect(() => {
    const close = () => onClose();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
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
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    ];
    const currentIndex = menuItems.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + menuItems.length) % menuItems.length;
    menuItems[nextIndex]?.focus();
  };

  return createPortal(
    <div
      aria-label="File actions"
      className="status-bar-menu"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: clampedPosition.x, top: clampedPosition.y }}
    >
      {items.map((item) => (
        <button
          className="status-bar-menu-item"
          key={item.label}
          onClick={() => {
            onClose();
            item.run();
          }}
          role="menuitem"
          style={menuItemStyle}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

const menuItemStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  display: "block",
  font: "inherit",
  textAlign: "left",
  width: "100%",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}
