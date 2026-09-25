import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useMenuContext } from "./menuContext";
import "./controls.css";
import "./overlays.css";

export interface MenuSwitchItemProps {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  onToggle(next: boolean): void;
}

export function MenuSwitchItem({
  checked,
  children,
  disabled = false,
  onToggle,
}: MenuSwitchItemProps) {
  const menu = useMenuContext();
  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!disabled) event.currentTarget.focus();
    menu.openSubmenu(null);
  };
  const toggle = (): void => {
    if (disabled) return;
    onToggle(!checked);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className="cv-menu__item"
      data-cv-menu={menu.menuId}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      role="menuitemcheckbox"
      tabIndex={-1}
      type="button"
    >
      <span className="cv-menu__text">{children}</span>
      <span aria-hidden="true" className="cv-menu__end">
        <span aria-checked={checked} className="cv-switch" role="presentation" />
      </span>
    </button>
  );
}
