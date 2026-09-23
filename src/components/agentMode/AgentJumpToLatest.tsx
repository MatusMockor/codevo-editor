import { ArrowDown } from "lucide-react";

export function AgentJumpToLatest({
  visible,
  unseenActivity,
  onJump,
}: {
  readonly visible: boolean;
  readonly unseenActivity: boolean;
  readonly onJump: () => void;
}) {
  if (!visible) return null;
  const label = unseenActivity ? "New activity" : "Jump to latest";
  return (
    <div className="agent-jump-latest">
      <button
        aria-label={unseenActivity ? "Jump to latest: new activity below" : "Jump to latest"}
        className="agent-jump-latest__button"
        data-unseen={unseenActivity ? "true" : undefined}
        onClick={onJump}
        type="button"
      >
        {unseenActivity && <span aria-hidden="true" className="agent-jump-latest__dot" />}
        <ArrowDown aria-hidden="true" className="agent-jump-latest__icon" size={13} />
        {label}
      </button>
    </div>
  );
}
