import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./classNames";
import "./buttons.css";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Button({
  children,
  className,
  icon,
  size = "md",
  type = "button",
  variant = "default",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx("cv-button", `cv-button--${variant}`, `cv-button--${size}`, className)}
      type={type}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-button__icon">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
