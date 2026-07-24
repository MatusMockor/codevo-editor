import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DebugVariable } from "../domain/debug";
import {
  debugVariableMutationInvalidatedReferences,
  debugVariableMutationCandidateIsCurrent,
  reconcileDebugVariableMutation,
  selectDebugVariableMutationCandidate,
} from "../domain/debugVariableMutation";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import type { DebugVariableMutationRows, DebugVariableRowMutation } from "./debugSessionContracts";

interface DebugVariableMutationRowsOptions {
  readonly setVariable: (
    variablesReference: number,
    name: string,
    value: string,
  ) => Promise<DebugVariable | null>;
  readonly setVariablePages: Dispatch<SetStateAction<DebugVariablePagesState>>;
  readonly variablePagesRef: MutableRefObject<DebugVariablePagesState>;
  readonly variablePageRequestsRef: MutableRefObject<Map<string, string>>;
}

export function useDebugVariableMutationRows({
  setVariable,
  setVariablePages,
  variablePageRequestsRef,
  variablePagesRef,
}: DebugVariableMutationRowsOptions) {
  const forRow = useCallback(
    (
      owner: DebugInspectionOwner,
      parentVariablesReference: number,
      pageStart: number,
      index: number,
    ): DebugVariableRowMutation | null => {
      const candidate = selectDebugVariableMutationCandidate(
        variablePagesRef.current,
        owner,
        parentVariablesReference,
        pageStart,
        index,
      );
      if (!candidate) return null;
      return Object.freeze({
        currentValue: candidate.variable.value,
        async commit(nextValue: string) {
          if (!debugVariableMutationCandidateIsCurrent(variablePagesRef.current, candidate)) {
            return null;
          }
          const result = await setVariable(
            candidate.parentVariablesReference,
            candidate.variable.name,
            nextValue,
          );
          if (!result) return null;
          const current = variablePagesRef.current;
          const next = reconcileDebugVariableMutation(current, candidate, result);
          if (next === current) return null;
          invalidateVariablePageRequests(
            variablePageRequestsRef.current,
            candidate.owner,
            debugVariableMutationInvalidatedReferences(current, candidate, result),
          );
          variablePagesRef.current = next;
          setVariablePages(next);
          return result;
        },
      });
    },
    [setVariable, setVariablePages, variablePageRequestsRef, variablePagesRef],
  );
  return useMemo<DebugVariableMutationRows>(() => Object.freeze({ forRow }), [forRow]);
}

function invalidateVariablePageRequests(
  requests: Map<string, string>,
  owner: DebugInspectionOwner,
  references: ReadonlySet<number>,
): void {
  const prefix = `${owner.rootKey}\0${owner.sessionId}\0${owner.pauseGeneration}\0${owner.frameId}\0`;
  for (const key of requests.keys()) {
    if (!key.startsWith(prefix)) continue;
    const reference = Number(key.slice(prefix.length).split("\0", 1)[0]);
    if (references.has(reference)) requests.delete(key);
  }
}
