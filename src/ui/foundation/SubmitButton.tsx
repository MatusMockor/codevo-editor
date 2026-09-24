import { cx } from "./classNames";
import "./buttons.css";

export type SubmitButtonMode = "send" | "stop" | "update";

export interface SubmitButtonProps {
  readonly mode: SubmitButtonMode;
  readonly disabled?: boolean;
  readonly label?: string;
  onClick?(): void;
}

const LABELS: Readonly<Record<SubmitButtonMode, string>> = {
  send: "Send message",
  stop: "Stop generation",
  update: "Update queued message",
};

export function SubmitButton({ disabled = false, label, mode, onClick }: SubmitButtonProps) {
  const accessibleLabel = label ?? LABELS[mode];
  const stopping = mode === "stop";
  return (
    <button
      aria-label={accessibleLabel}
      className={cx("cv-submit", stopping && "cv-submit--stop")}
      disabled={disabled}
      onClick={onClick}
      title={accessibleLabel}
      type={stopping ? "button" : "submit"}
    >
      {stopping ? <StopGlyph /> : <ArrowGlyph />}
    </button>
  );
}

function ArrowGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 16 16"
      width="16"
    >
      <path d="M8 3L8 13M8 3L4 7M8 3L12 7" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 12 12" width="12">
      <rect height="8" rx="1.5" width="8" x="2" y="2" />
    </svg>
  );
}
