import type { KeyboardEvent } from "react";
import type { DebugExceptionPauseMode } from "../../domain/debug";
import {
  debugExceptionRows,
  nextExceptionPauseMode,
  type DebugExceptionRow,
} from "../../domain/debugExceptionRows";

export interface DebugExceptionRowsProps {
  readonly mode: DebugExceptionPauseMode;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  onChange(mode: DebugExceptionPauseMode): void;
}

export function DebugExceptionRows({
  disabled,
  error,
  mode,
  onChange,
  pending,
}: DebugExceptionRowsProps) {
  const toggle = (row: DebugExceptionRow): void => {
    if (disabled) return;
    onChange(nextExceptionPauseMode(mode, row.id));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: DebugExceptionRow): void => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    toggle(row);
  };
  return (
    <div aria-busy={pending || undefined} className="cv-dside__exceptions" role="group">
      {debugExceptionRows(mode).map((row) => (
        <div
          aria-checked={row.checked}
          aria-disabled={disabled || undefined}
          aria-label={row.label}
          className="cv-dside__bp"
          data-implied={row.implied ? "true" : undefined}
          key={row.id}
          onClick={() => toggle(row)}
          onKeyDown={(event) => handleKeyDown(event, row)}
          role="checkbox"
          tabIndex={0}
        >
          <i
            aria-hidden="true"
            className={row.checked ? "cv-dside__dot" : "cv-dside__dot cv-dside__dot--off"}
          />
          {row.label}
        </div>
      ))}
      {error ? (
        <span className="cv-debug__stderr" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
