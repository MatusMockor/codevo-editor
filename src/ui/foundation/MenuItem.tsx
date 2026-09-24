import { Check } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { cx } from "./classNames";
import { useMenuContext } from "./menuContext";
import "./overlays.css";

export type MenuItemTone = "default" | "danger";

export interface MenuItemProps {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly shortcut?: string;
  readonly tone?: MenuItemTone;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  onSelect(): void;
}

export function MenuItem({
  checked,
  children,
  disabled = false,
  icon,
  onSelect,
  shortcut,
  tone = "default",
}: MenuItemProps) {
  const menu = useMenuContext();
  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!disabled) event.currentTarget.focus();
    menu.openSubmenu(null);
  };
  const select = (): void => {
    if (disabled) return;
    onSelect();
    menu.closeAll();
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className={cx("cv-menu__item", tone === "danger" && "cv-menu__item--danger")}
      data-cv-menu={menu.menuId}
      onClick={select}
      onPointerEnter={handlePointerEnter}
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      tabIndex={-1}
      type="button"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-menu__icon">
          {icon}
        </span>
      )}
      <span className="cv-menu__text">{children}</span>
      {shortcut === undefined ? null : <span className="cv-menu__end">{shortcut}</span>}
      {checked === true ? (
        <span aria-hidden="true" className="cv-menu__check">
          <Check size={14} />
        </span>
      ) : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="cv-menu__separator" role="separator" />;
}

export interface MenuLabelProps {
  readonly children: ReactNode;
}

export function MenuLabel({ children }: MenuLabelProps) {
  return (
    <div className="cv-menu__label" role="presentation">
      {children}
    </div>
  );
}
