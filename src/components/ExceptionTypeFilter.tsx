import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DebugExceptionTypeFilter } from "../domain/debug";
import {
  MAX_DEBUG_EXCEPTION_TYPE_FILTERS,
  debugExceptionTypeNameError,
} from "../domain/debugExceptionTypeFilter";

export interface ExceptionTypeFilterProps {
  readonly disabled: boolean;
  readonly filter: DebugExceptionTypeFilter;
  onChange(filter: DebugExceptionTypeFilter): void;
}

export function ExceptionTypeFilter({ disabled, filter, onChange }: ExceptionTypeFilterProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = filter.length >= MAX_DEBUG_EXCEPTION_TYPE_FILTERS;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setValue("");
      setError(null);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const nextError = debugExceptionTypeNameError(value);
    setError(nextError);
    if (nextError || full) return;
    if (filter.includes(value)) {
      setError("Exception type is already included.");
      return;
    }
    onChange([...filter, value]);
    setValue("");
  };

  return (
    <section aria-label="Exception Type Filter" style={styles.section}>
      <strong style={styles.title}>Exception Type Filter</strong>
      {filter.map((name) => (
        <div key={name} style={styles.row}>
          <span style={styles.name}>{name}</span>
          <button
            aria-label={`Remove exception type ${name}`}
            disabled={disabled}
            onClick={() => onChange(filter.filter((entry) => entry !== name))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      {filter.length === 0 ? <span style={styles.status}>Off</span> : null}
      <input
        aria-label="Exception type"
        disabled={disabled || full}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder="Error constructor name"
        value={value}
      />
      {error ? (
        <span role="alert" style={styles.error}>
          {error}
        </span>
      ) : null}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  error: { color: "var(--text-danger, #f87171)", fontSize: 11 },
  name: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  row: { alignItems: "center", display: "flex", gap: 6 },
  section: { display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px" },
  status: { color: "var(--text-muted)", fontSize: 11 },
  title: { fontSize: 11 },
};
