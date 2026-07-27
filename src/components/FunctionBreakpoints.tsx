import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FunctionBreakpoint } from "../domain/debug";
import { functionBreakpointNameError } from "../domain/debugFunctionBreakpoints";

export interface FunctionBreakpointsProps {
  readonly breakpoints: readonly FunctionBreakpoint[];
  readonly disabled?: boolean;
  onAdd(functionName: string): void;
  onRemove(id: string): void;
  onSetEnabled(id: string, enabled: boolean): void;
}

export function FunctionBreakpoints({
  breakpoints,
  disabled = false,
  onAdd,
  onRemove,
  onSetEnabled,
}: FunctionBreakpointsProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setValue("");
      setError(null);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const nextError = functionBreakpointNameError(value);
    setError(nextError);
    if (nextError) return;
    onAdd(value);
    setValue("");
  };

  return (
    <section aria-label="Function Breakpoints" style={styles.section}>
      <div style={styles.header}>
        <strong style={styles.title}>Function Breakpoints</strong>
        <button
          aria-label="Add function breakpoint"
          disabled={disabled}
          onClick={() => inputRef.current?.focus()}
          style={styles.add}
          title="Add function breakpoint"
          type="button"
        >
          +
        </button>
      </div>
      {breakpoints.map((breakpoint) => (
        <div key={breakpoint.id} style={styles.row}>
          <input
            aria-label={`Enable function breakpoint ${breakpoint.functionName}`}
            checked={breakpoint.enabled}
            disabled={disabled}
            onChange={(event) => onSetEnabled(breakpoint.id, event.target.checked)}
            type="checkbox"
          />
          <span
            aria-label={verificationLabel(breakpoint)}
            data-status={verificationStatus(breakpoint)}
            role="img"
            style={{
              ...styles.indicator,
              ...(!breakpoint.enabled
                ? styles.indicatorDisabled
                : breakpoint.verified === true
                  ? styles.indicatorVerified
                  : breakpoint.verified === false
                    ? styles.indicatorUnverified
                    : styles.indicatorPending),
            }}
            title={verificationTitle(breakpoint)}
          />
          <span style={styles.name}>{breakpoint.functionName}</span>
          <button
            aria-label={`Remove function breakpoint ${breakpoint.functionName}`}
            disabled={disabled}
            onClick={() => onRemove(breakpoint.id)}
            style={styles.remove}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <input
        aria-label="Function name"
        aria-describedby="function-breakpoint-help"
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder="globalThis.handler"
        ref={inputRef}
        value={value}
      />
      <span id="function-breakpoint-help" style={styles.help}>
        Enter a global function name or dotted runtime path.
      </span>
      {error ? (
        <span role="alert" style={styles.error}>
          {error}
        </span>
      ) : null}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  add: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    color: "inherit",
    cursor: "pointer",
    lineHeight: 1,
    padding: "1px 5px",
  },
  error: { color: "var(--text-danger, #f87171)", fontSize: 11 },
  header: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
  },
  help: { color: "var(--text-muted)", fontSize: 10 },
  indicator: {
    borderRadius: "50%",
    boxSizing: "border-box",
    flex: "0 0 auto",
    height: 10,
    width: 10,
  },
  indicatorUnverified: {
    background: "transparent",
    border: "1.5px solid var(--color-text-muted)",
  },
  indicatorPending: {
    background: "transparent",
    border: "1.5px dashed var(--color-text-muted)",
  },
  indicatorDisabled: {
    background: "transparent",
    border: "1.5px solid var(--color-text-muted)",
    opacity: 0.55,
  },
  indicatorVerified: {
    background: "var(--color-error)",
    boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-error) 35%, transparent)",
  },
  name: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  remove: { fontSize: 11 },
  row: { alignItems: "center", display: "flex", gap: 6 },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  title: { fontSize: 11 },
};

function verificationStatus(
  breakpoint: FunctionBreakpoint,
): "disabled" | "pending" | "unverified" | "verified" {
  if (!breakpoint.enabled) return "disabled";
  if (breakpoint.verified === true) return "verified";
  if (breakpoint.verified === false) return "unverified";
  return "pending";
}

function verificationLabel(breakpoint: FunctionBreakpoint): string {
  switch (verificationStatus(breakpoint)) {
    case "disabled":
      return `Disabled function breakpoint ${breakpoint.functionName}`;
    case "verified":
      return `Verified function breakpoint ${breakpoint.functionName}`;
    case "unverified":
      return `Unverified function breakpoint ${breakpoint.functionName} - function not resolved yet`;
    case "pending":
      return `Pending function breakpoint ${breakpoint.functionName} - verification pending`;
  }
}

function verificationTitle(breakpoint: FunctionBreakpoint): string {
  switch (verificationStatus(breakpoint)) {
    case "disabled":
      return "Disabled function breakpoint";
    case "verified":
      return "Verified function breakpoint";
    case "unverified":
      return "Unverified - function not resolved yet";
    case "pending":
      return "Pending verification";
  }
}
