import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

export type ToastTemplatePreset = "info" | "warning" | "error" | "success" | "loading";

export type ToastNotificationActionTone = "primary" | "secondary" | "ghost";

export interface ToastNotificationAction {
  readonly id: string;
  readonly label: string;
  readonly tone?: ToastNotificationActionTone;
  readonly placement?: "leading";
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly isBusy?: boolean;
  readonly onClick: () => void;
}

export interface ToastNotificationProps {
  readonly actions?: readonly ToastNotificationAction[];
  readonly className?: string;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly meta?: readonly ReactNode[];
  readonly onClose?: () => void;
  readonly template?: ToastTemplatePreset;
  readonly title?: string;
}

interface ToastTemplate {
  readonly icon: React.ComponentType<{ size?: number; className?: string }>;
  readonly role: "status" | "alert";
  readonly title: string;
}

const TOAST_TEMPLATES: Record<ToastTemplatePreset, ToastTemplate> = {
  error: { icon: CircleX, role: "alert", title: "Error" },
  info: { icon: Info, role: "status", title: "Info" },
  loading: { icon: LoaderCircle, role: "status", title: "Working" },
  success: { icon: CircleCheck, role: "status", title: "Success" },
  warning: { icon: CircleAlert, role: "status", title: "Warning" },
};

export function ToastNotification({
  actions,
  className = "",
  closeLabel = "Dismiss notification",
  description,
  icon,
  meta,
  onClose,
  template = "info",
  title,
}: ToastNotificationProps) {
  const definition = TOAST_TEMPLATES[template];
  const Icon = definition.icon;
  const visibleMeta = meta?.filter((entry) => entry !== null && entry !== undefined) ?? [];

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (!onClose) return;
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      className={["toast-notification", `toast-notification--${template}`, className]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handleKeyDown}
      role={definition.role}
    >
      {onClose ? (
        <button
          aria-label={closeLabel}
          className="toast-notification-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={12} strokeWidth={2.25} />
        </button>
      ) : null}
      <div className="toast-notification__row">
        <span aria-hidden="true" className="toast-notification__icon">
          {icon ?? <Icon size={16} />}
        </span>
        <div className="toast-notification__text">
          <p className="toast-notification__title">{title || definition.title}</p>
          {description ? <p className="toast-notification-message">{description}</p> : null}
          {visibleMeta.length > 0 ? (
            <ul className="toast-notification__meta">
              {visibleMeta.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {actions && actions.length > 0 ? (
        <div className="toast-notification-actions">
          {actions.map((action) => (
            <button
              aria-busy={action.isBusy || false}
              className={[
                "toast-notification-action",
                `toast-notification-action--${action.tone ?? "secondary"}`,
                action.placement === "leading" ? "toast-notification-action--leading" : "",
                action.isBusy ? "toast-notification-action--busy" : "",
                action.disabled ? "toast-notification-action--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={action.disabled}
              key={action.id}
              onClick={action.onClick}
              type="button"
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

export type ToastMarkBadge = "update" | "check" | "manual";

export function ToastMark({
  badge,
  children,
}: {
  readonly badge?: ToastMarkBadge;
  readonly children: ReactNode;
}) {
  return (
    <span className="toast-notification__mark">
      {children}
      {badge ? (
        <span className={`toast-notification__badge toast-notification__badge--${badge}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            {badge === "check" ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <path d="M12 5v14" />
                <path d="m5 12 7 7 7-7" />
              </>
            )}
          </svg>
        </span>
      ) : null}
    </span>
  );
}
