import { useEffect, useRef } from "react";
import type { DebugScope } from "../domain/debug";
import { MAX_DEBUG_INLINE_ROOT_SCOPES } from "../domain/debugInlineValues";
import {
  debugInspectionOwnersEqual,
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

export const MAX_DEBUG_INLINE_LOAD_ATTEMPTS = 3;
export const DEBUG_INLINE_LOAD_RETRY_DELAY_MS = 50;

interface InlineLoadingTracker {
  readonly attempts: Map<number, number>;
  cancelled: boolean;
  readonly inFlight: Set<number>;
  readonly key: string | null;
  readonly timers: Map<number, ReturnType<typeof setTimeout>>;
}

export interface DebugInlineVariableLoadingOptions {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly isWorkspaceTrusted: boolean;
  readonly loadVariablePage: (
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
  ) => Promise<void>;
  readonly scopes: readonly DebugScope[];
  readonly selectedFrameId: number | null;
  readonly selectFrame: (frameId: number) => Promise<void>;
  readonly variablePages: DebugVariablePagesState;
}

export type DebugInlineVariableLoadingPlan =
  | { readonly kind: "disabled" }
  | { readonly kind: "select-frame"; readonly frameId: number }
  | { readonly kind: "load-page-zero"; readonly variableReferences: readonly number[] }
  | { readonly kind: "ready" };

export function planDebugInlineVariableLoading(
  options: Omit<
    DebugInlineVariableLoadingOptions,
    "isWorkspaceTrusted" | "loadVariablePage" | "selectFrame"
  > & { readonly enabled: boolean },
): DebugInlineVariableLoadingPlan {
  const { debugAdapterKind, enabled, inspectionOwner, scopes, selectedFrameId, variablePages } =
    options;
  if (debugAdapterKind !== "node" || !enabled || inspectionOwner === null) {
    return { kind: "disabled" };
  }
  if (selectedFrameId !== inspectionOwner.frameId) {
    return { kind: "select-frame", frameId: inspectionOwner.frameId };
  }
  if (!debugInspectionOwnersEqual(variablePages.owner, inspectionOwner)) {
    return { kind: "ready" };
  }

  const rootReferences: number[] = [];
  const seen = new Set<number>();
  for (const scope of scopes) {
    const reference = scope.variablesReference;
    if (
      scope.expensive ||
      !Number.isSafeInteger(reference) ||
      reference <= 0 ||
      seen.has(reference)
    ) {
      continue;
    }
    seen.add(reference);
    rootReferences.push(reference);
    if (rootReferences.length === MAX_DEBUG_INLINE_ROOT_SCOPES) break;
  }
  const unloadedReferences = rootReferences.filter(
    (reference) =>
      selectDebugVariableExpansion(variablePages, inspectionOwner, reference).kind === "idle",
  );
  return unloadedReferences.length === 0
    ? { kind: "ready" }
    : { kind: "load-page-zero", variableReferences: unloadedReferences };
}

/**
 * Warms only the first page of a bounded set of root scopes for paused inline values.
 * Nested variables and expression evaluation remain explicitly user-driven.
 */
export function useDebugInlineVariableLoading({
  debugAdapterKind,
  inspectionOwner,
  isWorkspaceTrusted,
  loadVariablePage,
  scopes,
  selectedFrameId,
  selectFrame,
  variablePages,
}: DebugInlineVariableLoadingOptions): void {
  const currentRef = useRef({
    debugAdapterKind,
    inspectionOwner,
    isWorkspaceTrusted,
    loadVariablePage,
    scopes,
    selectedFrameId,
    variablePages,
  });
  currentRef.current = {
    debugAdapterKind,
    inspectionOwner,
    isWorkspaceTrusted,
    loadVariablePage,
    scopes,
    selectedFrameId,
    variablePages,
  };
  const trackerRef = useRef<InlineLoadingTracker>(createInlineLoadingTracker(null));
  const selectedOwnerRef = useRef(false);

  useEffect(() => {
    const ownerKey = inspectionOwner ? inlineLoadingOwnerKey(inspectionOwner) : null;
    if (trackerRef.current.key !== ownerKey) {
      cancelInlineLoadingTracker(trackerRef.current);
      trackerRef.current = createInlineLoadingTracker(ownerKey);
      selectedOwnerRef.current = false;
    }

    const plan = planDebugInlineVariableLoading({
      debugAdapterKind,
      enabled: isWorkspaceTrusted,
      inspectionOwner,
      scopes,
      selectedFrameId,
      variablePages,
    });
    if (plan.kind === "select-frame") {
      if (selectedOwnerRef.current) return;
      selectedOwnerRef.current = true;
      void selectFrame(plan.frameId).catch(() => undefined);
      return;
    }
    if (plan.kind !== "load-page-zero" || inspectionOwner === null) return;

    const tracker = trackerRef.current;
    const request = (reference: number) => {
      if (
        tracker.cancelled ||
        tracker.inFlight.has(reference) ||
        tracker.timers.has(reference) ||
        (tracker.attempts.get(reference) ?? 0) >= MAX_DEBUG_INLINE_LOAD_ATTEMPTS
      )
        return;
      const current = currentRef.current;
      const currentOwner = current.inspectionOwner;
      const currentPlan = planDebugInlineVariableLoading({
        debugAdapterKind: current.debugAdapterKind,
        enabled: current.isWorkspaceTrusted,
        inspectionOwner: currentOwner,
        scopes: current.scopes,
        selectedFrameId: current.selectedFrameId,
        variablePages: current.variablePages,
      });
      if (
        currentOwner === null ||
        inlineLoadingOwnerKey(currentOwner) !== tracker.key ||
        currentPlan.kind !== "load-page-zero" ||
        !currentPlan.variableReferences.includes(reference)
      )
        return;

      tracker.attempts.set(reference, (tracker.attempts.get(reference) ?? 0) + 1);
      tracker.inFlight.add(reference);
      const settled = () => {
        tracker.inFlight.delete(reference);
        if (
          tracker.cancelled ||
          trackerRef.current !== tracker ||
          (tracker.attempts.get(reference) ?? 0) >= MAX_DEBUG_INLINE_LOAD_ATTEMPTS
        )
          return;
        const timer = setTimeout(() => {
          tracker.timers.delete(reference);
          request(reference);
        }, DEBUG_INLINE_LOAD_RETRY_DELAY_MS);
        tracker.timers.set(reference, timer);
      };
      try {
        void current.loadVariablePage(currentOwner, reference, 0).then(settled, settled);
      } catch {
        settled();
      }
    };
    for (const reference of plan.variableReferences) {
      request(reference);
    }
  }, [
    debugAdapterKind,
    inspectionOwner,
    isWorkspaceTrusted,
    loadVariablePage,
    scopes,
    selectedFrameId,
    selectFrame,
    variablePages,
  ]);

  useEffect(
    () => () => {
      cancelInlineLoadingTracker(trackerRef.current);
      trackerRef.current = createInlineLoadingTracker(null);
      selectedOwnerRef.current = false;
    },
    [],
  );
}

function createInlineLoadingTracker(key: string | null): InlineLoadingTracker {
  return { attempts: new Map(), cancelled: false, inFlight: new Set(), key, timers: new Map() };
}

function cancelInlineLoadingTracker(tracker: InlineLoadingTracker): void {
  tracker.cancelled = true;
  for (const timer of tracker.timers.values()) clearTimeout(timer);
  tracker.timers.clear();
}

function inlineLoadingOwnerKey(owner: DebugInspectionOwner): string {
  return JSON.stringify([owner.rootKey, owner.sessionId, owner.pauseGeneration, owner.frameId]);
}
