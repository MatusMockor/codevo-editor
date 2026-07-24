import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import {
  debugCopyValueCandidatesEqual,
  type DebugCopyValueCandidate,
  type DebugCopyValueSource,
} from "./debugCopyValue";
import { useDebugCopyValue, type DebugCopyValueCommands } from "./useDebugCopyValue";
import {
  useDebugCopyEvaluatePath,
  type DebugCopyEvaluatePathCommands,
} from "./useDebugCopyEvaluatePath";
import {
  useDebugCopyDisplayedValue,
  type DebugCopyDisplayedValueCommands,
} from "./useDebugCopyDisplayedValue";

export interface DebugCopyValueOwner {
  readonly rootKey: string;
  readonly workspaceOwnerKey: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
}

export interface DebugCopyValueFocusCandidate {
  readonly source: DebugCopyValueSource;
  readonly identity: string;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly displayedValue: string;
}

export interface DebugCopyValueComposition
  extends DebugCopyValueCommands, DebugCopyEvaluatePathCommands {
  readonly console: DebugCopyDisplayedValueSurfaceAdapter;
  readonly variables: DebugCopyValueSurfaceAdapter;
  readonly watch: DebugCopyValueSurfaceAdapter;
  setFocusedCandidate(
    candidate: DebugCopyValueFocusCandidate | DebugCopyValueCandidate | null,
  ): void;
  clearFocusedCandidate(): void;
  copyEvaluatePathOnce(target: DebugCopyEvaluatePathTarget): Promise<boolean>;
}

export interface DebugCopyDisplayedValueSurfaceAdapter extends DebugCopyDisplayedValueCommands {
  readonly source: "console";
  readonly workspaceOwnerKey: string;
  readonly generation: number;
  readonly epoch: number;
  copyDisplayedValueFromMenu(): Promise<boolean>;
  isOwnerCurrent(owner: DebugInspectionOwner): boolean;
  onCandidateChange(candidate: DebugCopyValueCandidate | null): void;
}

export interface DebugCopyEvaluatePathTarget {
  readonly owner: DebugInspectionOwner;
  readonly evaluateName: string;
  isCurrent(): boolean;
}

export interface DebugCopyValueSurfaceAdapter
  extends DebugCopyValueCommands, DebugCopyEvaluatePathCommands {
  readonly source: DebugCopyValueSource;
  readonly workspaceOwnerKey: string;
  readonly generation: number;
  readonly epoch: number;
  copyValueFromMenu(): Promise<boolean>;
  copyEvaluatePathFromMenu(): Promise<boolean>;
  isOwnerCurrent(owner: DebugInspectionOwner): boolean;
  onCandidateChange(candidate: DebugCopyValueCandidate | null): void;
}

interface UseDebugCopyValueCompositionOptions {
  readonly clipboard: TextClipboardGateway | null;
  readonly owner: DebugCopyValueOwner | null;
  evaluateClipboard(expression: string): Promise<DebugEvaluationResult | null>;
}

export function useDebugCopyValueComposition({
  clipboard,
  evaluateClipboard,
  owner,
}: UseDebugCopyValueCompositionOptions): DebugCopyValueComposition {
  const mountedRef = useRef(false);
  const [, setMounted] = useState(false);
  const generationRef = useRef(0);
  const clipboardFlightRef = useRef(false);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const focusedRef = useRef<DebugCopyValueCandidate | null>(null);
  const ownerRef = useRef({ epoch: owner ? 1 : 0, owner: snapshotOwner(owner) });
  const nextOwner = snapshotOwner(owner);
  if (!ownersEqual(ownerRef.current.owner, nextOwner)) {
    generationRef.current += 1;
    focusedRef.current = null;
    ownerRef.current = { epoch: ownerRef.current.epoch + 1, owner: nextOwner };
  }

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    return () => {
      mountedRef.current = false;
      focusedRef.current = null;
    };
  }, []);

  const clearFocusedCandidate = useCallback((): void => {
    if (!mountedRef.current) return;
    generationRef.current += 1;
    focusedRef.current = null;
  }, []);

  const setFocusedCandidate = useCallback(
    (candidate: DebugCopyValueFocusCandidate | DebugCopyValueCandidate | null): void => {
      if (!mountedRef.current) return;
      if (!candidate) {
        generationRef.current += 1;
        focusedRef.current = null;
        return;
      }
      const currentOwner = ownerRef.current.owner;
      if (!currentOwner) return;
      if (
        "rootKey" in candidate &&
        (!ownersEqual(candidate, currentOwner) || candidate.epoch !== ownerRef.current.epoch)
      ) {
        return;
      }
      const source = candidate.source;
      const identity = candidate.identity;
      const evaluateName = candidate.evaluateName;
      const adapterEvaluateName = candidate.adapterEvaluateName;
      const displayedValue = candidate.displayedValue;
      generationRef.current += 1;
      focusedRef.current = {
        source,
        identity,
        rootKey: currentOwner.rootKey,
        workspaceOwnerKey: currentOwner.workspaceOwnerKey,
        sessionId: currentOwner.sessionId,
        pauseGeneration: currentOwner.pauseGeneration,
        frameId: currentOwner.frameId,
        generation: generationRef.current,
        epoch: ownerRef.current.epoch,
        ...(evaluateName === undefined ? {} : { evaluateName }),
        ...(adapterEvaluateName === undefined ? {} : { adapterEvaluateName }),
        displayedValue,
      };
    },
    [],
  );

  const copyValue = useDebugCopyValue({
    candidateReader: { readDebugCopyValueCandidate: () => focusedRef.current },
    clipboard,
    flight: clipboardFlightRef,
    evaluateClipboard,
    isCandidateCurrent: (candidate) =>
      mountedRef.current &&
      candidate.epoch === ownerRef.current.epoch &&
      ownersEqual(candidate, ownerRef.current.owner) &&
      focusedRef.current !== null &&
      debugCopyValueCandidatesEqual(candidate, focusedRef.current),
  });
  const copyEvaluatePath = useDebugCopyEvaluatePath({
    candidateReader: { readDebugCopyValueCandidate: () => focusedRef.current },
    clipboard,
    flight: clipboardFlightRef,
    isCandidateCurrent: (candidate) =>
      mountedRef.current &&
      candidate.epoch === ownerRef.current.epoch &&
      ownersEqual(candidate, ownerRef.current.owner) &&
      focusedRef.current !== null &&
      debugCopyValueCandidatesEqual(candidate, focusedRef.current),
  });
  const copyDisplayedValue = useDebugCopyDisplayedValue({
    candidateReader: { readDebugCopyValueCandidate: () => focusedRef.current },
    clipboard,
    flight: clipboardFlightRef,
    isCandidateCurrent: (candidate) =>
      mountedRef.current &&
      candidate.epoch === ownerRef.current.epoch &&
      ownersEqual(candidate, ownerRef.current.owner) &&
      focusedRef.current !== null &&
      debugCopyValueCandidatesEqual(candidate, focusedRef.current),
  });
  const copyFocusedValue = copyValue.copyValue;
  const copyFocusedEvaluatePath = copyEvaluatePath.copyEvaluatePath;

  const copyEvaluatePathOnce = useCallback(
    async (target: DebugCopyEvaluatePathTarget): Promise<boolean> => {
      const capturedOwner = ownerRef.current.owner;
      const capturedEpoch = ownerRef.current.epoch;
      const capturedClipboard = clipboardRef.current;
      if (
        !mountedRef.current ||
        clipboardFlightRef.current ||
        !capturedOwner ||
        !inspectionOwnersEqual(target.owner, capturedOwner) ||
        typeof target.evaluateName !== "string" ||
        !target.evaluateName ||
        !capturedClipboard
      ) {
        return false;
      }
      clipboardFlightRef.current = true;
      const current = (): boolean => {
        if (
          !mountedRef.current ||
          ownerRef.current.epoch !== capturedEpoch ||
          !ownersEqual(capturedOwner, ownerRef.current.owner) ||
          clipboardRef.current !== capturedClipboard
        ) {
          return false;
        }
        try {
          return target.isCurrent() === true && capturedClipboard.canWriteText() === true;
        } catch {
          return false;
        }
      };
      try {
        if (!current()) return false;
        await Promise.resolve(capturedClipboard.writeText(target.evaluateName));
        return current();
      } catch {
        return false;
      } finally {
        clipboardFlightRef.current = false;
      }
    },
    [],
  );

  const copyValueFromMenu = useCallback(async (): Promise<boolean> => {
    const captured = focusedRef.current;
    if (!mountedRef.current || captured === null) return false;
    try {
      return await copyFocusedValue();
    } finally {
      if (
        mountedRef.current &&
        focusedRef.current !== null &&
        debugCopyValueCandidatesEqual(captured, focusedRef.current)
      ) {
        generationRef.current += 1;
        focusedRef.current = null;
      }
    }
  }, [copyFocusedValue]);

  const copyEvaluatePathFromMenu = useCallback(async (): Promise<boolean> => {
    const captured = focusedRef.current;
    if (!mountedRef.current || captured === null) return false;
    try {
      return await copyFocusedEvaluatePath();
    } finally {
      if (
        mountedRef.current &&
        focusedRef.current !== null &&
        debugCopyValueCandidatesEqual(captured, focusedRef.current)
      ) {
        generationRef.current += 1;
        focusedRef.current = null;
      }
    }
  }, [copyFocusedEvaluatePath]);

  const copyDisplayedValueFromMenu = useCallback(async (): Promise<boolean> => {
    const captured = focusedRef.current;
    if (!mountedRef.current || captured === null) return false;
    try {
      return await copyDisplayedValue.copyDisplayedValue();
    } finally {
      if (
        mountedRef.current &&
        focusedRef.current !== null &&
        debugCopyValueCandidatesEqual(captured, focusedRef.current)
      ) {
        generationRef.current += 1;
        focusedRef.current = null;
      }
    }
  }, [copyDisplayedValue]);

  const surface = (source: DebugCopyValueSource): DebugCopyValueSurfaceAdapter => ({
    ...copyValue,
    ...copyEvaluatePath,
    copyEvaluatePathFromMenu,
    copyValueFromMenu,
    source,
    workspaceOwnerKey: ownerRef.current.owner?.workspaceOwnerKey ?? "",
    generation: Math.max(1, generationRef.current),
    epoch: Math.max(1, ownerRef.current.epoch),
    isOwnerCurrent: (candidateOwner) =>
      mountedRef.current && inspectionOwnersEqual(candidateOwner, ownerRef.current.owner),
    onCandidateChange: (candidate) => {
      if (candidate !== null && candidate.source !== source) return;
      setFocusedCandidate(candidate);
    },
  });

  return {
    ...copyValue,
    ...copyEvaluatePath,
    clearFocusedCandidate,
    console: {
      ...copyDisplayedValue,
      copyDisplayedValueFromMenu,
      source: "console",
      workspaceOwnerKey: ownerRef.current.owner?.workspaceOwnerKey ?? "",
      generation: Math.max(1, generationRef.current),
      epoch: Math.max(1, ownerRef.current.epoch),
      isOwnerCurrent: (candidateOwner) =>
        mountedRef.current && inspectionOwnersEqual(candidateOwner, ownerRef.current.owner),
      onCandidateChange: (candidate) => {
        if (candidate !== null && candidate.source !== "console") return;
        setFocusedCandidate(candidate);
      },
    },
    copyEvaluatePathOnce,
    setFocusedCandidate,
    variables: surface("variables"),
    watch: surface("watch"),
  };
}

function snapshotOwner(owner: DebugCopyValueOwner | null): DebugCopyValueOwner | null {
  return owner ? { ...owner } : null;
}

function ownersEqual(
  left: DebugCopyValueOwner | DebugCopyValueCandidate | null,
  right: DebugCopyValueOwner | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.rootKey === right.rootKey &&
      left.workspaceOwnerKey === right.workspaceOwnerKey &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration &&
      left.frameId === right.frameId)
  );
}

function inspectionOwnersEqual(
  left: DebugInspectionOwner,
  right: DebugCopyValueOwner | null,
): boolean {
  return (
    right !== null &&
    left.rootKey === right.rootKey &&
    left.sessionId === right.sessionId &&
    left.pauseGeneration === right.pauseGeneration &&
    left.frameId === right.frameId
  );
}
