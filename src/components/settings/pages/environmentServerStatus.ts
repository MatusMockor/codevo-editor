export type EnvironmentServerAttemptPhase = "idle" | "connecting" | "failed";

export type EnvironmentServerStatusKind = "connected" | "disconnected" | "connecting" | "error";

export interface EnvironmentServerStatusView {
  readonly kind: EnvironmentServerStatusKind;
  readonly label: string;
}

const FAILURE_REASON_MAX_CHARS = 160;

export function environmentServerStatus(
  connected: boolean,
  phase: EnvironmentServerAttemptPhase,
  failureReason: string | null,
): EnvironmentServerStatusView {
  switch (phase) {
    case "connecting":
      return { kind: "connecting", label: "Connecting…" };
    case "failed":
      return connected
        ? { kind: "connected", label: "Connected" }
        : { kind: "error", label: failureLabel(failureReason) };
    case "idle":
      return connected
        ? { kind: "connected", label: "Connected" }
        : { kind: "disconnected", label: "Disconnected" };
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function failureLabel(reason: string | null): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") return "Could not connect";
  const bounded = Array.from(trimmed);
  if (bounded.length <= FAILURE_REASON_MAX_CHARS) return `Could not connect - ${trimmed}`;
  return `Could not connect - ${bounded.slice(0, FAILURE_REASON_MAX_CHARS).join("")}…`;
}
