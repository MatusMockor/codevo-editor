import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugVariable } from "../domain/debug";
import {
  createDebugConsoleState,
  reduceDebugConsoleState,
  type DebugConsoleResultOwner,
  type DebugConsoleState,
} from "../domain/debugConsoleState";
import type { DebugEvaluationOwner, DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebugOutputLine } from "./debugSessionContracts";

export interface UseDebugConsoleOptions {
  evaluate(expression: string): Promise<DebugVariable | null>;
  output: readonly DebugOutputLine[];
  owner: DebugEvaluationOwner | null;
  resultOwner?: Omit<DebugConsoleResultOwner, "epoch"> | null;
  sessionId: number | null;
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
  const outputCursorRef = useRef<{
    lastLine: DebugOutputLine | null;
    seenLines: WeakSet<DebugOutputLine>;
    sessionId: number | null;
  }>({ lastLine: null, seenLines: new WeakSet(), sessionId });
  const requestIdRef = useRef(0);

  useEffect(() => {
    setState((current) => reduceDebugConsoleState(current, { type: "own", owner: consoleOwner }));
  }, [consoleOwner]);

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
      requestIdRef.current += 1;
      const requestId = `repl-${requestIdRef.current}`;
      setState((current) =>
        reduceDebugConsoleState(current, {
          type: "evaluation-pending",
          owner: requestOwner,
          requestId,
          expression,
          ...(requestResultOwner ? { resultOwner: requestResultOwner } : {}),
        }),
      );
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
  return { resultOwner: currentResultOwner, state, clear, submit };
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
