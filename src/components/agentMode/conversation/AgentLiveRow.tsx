import type { ReactNode } from "react";
import { AlertTriangle, Brain, Users } from "lucide-react";
import { cx } from "../../../ui/foundation/classNames";

export type AgentLiveRowTone = "thinking" | "working" | "agents" | "approval" | "input";

export interface AgentLiveRowProps {
  readonly tone: AgentLiveRowTone;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly activateLabel?: string;
  readonly onActivate?: () => void;
}

export function AgentLiveRow({
  activateLabel,
  className,
  icon,
  label,
  onActivate,
  tone,
}: AgentLiveRowProps) {
  const classes = cx(
    "cv-live-row",
    livePulse(tone) && "cv-live-row--pulse",
    liveWarn(tone) && "cv-live-row--warn",
    className,
  );
  const content = (
    <>
      <span aria-hidden="true" className="cv-live-row__icon">
        {icon ?? <LiveRowIcon tone={tone} />}
      </span>
      <span className="cv-live-row__label">{label}</span>
    </>
  );
  if (onActivate === undefined) {
    return (
      <div aria-live="polite" className={classes} role="status">
        {content}
      </div>
    );
  }
  return (
    <div className={classes}>
      <button
        aria-label={activateLabel ?? label}
        className="cv-live-row__action"
        onClick={onActivate}
        type="button"
      >
        {content}
      </button>
    </div>
  );
}

function livePulse(tone: AgentLiveRowTone): boolean {
  switch (tone) {
    case "thinking":
    case "working":
    case "agents":
      return true;
    case "approval":
    case "input":
      return false;
    default:
      return unsupportedTone(tone);
  }
}

function liveWarn(tone: AgentLiveRowTone): boolean {
  return tone === "approval" || tone === "input";
}

function LiveRowIcon({ tone }: { readonly tone: AgentLiveRowTone }) {
  switch (tone) {
    case "thinking":
    case "working":
      return <Brain size={16} strokeWidth={1.5} />;
    case "agents":
      return <Users size={16} strokeWidth={1.5} />;
    case "approval":
    case "input":
      return <AlertTriangle size={16} strokeWidth={1.5} />;
    default:
      return unsupportedTone(tone);
  }
}

function unsupportedTone(tone: never): never {
  throw new TypeError(`Unsupported live row tone: ${String(tone)}.`);
}
