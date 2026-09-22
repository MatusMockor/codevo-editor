import "./agentThreadOrganization.css";
import { useLayoutEffect, useRef, useState } from "react";

export function AgentThreadSnoozePicker({
  onSnooze,
}: {
  readonly onSnooze: (until: number) => void;
}) {
  const first = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    first.current?.focus();
  }, []);
  const [value, setValue] = useState("");
  const until = new Date(value).getTime();
  const valid = Number.isFinite(until) && until > Date.now();
  return (
    <div className="agent-thread-snooze">
      <button
        ref={first}
        className="agent-menu__item"
        role="menuitem"
        type="button"
        onClick={() => onSnooze(Date.now() + 3_600_000)}
      >
        For one hour
      </button>
      <button
        className="agent-menu__item"
        role="menuitem"
        type="button"
        onClick={() => onSnooze(Date.now() + 86_400_000)}
      >
        For one day
      </button>
      <label>
        Choose date and time
        <input
          aria-label="Snooze until"
          type="datetime-local"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button
        className="agent-menu__item"
        role="menuitem"
        disabled={!valid}
        type="button"
        onClick={() => {
          if (valid) onSnooze(until);
        }}
      >
        Snooze until selected time
      </button>
    </div>
  );
}
