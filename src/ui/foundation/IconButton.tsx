import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./classNames";
import "./buttons.css";

export type IconButtonSize = "xs" | "sm" | "round";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "aria-pressed" | "children"
> {
  readonly label: string;
  readonly icon: ReactNode;
  readonly size?: IconButtonSize;
  readonly pressed?: boolean;
}

export function IconButton({
  className,
  icon,
  label,
  pressed,
  size = "sm",
  title,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      aria-pressed={pressed}
      className={cx("cv-icon-button", `cv-icon-button--${size}`, className)}
      title={title ?? label}
      type={type}
    >
      <span aria-hidden="true" className="cv-icon-button__glyph">
        {icon}
      </span>
    </button>
  );
}
