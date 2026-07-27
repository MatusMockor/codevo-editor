import { useCallback, useMemo, type MutableRefObject } from "react";
import type { DebugVariable, DebugVariableFilter } from "../domain/debug";
import {
  debugVariableMutationCandidateIsCurrent,
  selectDebugVariableMutationCandidate,
} from "../domain/debugVariableMutation";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import type { DebugVariableMutationRows, DebugVariableRowMutation } from "./debugSessionContracts";

interface DebugVariableMutationRowsOptions {
  readonly loadVariablePage: (
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
    filter: DebugVariableFilter,
  ) => Promise<void>;
  readonly setVariable: (
    variablesReference: number,
    name: string,
    value: string,
  ) => Promise<DebugVariable | null>;
  readonly variablePagesRef: MutableRefObject<DebugVariablePagesState>;
}

export function useDebugVariableMutationRows({
  loadVariablePage,
  setVariable,
  variablePagesRef,
}: DebugVariableMutationRowsOptions) {
  const forRow = useCallback(
    (
      owner: DebugInspectionOwner,
      parentVariablesReference: number,
      pageStart: number,
      index: number,
      filter: DebugVariableFilter = "named",
    ): DebugVariableRowMutation | null => {
      const candidate = selectDebugVariableMutationCandidate(
        variablePagesRef.current,
        owner,
        parentVariablesReference,
        pageStart,
        index,
        filter,
      );
      if (!candidate) return null;
      const ownedCandidate = candidate;
      return Object.freeze({
        currentValue: ownedCandidate.variable.value,
        async commit(nextValue: string) {
          if (!debugVariableMutationCandidateIsCurrent(variablePagesRef.current, ownedCandidate)) {
            return null;
          }
          let result: DebugVariable | null;
          try {
            result = await setVariable(
              ownedCandidate.parentVariablesReference,
              ownedCandidate.variable.name,
              nextValue,
            );
          } catch (error) {
            reloadAfterDispatchedMutation();
            throw error;
          }
          if (!result) {
            reloadAfterDispatchedMutation();
            return null;
          }
          reloadAfterDispatchedMutation();
          return result;
        },
      });

      function reloadAfterDispatchedMutation(): void {
        const current = variablePagesRef.current;
        if (
          !debugInspectionOwnersEqual(current.owner, ownedCandidate.owner) ||
          Object.keys(current.references).length !== 0
        ) {
          return;
        }
        void (async () => {
          await loadVariablePage(
            ownedCandidate.owner,
            ownedCandidate.parentVariablesReference,
            0,
            "named",
          );
          await loadVariablePage(
            ownedCandidate.owner,
            ownedCandidate.parentVariablesReference,
            ownedCandidate.filter === "indexed" ? ownedCandidate.pageStart : 0,
            "indexed",
          );
        })();
      }
    },
    [loadVariablePage, setVariable, variablePagesRef],
  );
  return useMemo<DebugVariableMutationRows>(() => Object.freeze({ forRow }), [forRow]);
}
