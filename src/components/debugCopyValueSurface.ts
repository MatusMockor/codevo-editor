import type { KeyboardEvent } from "react";
import type { DebugCopyValueCandidate, DebugCopyValueSource } from "../application/debugCopyValue";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import type { DebugCopyDisplayedValueSurfaceAdapter } from "../application/useDebugCopyValueComposition";

export interface DebugCopyCandidateSurface {
  readonly source: DebugCopyValueSource;
  readonly workspaceOwnerKey: string;
  readonly generation: number;
  readonly epoch: number;
  isOwnerCurrent(owner: DebugInspectionOwner): boolean;
  onCandidateChange(candidate: DebugCopyValueCandidate | null): void;
}

export interface DebugCopyValueSurface extends DebugCopyCandidateSurface {
  canCopyValue(): boolean;
  copyValue(): Promise<boolean>;
  copyValueFromMenu(): Promise<boolean>;
  canCopyEvaluatePath(): boolean;
  copyEvaluatePath(): Promise<boolean>;
  copyEvaluatePathFromMenu(): Promise<boolean>;
}

export type DebugCopyDisplayedValueSurface = DebugCopyDisplayedValueSurfaceAdapter;

export function debugCopyValueCandidateForNode({
  adapterEvaluateName,
  displayedValue,
  evaluateName,
  identity,
  owner,
  surface,
}: {
  readonly adapterEvaluateName?: string;
  readonly displayedValue: string | undefined;
  readonly evaluateName?: string;
  readonly identity: string;
  readonly owner: DebugInspectionOwner | null;
  readonly surface?: DebugCopyCandidateSurface;
}): DebugCopyValueCandidate | null {
  if (!surface || !owner || displayedValue === undefined) return null;
  try {
    if (!surface.isOwnerCurrent(owner)) return null;
  } catch {
    return null;
  }
  return {
    source: surface.source,
    identity,
    rootKey: owner.rootKey,
    workspaceOwnerKey: surface.workspaceOwnerKey,
    sessionId: owner.sessionId,
    pauseGeneration: owner.pauseGeneration,
    frameId: owner.frameId,
    generation: surface.generation,
    epoch: surface.epoch,
    ...(evaluateName === undefined ? {} : { evaluateName }),
    ...(adapterEvaluateName === undefined ? {} : { adapterEvaluateName }),
    displayedValue,
  };
}

export function runDebugCopyDisplayedValue(
  surface: DebugCopyDisplayedValueSurface | undefined,
): boolean {
  if (!surface) return false;
  try {
    if (!surface.canCopyDisplayedValue()) return false;
    void Promise.resolve(surface.copyDisplayedValue()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function runDebugCopyDisplayedValueFromMenu(
  surface: DebugCopyDisplayedValueSurface | undefined,
): boolean {
  if (!surface) return false;
  try {
    if (!surface.canCopyDisplayedValue()) return false;
    void Promise.resolve(surface.copyDisplayedValueFromMenu()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function publishDebugCopyValueCandidate(
  surface: DebugCopyCandidateSurface | undefined,
  candidate: DebugCopyValueCandidate | null,
): void {
  try {
    surface?.onCandidateChange(candidate);
  } catch {
    // Presentation ownership callbacks fail closed.
  }
}

export function runDebugCopyValue(surface: DebugCopyValueSurface | undefined): boolean {
  if (!surface) return false;
  try {
    if (!surface.canCopyValue()) return false;
    void Promise.resolve(surface.copyValue()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function runDebugCopyValueFromMenu(surface: DebugCopyValueSurface | undefined): boolean {
  if (!surface) return false;
  try {
    if (!surface.canCopyValue()) return false;
    void Promise.resolve(surface.copyValueFromMenu()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function runDebugCopyEvaluatePathFromMenu(
  surface: DebugCopyValueSurface | undefined,
): boolean {
  if (!surface) return false;
  try {
    if (!surface.canCopyEvaluatePath()) return false;
    void Promise.resolve(surface.copyEvaluatePathFromMenu()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function canDebugCopyEvaluatePath(surface: DebugCopyValueSurface | undefined): boolean {
  try {
    return surface?.canCopyEvaluatePath() === true;
  } catch {
    return false;
  }
}

export function debugCopyValuePresentationCandidatesEqual(
  left: DebugCopyValueCandidate | null,
  right: DebugCopyValueCandidate | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.source === right.source &&
      left.identity === right.identity &&
      left.rootKey === right.rootKey &&
      left.workspaceOwnerKey === right.workspaceOwnerKey &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration &&
      left.frameId === right.frameId &&
      left.epoch === right.epoch &&
      left.evaluateName === right.evaluateName &&
      left.adapterEvaluateName === right.adapterEvaluateName &&
      left.displayedValue === right.displayedValue)
  );
}

export function isLocalDebugCopyShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  if (
    event.key.toLowerCase() !== "c" ||
    (!event.metaKey && !event.ctrlKey) ||
    event.altKey ||
    event.shiftKey
  ) {
    return false;
  }
  try {
    if (typeof window.getSelection !== "function") return false;
    const selection = window.getSelection();
    return selection !== null && selection.isCollapsed === true;
  } catch {
    return false;
  }
}
