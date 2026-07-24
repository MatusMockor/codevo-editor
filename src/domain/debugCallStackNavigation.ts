import type { StackFrame } from "./debug";

export type DebugCallStackNavigationDirection = "top" | "bottom" | "up" | "down";

/** Selects from the adapter-provided call-stack order without mutating its snapshot. */
export function selectDebugCallStackNavigationTarget(
  frames: readonly StackFrame[],
  selectedFrameId: number | null,
  direction: DebugCallStackNavigationDirection,
): Readonly<StackFrame> | null {
  if (!validFrames(frames)) return null;

  let index: number;
  if (direction === "top") {
    index = 0;
  } else if (direction === "bottom") {
    index = frames.length - 1;
  } else if (selectedFrameId === null) {
    index = direction === "down" ? 0 : frames.length - 1;
  } else {
    const selectedIndex = frames.findIndex(({ frameId }) => frameId === selectedFrameId);
    if (selectedIndex < 0) return null;
    index =
      direction === "down"
        ? (selectedIndex + 1) % frames.length
        : (selectedIndex - 1 + frames.length) % frames.length;
  }

  return Object.freeze({ ...frames[index] });
}

function validFrames(frames: readonly StackFrame[]): boolean {
  if (frames.length === 0) return false;
  const ids = new Set<number>();
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 1 || ids.has(frame.frameId)) {
      return false;
    }
    ids.add(frame.frameId);
  }
  return true;
}
