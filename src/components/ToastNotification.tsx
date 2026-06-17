import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type ToastTemplateName = "info" | "warning" | "error" | "success";

import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
} from "lucide-react";

interface ToastTemplate {
  color: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
}

export interface ToastNotificationAction {
  id: string;
  label: string;
  tone?: "primary" | "secondary";
  disabled?: boolean;
  isBusy?: boolean;
  onClick: () => void;
}

export type ToastTemplatePreset = keyof typeof TOAST_TEMPLATES;

export interface ToastNotificationProps {
  actions?: ToastNotificationAction[];
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  style?: CSSProperties;
  template?: ToastTemplatePreset;
  templateOverrides?: Partial<ToastTemplate>;
  title?: string;
}

export const TOAST_TEMPLATES: Record<ToastTemplateName, ToastTemplate> = {
  error: {
    color: "var(--color-error)",
    icon: CircleX,
    title: "Error",
  },
  info: {
    color: "var(--color-accent)",
    icon: CircleHelp,
    title: "Info",
  },
  success: {
    color: "var(--color-success)",
    icon: CircleCheck,
    title: "Success",
  },
  warning: {
    color: "var(--color-warning)",
    icon: CircleAlert,
    title: "Warning",
  },
};

export const toastActionTemplates = {
  dismiss: (onClose: () => void): ToastNotificationAction => ({
    id: "dismiss",
    label: "Dismiss",
    tone: "secondary",
    onClick: onClose,
  }),
} as const;

export function ToastNotification({
  actions,
  className = "",
  description,
  icon,
  onClose,
  style,
  template = "info",
  templateOverrides = {},
  title,
}: ToastNotificationProps) {
  const templateDefinition = TOAST_TEMPLATES[template];
  const resolvedTemplate = {
    ...templateDefinition,
    ...templateOverrides,
  };
  const Icon = resolvedTemplate.icon;
  const templateColor = resolvedTemplate.color;

  const styleProperties: CSSProperties = {
    "--toast-color": templateColor,
    ...style,
  } as CSSProperties;

  return (
    <aside
      aria-live="polite"
      className={[
        "toast-notification",
        `toast-notification--${template}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={styleProperties}
    >
      <button
        aria-label="Dismiss notification"
        className="toast-notification-close"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={15} />
      </button>
      <header className="toast-notification-header">
        <span className="toast-notification-icon" aria-hidden="true">
          {icon ?? <Icon size={15} />}
        </span>
        <strong>{title || resolvedTemplate.title}</strong>
      </header>
      {description ? (
        <p className="toast-notification-message">{description}</p>
      ) : null}
      {actions && actions.length > 0 ? (
        <div className="toast-notification-actions">
          {actions.map((action) => (
              <button
                className={[
                  "toast-notification-action",
                  action.tone === "primary"
                    ? "toast-notification-action--primary"
                    : "toast-notification-action--secondary",
                  action.isBusy ? "toast-notification-action--busy" : "",
                  action.disabled ? "toast-notification-action--disabled" : "",
                ].join(" ")}
                key={action.id}
                disabled={action.disabled}
                aria-busy={action.isBusy || false}
                onClick={action.onClick}
                type="button"
              >
                {action.label}
              </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
