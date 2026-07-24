import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  debugConsoleCompletionContextAt,
  type DebugConsoleCompletionContext,
  type DebugConsoleCompletionItem as DomainCompletionItem,
  type DebugConsoleCompletionQuery,
  type DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

const AUTO_COMPLETION_DELAY_MS = 120;
const MAX_COMPLETION_SURFACE_ITEMS = 100;
const UNAVAILABLE_MESSAGE = "Suggestions unavailable.";

export interface DebugConsoleCompletionInput {
  readonly cursor: number;
  readonly expression: string;
}

export interface DebugConsoleCompletionSurfaceItem {
  readonly detail: string;
  readonly id: string;
  readonly label: string;
}

export interface DebugConsoleCompletionSurfaceModel {
  readonly incomplete: boolean;
  readonly items: readonly DebugConsoleCompletionSurfaceItem[];
  readonly pending: boolean;
  readonly unavailable: string | null;
}

export interface DebugConsoleCompletionSurfaceReplacement {
  readonly cursor: number;
  readonly expression: string;
}

export interface UseDebugConsoleCompletionsOptions {
  readonly complete: (
    owner: DebugInspectionOwner,
    query: DebugConsoleCompletionQuery,
  ) => Promise<DebugConsoleCompletionResponse | null>;
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly workspaceOwnerKey: string | null;
}

export interface UseDebugConsoleCompletionsResult {
  readonly model: DebugConsoleCompletionSurfaceModel;
  accept(
    item: DebugConsoleCompletionSurfaceItem,
    input: DebugConsoleCompletionInput,
  ): DebugConsoleCompletionSurfaceReplacement | null;
  dismiss(): void;
  inputChanged(input: DebugConsoleCompletionInput): void;
  request(input: DebugConsoleCompletionInput): void;
}

interface CompletionSnapshot {
  readonly context: DebugConsoleCompletionContext | null;
  readonly input: DebugConsoleCompletionInput | null;
  readonly items: readonly CompletionSnapshotItem[];
  readonly ownerEpoch: number;
  readonly pending: boolean;
  readonly responseIncomplete: boolean;
  readonly unavailable: string | null;
}

interface CompletionSnapshotItem extends DebugConsoleCompletionSurfaceItem {
  readonly source: DomainCompletionItem;
}

const emptyModel: DebugConsoleCompletionSurfaceModel = Object.freeze({
  incomplete: false,
  items: Object.freeze([]),
  pending: false,
  unavailable: null,
});

function emptySnapshot(ownerEpoch: number): CompletionSnapshot {
  return {
    context: null,
    input: null,
    items: Object.freeze([]),
    ownerEpoch,
    pending: false,
    responseIncomplete: false,
    unavailable: null,
  };
}

/**
 * Owns Debug Console suggestion timing and authority. The session port performs
 * the final IPC owner check; this hook additionally fences input/request order.
 */
export function useDebugConsoleCompletions({
  complete,
  debugAdapterKind,
  inspectionOwner,
  workspaceOwnerKey,
}: UseDebugConsoleCompletionsOptions): UseDebugConsoleCompletionsResult {
  const ownerIdentityRef = useRef({
    adapterKind: debugAdapterKind,
    epoch: inspectionOwner ? 1 : 0,
    inspectionOwner,
    workspaceOwnerKey,
  });
  if (
    ownerIdentityRef.current.adapterKind !== debugAdapterKind ||
    ownerIdentityRef.current.workspaceOwnerKey !== workspaceOwnerKey ||
    !debugInspectionOwnersEqual(ownerIdentityRef.current.inspectionOwner, inspectionOwner)
  ) {
    ownerIdentityRef.current = {
      adapterKind: debugAdapterKind,
      epoch: ownerIdentityRef.current.epoch + 1,
      inspectionOwner,
      workspaceOwnerKey,
    };
  }
  const currentRef = useRef({ complete, debugAdapterKind, inspectionOwner, workspaceOwnerKey });
  currentRef.current = { complete, debugAdapterKind, inspectionOwner, workspaceOwnerKey };
  const [snapshot, setSnapshot] = useState<CompletionSnapshot>(() =>
    emptySnapshot(ownerIdentityRef.current.epoch),
  );
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);
  const inputRevisionRef = useRef(0);

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      cancelTimer();
    };
  }, [cancelTimer]);

  useEffect(() => {
    cancelTimer();
    requestSequenceRef.current += 1;
    inputRevisionRef.current += 1;
    setSnapshot(emptySnapshot(ownerIdentityRef.current.epoch));
  }, [cancelTimer, debugAdapterKind, inspectionOwner, workspaceOwnerKey]);

  const runRequest = useCallback(
    async (
      input: DebugConsoleCompletionInput,
      context: DebugConsoleCompletionContext,
      inputRevision: number,
    ) => {
      cancelTimer();
      const owner = currentRef.current.inspectionOwner;
      const epoch = ownerIdentityRef.current.epoch;
      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      if (
        currentRef.current.debugAdapterKind !== "node" ||
        currentRef.current.workspaceOwnerKey === null ||
        owner === null
      ) {
        setSnapshot(emptySnapshot(epoch));
        return;
      }
      const capturedInput = Object.freeze({ ...input });
      setSnapshot({
        context,
        input: capturedInput,
        items: Object.freeze([]),
        ownerEpoch: epoch,
        pending: true,
        responseIncomplete: false,
        unavailable: null,
      });
      const completeRequest = currentRef.current.complete;
      let response: DebugConsoleCompletionResponse | null = null;
      try {
        response = await completeRequest(owner, context.query);
      } catch {
        response = null;
      }
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== requestSequence ||
        inputRevisionRef.current !== inputRevision ||
        ownerIdentityRef.current.epoch !== epoch ||
        currentRef.current.complete !== completeRequest ||
        currentRef.current.workspaceOwnerKey === null ||
        !debugInspectionOwnersEqual(currentRef.current.inspectionOwner, owner)
      ) {
        return;
      }
      const items =
        response?.items.slice(0, MAX_COMPLETION_SURFACE_ITEMS).map((source, index) =>
          Object.freeze({
            detail: source.kind,
            id: `${requestSequence}:${index}`,
            label: source.label,
            source,
          }),
        ) ?? [];
      setSnapshot({
        context,
        input: capturedInput,
        items: Object.freeze(items),
        ownerEpoch: epoch,
        pending: false,
        responseIncomplete:
          response !== null &&
          (response.isIncomplete || response.items.length > MAX_COMPLETION_SURFACE_ITEMS),
        unavailable: response === null ? UNAVAILABLE_MESSAGE : null,
      });
    },
    [cancelTimer],
  );

  const request = useCallback(
    (input: DebugConsoleCompletionInput) => {
      cancelTimer();
      const inputRevision = inputRevisionRef.current + 1;
      inputRevisionRef.current = inputRevision;
      const context = debugConsoleCompletionContextAt(input.expression, input.cursor);
      if (!context) {
        requestSequenceRef.current += 1;
        setSnapshot(emptySnapshot(ownerIdentityRef.current.epoch));
        return;
      }
      void runRequest(input, context, inputRevision);
    },
    [cancelTimer, runRequest],
  );

  const inputChanged = useCallback(
    (input: DebugConsoleCompletionInput) => {
      cancelTimer();
      requestSequenceRef.current += 1;
      const inputRevision = inputRevisionRef.current + 1;
      inputRevisionRef.current = inputRevision;
      const context = debugConsoleCompletionContextAt(input.expression, input.cursor);
      const afterDot =
        context?.query.kind === "member" &&
        context.prefix === "" &&
        input.expression[input.cursor - 1] === ".";
      if (!context || (!afterDot && Array.from(context.prefix).length < 2)) {
        setSnapshot(emptySnapshot(ownerIdentityRef.current.epoch));
        return;
      }
      const capturedInput = Object.freeze({ ...input });
      const capturedContext = context;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runRequest(capturedInput, capturedContext, inputRevision);
      }, AUTO_COMPLETION_DELAY_MS);
    },
    [cancelTimer, runRequest],
  );

  const dismiss = useCallback(() => {
    cancelTimer();
    requestSequenceRef.current += 1;
    inputRevisionRef.current += 1;
    setSnapshot(emptySnapshot(ownerIdentityRef.current.epoch));
  }, [cancelTimer]);

  const accept = useCallback(
    (
      item: DebugConsoleCompletionSurfaceItem,
      input: DebugConsoleCompletionInput,
    ): DebugConsoleCompletionSurfaceReplacement | null => {
      const currentSnapshot = snapshot;
      const matched = currentSnapshot.items.find((candidate) => candidate.id === item.id);
      if (
        currentSnapshot.ownerEpoch !== ownerIdentityRef.current.epoch ||
        currentSnapshot.pending ||
        !currentSnapshot.context ||
        !currentSnapshot.input ||
        !matched ||
        matched.label !== item.label ||
        currentSnapshot.input.expression !== input.expression ||
        currentSnapshot.input.cursor !== input.cursor
      ) {
        return null;
      }
      const { start, end } = currentSnapshot.context.replacement;
      if (start < 0 || end < start || end > input.expression.length || input.cursor !== end) {
        return null;
      }
      const expression = `${input.expression.slice(0, start)}${matched.source.label}${input.expression.slice(end)}`;
      dismiss();
      return {
        cursor: start + matched.source.label.length,
        expression,
      };
    },
    [dismiss, snapshot],
  );

  const model = useMemo<DebugConsoleCompletionSurfaceModel>(
    () =>
      snapshot.ownerEpoch === ownerIdentityRef.current.epoch
        ? {
            incomplete: snapshot.responseIncomplete,
            items: snapshot.items,
            pending: snapshot.pending,
            unavailable: snapshot.unavailable,
          }
        : emptyModel,
    [snapshot],
  );

  return useMemo(
    () => ({ accept, dismiss, inputChanged, model, request }),
    [accept, dismiss, inputChanged, model, request],
  );
}
