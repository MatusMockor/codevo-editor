import type { RemoteRunnerEvent } from "../domain/remoteRunner";

export interface RemoteReplayGap {
  readonly throughSequence: number;
  readonly startsAtLineBoundary: boolean;
}
export interface RemoteReplayWindow {
  readonly events: readonly RemoteRunnerEvent[];
  readonly gap?: RemoteReplayGap;
  readonly truncated: boolean;
}

/** Evict oldest chunks without coupling the fetch cursor to the retained window. */
export function retainRemoteReplayWindow(
  events: readonly RemoteRunnerEvent[],
  maxBytes: number,
  previousGap?: RemoteReplayGap,
): RemoteReplayWindow {
  // Accepted inputs have their own bounded budget and survive output eviction.
  const inputs = events.filter((event) => event.type === "task.input");
  const retainedInputs = inputs.slice(-32);
  const outputEvents = events.filter((event) => event.type !== "task.input");
  let bytes = outputEvents.reduce((sum, event) => sum + (event.text?.length ?? 0) * 2, 0);
  let start = 0;
  let gap = previousGap;
  while (start < outputEvents.length && (outputEvents.length - start > 1100 || bytes > maxBytes)) {
    const event = outputEvents[start++]!;
    bytes -= (event.text?.length ?? 0) * 2;
    if (event.type === "task.output" && event.sequence > (gap?.throughSequence ?? 0)) {
      gap = {
        throughSequence: event.sequence,
        startsAtLineBoundary:
          event.channel === "stderr"
            ? (gap?.startsAtLineBoundary ?? true)
            : (event.text?.endsWith("\n") ?? true),
      };
    }
  }
  return {
    events:
      start === 0 && inputs.length <= 32
        ? events
        : [...retainedInputs, ...outputEvents.slice(start)].sort((a, b) => a.sequence - b.sequence),
    gap,
    truncated: start > 0 || inputs.length > 32,
  };
}
