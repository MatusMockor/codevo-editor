import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DebugVariable } from "../domain/debug";
import {
  appendDebugConsoleHistory,
  createDebugConsoleState,
  deserializeDebugConsoleHistory,
  reduceDebugConsoleState,
  serializeDebugConsoleHistory,
  type DebugConsoleResultOwner,
  type DebugConsoleState,
} from "../domain/debugConsoleState";
import type { DebugEvaluationOwner, DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { DebugOutputLine } from "./debugSessionContracts";

const STORAGE_KEY_PREFIX = "mockor.debug.consoleHistory.";

interface DebugConsoleStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface UseDebugConsoleOptions {
  evaluate(expression: string): Promise<DebugVariable | null>;
  output: readonly DebugOutputLine[];
  owner: DebugEvaluationOwner | null;
  resultOwner?: Omit<DebugConsoleResultOwner, "epoch"> | null;
  sessionId: number | null;
  storage?: DebugConsoleStorage;
  workspaceRoot: string | null;
}

export interface UseDebugConsoleResult {
  readonly resultOwner?: DebugConsoleResultOwner | null;
  state: DebugConsoleState;
  clear(): void;
  submit(expression: string): Promise<void>;
}

export function useDebugConsole({
  evaluate,
  output,
  owner,
  resultOwner = null,
  sessionId,
  storage,
  workspaceRoot,
}: UseDebugConsoleOptions): UseDebugConsoleResult {
  const ownerPauseGeneration = owner?.sessionId === sessionId ? owner.pauseGeneration : null;
  const consoleOwner = useMemo(
    () =>
      sessionId === null
        ? null
        : ownerPauseGeneration === null
          ? { sessionId, pauseGeneration: 0 }
          : { sessionId, pauseGeneration: ownerPauseGeneration },
    [ownerPauseGeneration, sessionId],
  );
  const [state, setState] = useState(() => createDebugConsoleState(consoleOwner));
  const historyByRootRef = useRef(new Map<string, readonly string[]>());
  const loadedRootsRef = useRef(new Set<string>());
  const activeRootKeyRef = useRef("");
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const consoleOwnerRef = useRef(consoleOwner);
  consoleOwnerRef.current = consoleOwner;
  const resultOwnerRef = useRef<DebugConsoleResultOwner | null>(null);
  const resultOwnerAuthorityRef = useRef<{
    readonly epoch: number;
    readonly owner: Omit<DebugConsoleResultOwner, "epoch"> | null;
  }>({ epoch: resultOwner ? 1 : 0, owner: snapshotResultOwner(resultOwner) });
  if (!resultOwnersEqual(resultOwnerAuthorityRef.current.owner, resultOwner)) {
    resultOwnerAuthorityRef.current = {
      epoch: resultOwnerAuthorityRef.current.epoch + 1,
      owner: snapshotResultOwner(resultOwner),
    };
  }
  const currentResultOwner = resultOwnerAuthorityRef.current.owner
    ? {
        ...resultOwnerAuthorityRef.current.owner,
        epoch: resultOwnerAuthorityRef.current.epoch,
      }
    : null;
  resultOwnerRef.current = currentResultOwner;
  const activeRootKey = normalizedWorkspaceRootKey(workspaceRoot);
  const outputCursorRef = useRef<{
    lastLine: DebugOutputLine | null;
    seenLines: WeakSet<DebugOutputLine>;
    sessionId: number | null;
  }>({ lastLine: null, seenLines: new WeakSet(), sessionId });
  const requestIdRef = useRef(0);

  useEffect(() => {
    setState((current) => reduceDebugConsoleState(current, { type: "own", owner: consoleOwner }));
  }, [consoleOwner]);

  useLayoutEffect(() => {
    activeRootKeyRef.current = activeRootKey;
    if (!activeRootKey) {
      setState((current) =>
        reduceDebugConsoleState(current, { type: "replace-history", history: [] }),
      );
      return;
    }
    if (!loadedRootsRef.current.has(activeRootKey)) {
      loadedRootsRef.current.add(activeRootKey);
      historyByRootRef.current.set(activeRootKey, loadHistory(storageRef.current, activeRootKey));
    }
    setState((current) =>
      reduceDebugConsoleState(current, {
        type: "replace-history",
        history: historyByRootRef.current.get(activeRootKey) ?? [],
      }),
    );
  }, [activeRootKey]);

  useEffect(() => {
    if (sessionId === null || consoleOwner === null) {
      outputCursorRef.current = { lastLine: null, seenLines: new WeakSet(), sessionId: null };
      return;
    }
    const cursor = outputCursorRef.current;
    if (cursor.sessionId !== sessionId) {
      cursor.sessionId = sessionId;
      cursor.lastLine = null;
      cursor.seenLines = new WeakSet();
    }
    const previousIndex = cursor.lastLine ? output.lastIndexOf(cursor.lastLine) : -1;
    const start = previousIndex + 1;
    cursor.lastLine = output[output.length - 1] ?? null;
    const unseenOutput = output.slice(start).filter((line) => {
      if (cursor.seenLines.has(line)) return false;
      cursor.seenLines.add(line);
      return true;
    });
    if (unseenOutput.length === 0) return;
    setState((current) =>
      unseenOutput.reduce(
        (next, line) =>
          reduceDebugConsoleState(next, {
            type: "output",
            owner: consoleOwner,
            stream: line.stream,
            text: line.text,
          }),
        current,
      ),
    );
  }, [consoleOwner, output, sessionId]);

  const submit = useCallback(
    async (expression: string) => {
      const requestOwner = ownerRef.current;
      const requestResultOwner = resultOwnerRef.current;
      if (!requestOwner) return;
      const requestRootKey = activeRootKeyRef.current;
      let requestHistory: readonly string[] = [];
      if (requestRootKey) {
        const currentHistory = historyByRootRef.current.get(requestRootKey) ?? [];
        requestHistory = appendDebugConsoleHistory(currentHistory, expression);
        historyByRootRef.current.set(requestRootKey, requestHistory);
        if (requestHistory !== currentHistory) {
          saveHistory(storageRef.current, requestRootKey, requestHistory);
        }
      }
      requestIdRef.current += 1;
      const requestId = `repl-${requestIdRef.current}`;
      setState((current) => {
        const rooted = reduceDebugConsoleState(current, {
          type: "replace-history",
          history: requestHistory,
        });
        return reduceDebugConsoleState(rooted, {
          type: "evaluation-pending",
          owner: requestOwner,
          requestId,
          expression,
          ...(requestResultOwner ? { resultOwner: requestResultOwner } : {}),
        });
      });
      let result: DebugEvaluationResult;
      try {
        const value = await evaluate(expression);
        if (!value) {
          setState((current) =>
            reduceDebugConsoleState(current, {
              type: "cancel-evaluation",
              owner: requestOwner,
              requestId,
            }),
          );
          return;
        }
        result = {
          status: "ok",
          value: value.value,
          type: value.type,
          variablesReference: value.variablesReference,
        };
      } catch (error) {
        result = {
          status: "error",
          kind: "exception",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (
        ownerRef.current?.sessionId !== requestOwner.sessionId ||
        ownerRef.current.pauseGeneration !== requestOwner.pauseGeneration
      )
        return;
      setState((current) =>
        reduceDebugConsoleState(current, {
          type: "evaluation-settled",
          owner: requestOwner,
          requestId,
          result,
        }),
      );
    },
    [evaluate],
  );

  const clear = useCallback(() => {
    const currentOwner = consoleOwnerRef.current;
    if (currentOwner)
      setState((current) =>
        reduceDebugConsoleState(current, { type: "clear", owner: currentOwner }),
      );
  }, []);
  const activeHistory = activeRootKey ? (historyByRootRef.current.get(activeRootKey) ?? []) : [];
  return {
    resultOwner: currentResultOwner,
    state: { ...state, history: activeHistory },
    clear,
    submit,
  };
}

function storageKey(rootKey: string): string {
  return `${STORAGE_KEY_PREFIX}${rootKey}`;
}

function loadHistory(storage: DebugConsoleStorage | undefined, rootKey: string): readonly string[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(storageKey(rootKey));
    return raw === null ? [] : deserializeDebugConsoleHistory(raw);
  } catch {
    return [];
  }
}

function saveHistory(
  storage: DebugConsoleStorage | undefined,
  rootKey: string,
  history: readonly string[],
): void {
  try {
    const target = storage ?? window.localStorage;
    if (history.length === 0) {
      target.removeItem(storageKey(rootKey));
      return;
    }
    target.setItem(storageKey(rootKey), serializeDebugConsoleHistory(history));
  } catch {
    return;
  }
}

function snapshotResultOwner(
  owner: Omit<DebugConsoleResultOwner, "epoch"> | null | undefined,
): Omit<DebugConsoleResultOwner, "epoch"> | null {
  return owner ? { ...owner } : null;
}

function resultOwnersEqual(
  left: Omit<DebugConsoleResultOwner, "epoch"> | null,
  right: Omit<DebugConsoleResultOwner, "epoch"> | null | undefined,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right != null &&
      left.rootKey === right.rootKey &&
      left.workspaceOwnerKey === right.workspaceOwnerKey &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration &&
      left.frameId === right.frameId)
  );
}
