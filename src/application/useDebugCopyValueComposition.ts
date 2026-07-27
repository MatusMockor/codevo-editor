import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import {
  captureDebugCopyValueCandidate,
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

export interface DebugCopyDisplayedValueSurfaceAdapter
  extends DebugCopyDisplayedValueCommands, DebugCopyEvaluatePathCommands {
  readonly source: "console";
  readonly workspaceOwnerKey: string;
  readonly generation: number;
  readonly epoch: number;
  copyDisplayedValueFromMenu(): Promise<boolean>;
  copyEvaluatePathFromMenu(): Promise<boolean>;
  isOwnerCurrent(owner: DebugInspectionOwner): boolean;
  onCandidateChange(candidate: DebugCopyValueCandidate | null): boolean;
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

type ImmutableConsoleCandidateAuthority =
  | { readonly kind: "empty" }
  | {
      readonly kind: "immutable-console";
      readonly authorityEpoch: number;
      readonly candidate: DebugCopyValueCandidate;
    };

const EMPTY_IMMUTABLE_CONSOLE_AUTHORITY: ImmutableConsoleCandidateAuthority = Object.freeze({
  kind: "empty",
});

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
  const immutableConsoleCandidateRef = useRef<ImmutableConsoleCandidateAuthority>(
    EMPTY_IMMUTABLE_CONSOLE_AUTHORITY,
  );
  const immutableConsoleAuthorityEpochRef = useRef(1);
  const consolePresentationGenerationRef = useRef(1);
  const ownerRef = useRef({ epoch: owner ? 1 : 0, owner: snapshotOwner(owner) });
  const consoleWorkspaceOwnerKeyRef = useRef(owner?.workspaceOwnerKey ?? "");
  const nextOwner = snapshotOwner(owner);
  if (!ownersEqual(ownerRef.current.owner, nextOwner)) {
    const previousOwner = ownerRef.current.owner;
    const previousWorkspaceOwnerKey = consoleWorkspaceOwnerKeyRef.current;
    generationRef.current += 1;
    focusedRef.current = null;
    ownerRef.current = { epoch: ownerRef.current.epoch + 1, owner: nextOwner };
    if (nextOwner) {
      consolePresentationGenerationRef.current += 1;
      consoleWorkspaceOwnerKeyRef.current = nextOwner.workspaceOwnerKey;
      if (previousOwner !== null || previousWorkspaceOwnerKey !== nextOwner.workspaceOwnerKey) {
        immutableConsoleAuthorityEpochRef.current += 1;
        immutableConsoleCandidateRef.current = EMPTY_IMMUTABLE_CONSOLE_AUTHORITY;
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    return () => {
      mountedRef.current = false;
      focusedRef.current = null;
      immutableConsoleAuthorityEpochRef.current += 1;
      immutableConsoleCandidateRef.current = EMPTY_IMMUTABLE_CONSOLE_AUTHORITY;
    };
  }, []);

  const clearFocusedCandidate = useCallback((): void => {
    if (!mountedRef.current) return;
    generationRef.current += 1;
    focusedRef.current = null;
    immutableConsoleAuthorityEpochRef.current += 1;
    immutableConsoleCandidateRef.current = EMPTY_IMMUTABLE_CONSOLE_AUTHORITY;
  }, []);

  const setFocusedCandidate = useCallback(
    (candidate: DebugCopyValueFocusCandidate | DebugCopyValueCandidate | null): boolean => {
      if (!mountedRef.current) return false;
      if (!candidate) {
        generationRef.current += 1;
        focusedRef.current = null;
        immutableConsoleAuthorityEpochRef.current += 1;
        immutableConsoleCandidateRef.current = EMPTY_IMMUTABLE_CONSOLE_AUTHORITY;
        return true;
      }
      const currentOwner = ownerRef.current.owner;
      if (!("rootKey" in candidate)) {
        if (!currentOwner) return false;
        generationRef.current += 1;
        focusedRef.current = {
          source: candidate.source,
          identity: candidate.identity,
          rootKey: currentOwner.rootKey,
          workspaceOwnerKey: currentOwner.workspaceOwnerKey,
          sessionId: currentOwner.sessionId,
          pauseGeneration: currentOwner.pauseGeneration,
          frameId: currentOwner.frameId,
          generation: generationRef.current,
          epoch: ownerRef.current.epoch,
          ...(candidate.evaluateName === undefined ? {} : { evaluateName: candidate.evaluateName }),
          ...(candidate.adapterEvaluateName === undefined
            ? {}
            : { adapterEvaluateName: candidate.adapterEvaluateName }),
          displayedValue: candidate.displayedValue,
        };
        return true;
      }
      const captured = captureDebugCopyValueCandidate({
        readDebugCopyValueCandidate: () => candidate,
      });
      if (!captured) return false;
      if (captured.source === "console") {
        if (
          captured.workspaceOwnerKey !== consoleWorkspaceOwnerKeyRef.current ||
          captured.generation !== consolePresentationGenerationRef.current
        ) {
          return false;
        }
        const retained = immutableConsoleCandidateRef.current;
        if (
          retained.kind === "immutable-console" &&
          !debugCopyValueCandidatesEqual(captured, retained.candidate)
        ) {
          return immutableConsolePresentationCandidatesEqual(captured, retained.candidate);
        }
        immutableConsoleCandidateRef.current = {
          kind: "immutable-console",
          authorityEpoch: immutableConsoleAuthorityEpochRef.current,
          candidate: captured,
        };
      }
      if (!currentOwner) {
        focusedRef.current = null;
        return captured.source === "console";
      }
      if (!ownersEqual(captured, currentOwner) || captured.epoch !== ownerRef.current.epoch) {
        focusedRef.current = null;
        return captured.source === "console";
      }
      generationRef.current += 1;
      focusedRef.current = {
        source: captured.source,
        identity: captured.identity,
        rootKey: currentOwner.rootKey,
        workspaceOwnerKey: currentOwner.workspaceOwnerKey,
        sessionId: currentOwner.sessionId,
        pauseGeneration: currentOwner.pauseGeneration,
        frameId: currentOwner.frameId,
        generation: generationRef.current,
        epoch: ownerRef.current.epoch,
        ...(captured.evaluateName === undefined ? {} : { evaluateName: captured.evaluateName }),
        ...(captured.adapterEvaluateName === undefined
          ? {}
          : { adapterEvaluateName: captured.adapterEvaluateName }),
        displayedValue: captured.displayedValue,
      };
      return true;
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
    candidateReader: {
      readDebugCopyValueCandidate: () =>
        immutableConsoleCandidateRef.current.kind === "immutable-console"
          ? immutableConsoleCandidateRef.current.candidate
          : null,
    },
    clipboard,
    flight: clipboardFlightRef,
    isCandidateCurrent: (candidate) =>
      mountedRef.current &&
      candidate.source === "console" &&
      candidate.workspaceOwnerKey === consoleWorkspaceOwnerKeyRef.current &&
      immutableConsoleCandidateRef.current.kind === "immutable-console" &&
      immutableConsoleCandidateRef.current.authorityEpoch ===
        immutableConsoleAuthorityEpochRef.current &&
      debugCopyValueCandidatesEqual(candidate, immutableConsoleCandidateRef.current.candidate),
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
    const captured = immutableConsoleCandidateRef.current;
    if (!mountedRef.current || captured.kind !== "immutable-console") return false;
    try {
      return await copyDisplayedValue.copyDisplayedValue();
    } finally {
      if (
        mountedRef.current &&
        immutableConsoleCandidateRef.current.kind === "immutable-console" &&
        captured.authorityEpoch === immutableConsoleCandidateRef.current.authorityEpoch &&
        debugCopyValueCandidatesEqual(
          captured.candidate,
          immutableConsoleCandidateRef.current.candidate,
        )
      ) {
        generationRef.current += 1;
        immutableConsoleAuthorityEpochRef.current += 1;
        immutableConsoleCandidateRef.current = EMPTY_IMMUTABLE_CONSOLE_AUTHORITY;
        if (
          focusedRef.current &&
          debugCopyValueCandidatesEqual(captured.candidate, focusedRef.current)
        ) {
          focusedRef.current = null;
        }
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
      ...copyEvaluatePath,
      copyEvaluatePathFromMenu,
      copyDisplayedValueFromMenu,
      source: "console",
      workspaceOwnerKey: consoleWorkspaceOwnerKeyRef.current,
      generation: consolePresentationGenerationRef.current,
      epoch: Math.max(1, ownerRef.current.epoch),
      isOwnerCurrent: (candidateOwner) =>
        mountedRef.current && inspectionOwnersEqual(candidateOwner, ownerRef.current.owner),
      onCandidateChange: (candidate) => {
        if (candidate !== null && candidate.source !== "console") return false;
        return setFocusedCandidate(candidate);
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

function immutableConsolePresentationCandidatesEqual(
  left: DebugCopyValueCandidate,
  right: DebugCopyValueCandidate,
): boolean {
  return (
    left.source === "console" &&
    right.source === "console" &&
    left.identity === right.identity &&
    left.rootKey === right.rootKey &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.sessionId === right.sessionId &&
    left.pauseGeneration === right.pauseGeneration &&
    left.frameId === right.frameId &&
    left.generation === right.generation &&
    left.epoch === right.epoch &&
    left.displayedValue === right.displayedValue
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
