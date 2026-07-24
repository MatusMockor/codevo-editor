import { Play, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";

export const MAX_NODE_DEBUG_LAUNCH_CHOICES = 64;

export type NodeDebugLaunchTargetKind = "attach" | "compound" | "script" | "test" | "npm";

export interface NodeDebugLaunchChoice {
  readonly compoundMemberCount?: number;
  readonly default: boolean;
  readonly hasPreLaunchTask?: boolean;
  readonly name: string;
  readonly preLaunchTask?: string;
  readonly source?: "codevo" | "vscode";
  readonly runnable?: boolean;
  readonly targetKind: NodeDebugLaunchTargetKind;
}

export type NodeDebugLaunchSelectorState = "idle" | "loading" | "ready" | "empty" | "error";

export interface NodeDebugLaunchSelectorProps {
  readonly busy: boolean;
  readonly choices: readonly NodeDebugLaunchChoice[];
  readonly error: string | null;
  readonly mutationPending: boolean;
  readonly onLoad: () => void;
  readonly onRefresh: () => void;
  readonly onSelect: (name: string) => void;
  readonly onStartSelected: () => void;
  readonly selectedName: string | null;
  readonly sessionActive: boolean;
  readonly state: NodeDebugLaunchSelectorState;
  readonly workspaceTrusted: boolean;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    padding: 2,
  },
  error: {
    color: "var(--status-error, #ef4444)",
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selector: { maxWidth: 220, minWidth: 120 },
  status: { color: "var(--text-muted)" },
  wrapper: { alignItems: "center", display: "inline-flex", gap: 4, minWidth: 0 },
};

export function NodeDebugLaunchSelector({
  busy,
  choices,
  error,
  mutationPending,
  onLoad,
  onRefresh,
  onSelect,
  onStartSelected,
  selectedName,
  sessionActive,
  state,
  workspaceTrusted,
}: NodeDebugLaunchSelectorProps) {
  const visibleChoices = choices.slice(0, MAX_NODE_DEBUG_LAUNCH_CHOICES);
  const selectedChoice = visibleChoices.some(({ name }) => name === selectedName);
  const guarded =
    !workspaceTrusted || sessionActive || mutationPending || busy || state === "loading";
  const canStart = state === "ready" && selectedChoice && !guarded;
  const canReload = !guarded;

  return (
    <div
      aria-busy={state === "loading"}
      aria-label="Node launch configuration controls"
      role="group"
      style={styles.wrapper}
    >
      <select
        aria-label="Node launch configuration"
        disabled={guarded || state !== "ready"}
        onChange={(event) => onSelect(event.target.value)}
        style={styles.selector}
        value={selectedChoice ? (selectedName ?? "") : ""}
      >
        {!selectedChoice ? <option value="">{placeholderForState(state)}</option> : null}
        {visibleChoices.map((choice) => (
          <option disabled={choice.runnable === false} key={choice.name} value={choice.name}>
            {choiceLabel(choice)}
          </option>
        ))}
      </select>
      <button
        aria-label="Start selected Node launch configuration"
        disabled={!canStart}
        onClick={onStartSelected}
        style={styles.action}
        title="Start selected Node launch configuration"
        type="button"
      >
        <Play aria-hidden="true" size={14} />
      </button>
      <button
        aria-label={
          state === "idle"
            ? "Load Node launch configurations"
            : "Refresh Node launch configurations"
        }
        disabled={!canReload}
        onClick={state === "idle" ? onLoad : onRefresh}
        style={styles.action}
        title={
          state === "idle"
            ? "Load Node launch configurations"
            : "Refresh Node launch configurations"
        }
        type="button"
      >
        <RefreshCw aria-hidden="true" size={14} />
      </button>
      {state === "loading" ? (
        <span role="status" style={styles.status}>
          Loading Node launch configurations…
        </span>
      ) : null}
      {state === "empty" ? (
        <span role="status" style={styles.status}>
          No Node launch configurations
        </span>
      ) : null}
      {state === "error" ? (
        <span role="alert" style={styles.error} title={error ?? undefined}>
          {error || "Node launch configurations are unavailable."}
        </span>
      ) : null}
    </div>
  );
}

function choiceLabel(choice: NodeDebugLaunchChoice): string {
  if (choice.targetKind === "compound") {
    return `${choice.name} — compound (${choice.compoundMemberCount ?? 0})`;
  }
  const target =
    choice.targetKind === "npm"
      ? "npm"
      : choice.targetKind === "test"
        ? "test"
        : choice.targetKind === "attach"
          ? "attach"
          : "script";
  return `${choice.name}${choice.default ? " (Default)" : ""} — ${target}`;
}

function placeholderForState(state: NodeDebugLaunchSelectorState): string {
  switch (state) {
    case "idle":
      return "Load configurations";
    case "loading":
      return "Loading…";
    case "empty":
      return "No configurations";
    case "error":
      return "Configurations unavailable";
    case "ready":
      return "Select a configuration";
  }
}
