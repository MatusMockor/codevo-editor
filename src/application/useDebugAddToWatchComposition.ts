import { useCallback, useEffect, useMemo, useRef } from "react";
import { validateDebugExpression } from "../domain/debugEvaluationPolicy";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";
import type {
  DebugAddToWatchCommandBridge,
  DebugAddToWatchSafeCommands,
} from "./debugAddToWatchCommandBridge";

export interface DebugAddToWatchFocusedCandidate {
  readonly identity: object;
  readonly owner: DebugInspectionOwner;
  readonly adapterEvaluateName: string;
  isCurrent(): boolean;
}

export interface DebugAddToWatchSurface extends DebugAddToWatchSafeCommands {
  setFocusedCandidate(candidate: DebugAddToWatchFocusedCandidate | null): () => void;
}

export interface DebugAddToWatchComposition {
  readonly commands: DebugAddToWatchSafeCommands;
  readonly surface: DebugAddToWatchSurface;
}

interface DebugAddToWatchOwner extends DebugInspectionOwner {
  readonly workspaceOwnerKey: string;
}

interface UseDebugAddToWatchCompositionOptions {
  readonly bridge: DebugAddToWatchCommandBridge;
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly workspaceOwnerKey: string | null;
  canAddWatch(expression: string): boolean;
  addWatch(expression: string): boolean;
}

interface BoundCandidate {
  readonly candidate: DebugAddToWatchFocusedCandidate;
  readonly expression: string;
  readonly generation: number;
  readonly epoch: number;
  readonly owner: DebugAddToWatchOwner;
}

export function useDebugAddToWatchComposition({
  addWatch,
  bridge,
  canAddWatch,
  debugAdapterKind,
  inspectionOwner,
  workspaceOwnerKey,
}: UseDebugAddToWatchCompositionOptions): DebugAddToWatchComposition {
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const ownerRef = useRef<{ readonly epoch: number; readonly owner: DebugAddToWatchOwner | null }>({
    epoch: 0,
    owner: null,
  });
  const boundRef = useRef<BoundCandidate | null>(null);
  const watchRef = useRef({ addWatch, canAddWatch });
  watchRef.current = { addWatch, canAddWatch };

  const nextOwner = snapshotOwner(debugAdapterKind, inspectionOwner, workspaceOwnerKey);
  if (!ownersEqual(ownerRef.current.owner, nextOwner)) {
    generationRef.current += 1;
    boundRef.current = null;
    ownerRef.current = { epoch: ownerRef.current.epoch + 1, owner: nextOwner };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      boundRef.current = null;
    };
  }, []);

  const setFocusedCandidate = useCallback(
    (candidate: DebugAddToWatchFocusedCandidate | null): (() => void) => {
      if (!mountedRef.current || !candidate) return () => undefined;
      const owner = ownerRef.current.owner;
      const expression = candidate.adapterEvaluateName;
      if (
        !owner ||
        !debugInspectionOwnersEqual(candidate.owner, owner) ||
        !validAdapterEvaluateName(expression) ||
        !safeCurrent(candidate)
      ) {
        return () => undefined;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const bound: BoundCandidate = Object.freeze({
        candidate,
        expression,
        generation,
        epoch: ownerRef.current.epoch,
        owner,
      });
      boundRef.current = bound;
      const capability = Object.freeze({
        identity: candidate.identity,
        isCurrent: () => boundIsCurrent(bound, mountedRef, ownerRef, generationRef, boundRef),
        canAddToWatch: () => safeWatchCall(() => watchRef.current.canAddWatch(expression)),
        addToWatch: () => safeWatchCall(() => watchRef.current.addWatch(expression)),
      });
      const releaseBridge = bridge.setFocusedCapability(capability);
      return () => {
        releaseBridge();
        if (boundRef.current === bound) {
          generationRef.current += 1;
          boundRef.current = null;
        }
      };
    },
    [bridge],
  );

  const surface = useMemo<DebugAddToWatchSurface>(
    () =>
      Object.freeze({
        addToWatch: bridge.commands.addToWatch,
        canAddToWatch: bridge.commands.canAddToWatch,
        setFocusedCandidate,
      }),
    [bridge.commands, setFocusedCandidate],
  );
  return useMemo(
    () => Object.freeze({ commands: bridge.commands, surface }),
    [bridge.commands, surface],
  );
}

function snapshotOwner(
  adapterKind: ActiveDebugAdapterKind,
  owner: DebugInspectionOwner | null,
  workspaceOwnerKey: string | null,
): DebugAddToWatchOwner | null {
  if (adapterKind !== "node" || !owner || !workspaceOwnerKey) return null;
  return Object.freeze({ ...owner, workspaceOwnerKey });
}

function ownersEqual(
  left: DebugAddToWatchOwner | null,
  right: DebugAddToWatchOwner | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      debugInspectionOwnersEqual(left, right) &&
      left.workspaceOwnerKey === right.workspaceOwnerKey)
  );
}

function validAdapterEvaluateName(expression: string): boolean {
  return typeof expression === "string" && validateDebugExpression(expression).ok;
}

function safeCurrent(candidate: DebugAddToWatchFocusedCandidate): boolean {
  try {
    return candidate.isCurrent() === true;
  } catch {
    return false;
  }
}

function boundIsCurrent(
  bound: BoundCandidate,
  mountedRef: { readonly current: boolean },
  ownerRef: {
    readonly current: { readonly epoch: number; readonly owner: DebugAddToWatchOwner | null };
  },
  generationRef: { readonly current: number },
  boundRef: { readonly current: BoundCandidate | null },
): boolean {
  return (
    mountedRef.current &&
    boundRef.current === bound &&
    ownerRef.current.epoch === bound.epoch &&
    ownersEqual(ownerRef.current.owner, bound.owner) &&
    generationRef.current === bound.generation &&
    safeCurrent(bound.candidate)
  );
}

function safeWatchCall(call: () => boolean): boolean {
  try {
    return call() === true;
  } catch {
    return false;
  }
}
