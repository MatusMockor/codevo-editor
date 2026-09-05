import type { ReactNode, Ref } from "react";

export type SettingsButtonVariant = "primary" | "outline" | "ghost" | "ghostMuted";
export type SettingsButtonSize = "micro" | "xsq" | "compact" | "sm";

export interface SettingsButtonProps {
  readonly busy?: boolean;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly label?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly size?: SettingsButtonSize;
  readonly title?: string;
  readonly variant?: SettingsButtonVariant;
  onClick(): void;
}

export function SettingsButton({
  busy = false,
  children,
  disabled = false,
  expanded,
  label,
  onClick,
  ref,
  size = "compact",
  title,
  variant = "ghost",
}: SettingsButtonProps) {
  return (
    <button
      aria-busy={busy || undefined}
      aria-expanded={expanded}
      aria-label={label}
      className={`settings-btn settings-btn--${variant} settings-btn--${size}`}
      disabled={disabled}
      onClick={onClick}
      ref={ref}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
