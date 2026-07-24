import { useCallback, useEffect, useRef, useState } from "react";
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
}: UseDebugConsoleOptions): UseDebugConsoleResult {
  const [state, setState] = useState(() => createDebugConsoleState(owner));
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
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
  const sessionId = owner?.sessionId ?? null;
  const pauseGeneration = owner?.pauseGeneration ?? null;
  const outputCursorRef = useRef<{
    lastLine: DebugOutputLine | null;
    sessionId: number | null;
  }>({ lastLine: null, sessionId: owner?.sessionId ?? null });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const nextOwner =
      sessionId === null || pauseGeneration === null ? null : { sessionId, pauseGeneration };
    setState((current) => reduceDebugConsoleState(current, { type: "own", owner: nextOwner }));
  }, [pauseGeneration, sessionId]);

  useEffect(() => {
    if (sessionId === null || pauseGeneration === null) {
      outputCursorRef.current = { lastLine: null, sessionId: null };
      return;
    }
    const outputOwner = { sessionId, pauseGeneration };
    const cursor = outputCursorRef.current;
    if (cursor.sessionId !== sessionId) {
      cursor.sessionId = sessionId;
      cursor.lastLine = null;
    }
    const previousIndex = cursor.lastLine ? output.lastIndexOf(cursor.lastLine) : -1;
    const start = previousIndex + 1;
    cursor.lastLine = output[output.length - 1] ?? null;
    if (start === output.length) return;
    setState((current) =>
      output.slice(start).reduce(
        (next, line) =>
          reduceDebugConsoleState(next, {
            type: "output",
            owner: outputOwner,
            stream: line.stream,
            text: line.text,
          }),
        current,
      ),
    );
  }, [output, pauseGeneration, sessionId]);

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
    const currentOwner = ownerRef.current;
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
