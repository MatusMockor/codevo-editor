import type { NodeRunWithoutDebuggingState } from "./useNodeRunWithoutDebugging";

export type NodeRunStatusPhase =
  "resolving" | "waiting-for-terminal" | "starting" | "running" | "stopping";

/**
 * Deliberately contains no run owner, launch target, arguments, or environment.
 * This is the only Node-run shape that should cross into presentation components.
 */
export interface NodeRunStatusPresentation {
  readonly canStop: boolean;
  readonly label: string;
  readonly phase: NodeRunStatusPhase;
  readonly stopLabel: string;
}

export function presentOptionalNodeRunWithoutDebugging(
  state: NodeRunWithoutDebuggingState | null,
): NodeRunStatusPresentation | null {
  return state ? presentNodeRunWithoutDebugging(state) : null;
}

export function presentNodeRunWithoutDebugging(
  state: NodeRunWithoutDebuggingState,
): NodeRunStatusPresentation | null {
  switch (state.kind) {
    case "idle":
    case "exited":
    case "failed":
      return null;
    case "resolving":
      return stoppableStatus("resolving", "Node: Resolving");
    case "waiting-for-terminal":
      return stoppableStatus("waiting-for-terminal", "Node: Waiting for terminal");
    case "starting":
      return stoppableStatus("starting", "Node: Starting");
    case "running":
      return stoppableStatus("running", "Node: Running");
    case "stopping":
      return {
        canStop: state.retryable,
        label: state.retryable ? "Node: Stop failed" : "Node: Stopping",
        phase: "stopping",
        stopLabel: state.retryable ? "Retry stopping Node run" : "Node run is stopping",
      };
  }
}

function stoppableStatus(
  phase: Exclude<NodeRunStatusPhase, "stopping">,
  label: string,
): NodeRunStatusPresentation {
  return {
    canStop: true,
    label,
    phase,
    stopLabel: `Stop Node run — ${label.slice("Node: ".length)}`,
  };
}
