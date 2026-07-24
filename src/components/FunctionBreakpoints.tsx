import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FunctionBreakpoint } from "../domain/debug";
import { functionBreakpointNameError } from "../domain/debugFunctionBreakpoints";

export interface FunctionBreakpointsProps {
  readonly breakpoints: readonly FunctionBreakpoint[];
  onAdd(functionName: string): void;
  onRemove(id: string): void;
  onSetEnabled(id: string, enabled: boolean): void;
}

export function FunctionBreakpoints({
  breakpoints,
  onAdd,
  onRemove,
  onSetEnabled,
}: FunctionBreakpointsProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      <strong style={styles.title}>Function Breakpoints</strong>
      {breakpoints.map((breakpoint) => (
        <div key={breakpoint.id} style={styles.row}>
          <input
            aria-label={`Enable function breakpoint ${breakpoint.functionName}`}
            checked={breakpoint.enabled}
            onChange={(event) => onSetEnabled(breakpoint.id, event.target.checked)}
            type="checkbox"
          />
          <span
            aria-label={
              breakpoint.verified === false
                ? `Unverified function breakpoint ${breakpoint.functionName} - function not resolved yet`
                : `Verified function breakpoint ${breakpoint.functionName}`
            }
            role="img"
            style={{
              ...styles.indicator,
              ...(breakpoint.verified === false
                ? styles.indicatorUnverified
                : styles.indicatorVerified),
            }}
            title={
              breakpoint.verified === false
                ? "Unverified - function not resolved yet"
                : "Verified function breakpoint"
            }
          />
          <span style={styles.name}>{breakpoint.functionName}</span>
          <button
            aria-label={`Remove function breakpoint ${breakpoint.functionName}`}
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
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder="Function name"
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
