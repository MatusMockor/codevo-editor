import type { RemoteRunnerEvent, RemoteRunnerEventPage } from "../domain/remoteRunner";
import type { RemoteReplayGap, RemoteReplayWindow } from "./remoteAgentReplayWindow";

export type RemoteReplayStdoutBoundary = { readonly kind: "pending" };

export function backwardWindowFraming(
  known: RemoteReplayGap | undefined,
  merged: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
  before: number | null,
): {
  readonly gap?: RemoteReplayGap;
  readonly boundary?: { readonly stdoutBoundary: RemoteReplayStdoutBoundary };
} {
  if (remoteWindowEvictedStdout(merged, window)) return { gap: window.gap };
  if (known !== undefined && before !== null && before <= known.throughSequence)
    return { gap: window.gap };
  if (before === null) {
    if (window.droppedOutputFrom === undefined) return { gap: known };
    return {
      gap: window.gap && {
        ...window.gap,
        startsAtLineBoundary: known?.startsAtLineBoundary ?? true,
      },
    };
  }
  return { gap: window.gap, boundary: { stdoutBoundary: { kind: "pending" } } };
}

export function remoteWindowEvictedStdout(
  events: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
): boolean {
  const oldest =
    window.events.find((event) => event.type !== "task.input")?.sequence ?? Number.MAX_SAFE_INTEGER;
  return events.some(
    (event) =>
      event.type === "task.output" && event.channel !== "stderr" && event.sequence < oldest,
  );
}

export function scannedStdoutBoundary(
  boundary: RemoteReplayStdoutBoundary | undefined,
  gap: RemoteReplayGap | undefined,
  page: RemoteRunnerEventPage,
): {
  readonly gap?: RemoteReplayGap;
  readonly boundary?: { readonly stdoutBoundary: RemoteReplayStdoutBoundary };
} {
  if (boundary === undefined) return { gap };
  const removed = page.outputTruncatedBeforeSequence ?? 0;
  const outputs = page.items.filter(
    (event) => event.type === "task.output" && event.sequence > removed,
  );
  const newestOutput = outputs[outputs.length - 1];
  const scannedGap =
    newestOutput && newestOutput.sequence > (gap?.throughSequence ?? 0)
      ? { throughSequence: newestOutput.sequence, startsAtLineBoundary: false }
      : gap;
  const stdout = outputs.filter((event) => event.channel !== "stderr");
  const latest = stdout[stdout.length - 1];
  if (latest !== undefined)
    return {
      gap: {
        throughSequence: Math.max(scannedGap?.throughSequence ?? 0, latest.sequence),
        startsAtLineBoundary: latest.text?.endsWith("\n") ?? true,
      },
    };
  if (page.nextCursor !== null && page.nextCursor > removed)
    return { gap: scannedGap, boundary: { stdoutBoundary: boundary } };
  return {
    gap: scannedGap && {
      ...scannedGap,
      startsAtLineBoundary: removed === 0 || page.outputStartsAtLineBoundary === true,
    },
  };
}
