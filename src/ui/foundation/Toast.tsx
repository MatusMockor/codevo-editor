import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useState, type FocusEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useAutoDismiss } from "./useAutoDismiss";
import "./status.css";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  readonly label: string;
  onSelect(): void;
}

export interface ToastProps {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
  readonly durationMs?: number;
  onDismiss(): void;
}

const TONE_ICONS: Readonly<Record<ToastTone, ReactNode>> = {
  info: <Info size={14} />,
  success: <Check size={14} />,
  error: <TriangleAlert size={14} />,
};

export function Toast({
  action,
  durationMs = 4000,
  message,
  onDismiss,
  tone = "info",
}: ToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useAutoDismiss(durationMs, hovered || focused, onDismiss);
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };

  return (
    <div
      className={`cv-toast cv-toast--${tone}`}
      onBlur={handleBlur}
      onFocus={() => setFocused(true)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      role={tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="cv-toast__icon">
        {TONE_ICONS[tone]}
      </span>
      <span className="cv-toast__message">{message}</span>
      {action === undefined ? null : (
        <Button onClick={action.onSelect} size="sm" variant="ghost">
          {action.label}
        </Button>
      )}
      <IconButton icon={<X size={14} />} label="Dismiss" onClick={onDismiss} size="xs" />
    </div>
  );
}

export interface ToastViewportProps {
  readonly children: ReactNode;
}

export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div aria-label="Notifications" className="cv-toast-viewport" role="region">
      {children}
    </div>
  );
}
