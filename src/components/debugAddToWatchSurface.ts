import type {
  DebugAddToWatchFocusedCandidate,
  DebugAddToWatchSurface,
} from "../application/useDebugAddToWatchComposition";

/** Presentation-only facade: raw expressions stay inside the private focus publisher. */
export type DebugAddToWatchVariableSurface = DebugAddToWatchSurface;

export function publishDebugAddToWatchFocusedRow(
  surface: DebugAddToWatchVariableSurface | undefined,
  candidate: DebugAddToWatchFocusedCandidate | null,
): () => void {
  try {
    return surface?.setFocusedCandidate(candidate) ?? (() => undefined);
  } catch {
    return () => undefined;
  }
}

export function canDebugAddToWatch(surface: DebugAddToWatchVariableSurface | undefined): boolean {
  try {
    return surface?.canAddToWatch() === true;
  } catch {
    return false;
  }
}

export function runDebugAddToWatch(surface: DebugAddToWatchVariableSurface | undefined): boolean {
  try {
    return surface?.addToWatch() === true;
  } catch {
    return false;
  }
}
