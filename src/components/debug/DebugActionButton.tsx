import type { ReactNode } from "react";

export function DebugActionButton({
  busy,
  children,
  disabled,
  label,
  onClick,
  pressed,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick(): void;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <button
      aria-busy={busy || undefined}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="cv-debug__action"
      title={title ?? label}
      type="button"
    >
      {children}
    </button>
  );
}
