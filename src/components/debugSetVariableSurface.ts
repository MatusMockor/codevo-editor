export interface DebugSetVariableFocusedRow {
  readonly identity: object;
  isCurrent(): boolean;
  beginEdit(): boolean;
}

export interface DebugSetVariableSurface {
  setFocusedCapability(candidate: DebugSetVariableFocusedRow | null): () => void;
}

export function publishDebugSetVariableFocusedRow(
  surface: DebugSetVariableSurface | undefined,
  candidate: DebugSetVariableFocusedRow | null,
): () => void {
  try {
    return surface?.setFocusedCapability(candidate) ?? (() => undefined);
  } catch {
    // Presentation ownership bridges fail closed.
    return () => undefined;
  }
}
