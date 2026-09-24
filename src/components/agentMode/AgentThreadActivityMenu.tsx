import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface AgentThreadActivityMenuPosition {
  readonly x: number;
  readonly y: number;
}

interface Props {
  readonly position: AgentThreadActivityMenuPosition;
  readonly visible: boolean;
  readonly disabled: boolean;
  onToggle(): void;
  onClose(restoreFocus: boolean): void;
}

export function AgentThreadActivityMenu({ position, visible, disabled, onToggle, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(position);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu === null) return;
    setPlaced({
      x: Math.max(8, Math.min(position.x, window.innerWidth - menu.offsetWidth - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - menu.offsetHeight - 8)),
    });
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [position]);
  useEffect(() => {
    const outside = (event: MouseEvent | FocusEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose(false);
    };
    const dismiss = () => onClose(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [onClose]);
  return createPortal(
    <div
      aria-label="Thread activity items"
      className="status-bar-menu"
      ref={ref}
      role="menu"
      style={{ left: placed.x, top: placed.y, minWidth: 0, maxWidth: "calc(100vw - 16px)" }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose(true);
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventDefault();
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
        }
      }}
    >
      <button
        aria-checked={visible}
        aria-disabled={disabled}
        title={disabled ? "Open a project to change thread activity." : undefined}
        className="context-menu-item"
        role="menuitemcheckbox"
        type="button"
        onClick={() => {
          if (disabled) return;
          onToggle();
          onClose(true);
        }}
      >
        <span aria-hidden="true" style={{ width: 22 }}>
          {visible ? "✓" : ""}
        </span>
        Threads needing attention
      </button>
    </div>,
    document.body,
  );
}
