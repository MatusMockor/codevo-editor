import { Check } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { cx } from "./classNames";
import { useMenuContext } from "./menuContext";
import "./overlays.css";

export interface MenuRadioItemProps {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  onSelect(): void;
}

export function MenuRadioItem({
  checked,
  children,
  description,
  disabled = false,
  icon,
  onSelect,
}: MenuRadioItemProps) {
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
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className={cx("cv-menu__item", description !== undefined && "cv-menu__item--tall")}
      data-cv-menu={menu.menuId}
      onClick={select}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      role="menuitemradio"
      tabIndex={-1}
      type="button"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-menu__icon">
          {icon}
        </span>
      )}
      <span className="cv-menu__text">
        {children}
        {description === undefined ? null : (
          <span className="cv-menu__description">{description}</span>
        )}
      </span>
      {checked ? (
        <span aria-hidden="true" className="cv-menu__check">
          <Check size={14} />
        </span>
      ) : null}
    </button>
  );
}
