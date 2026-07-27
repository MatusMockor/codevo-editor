import type { DebugVariable, DebugVariableFilter } from "./debug";
import {
  createDebugVariablePagesState,
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "./debugVariablePages";

export interface DebugVariableMutationCandidate {
  readonly owner: DebugInspectionOwner;
  readonly parentVariablesReference: number;
  readonly pageStart: number;
  readonly filter: DebugVariableFilter;
  readonly index: number;
  readonly rowIdentity: DebugVariable;
  readonly variable: Readonly<DebugVariable & { readonly canSetValue: true }>;
}

export function selectDebugVariableMutationCandidate(
  state: DebugVariablePagesState,
  owner: DebugInspectionOwner,
  parentVariablesReference: number,
  pageStart: number,
  index: number,
  filter: DebugVariableFilter = "named",
): DebugVariableMutationCandidate | null {
  if (!debugInspectionOwnersEqual(state.owner, owner)) return null;
  const row =
    state.references[parentVariablesReference]?.pages[variablePageKey(filter, pageStart)]
      ?.variables[index];
  if (!row || row.canSetValue !== true) return null;
  return Object.freeze({
    owner: Object.freeze({ ...owner }),
    parentVariablesReference,
    pageStart,
    filter,
    index,
    rowIdentity: row,
    variable: Object.freeze({ ...row, canSetValue: true as const }),
  });
}

export function debugVariableMutationCandidateIsCurrent(
  state: DebugVariablePagesState,
  candidate: DebugVariableMutationCandidate,
): boolean {
  return (
    debugInspectionOwnersEqual(state.owner, candidate.owner) &&
    state.references[candidate.parentVariablesReference]?.pages[
      variablePageKey(candidate.filter, candidate.pageStart)
    ]?.variables[candidate.index] === candidate.rowIdentity
  );
}

export function reconcileDebugVariableMutation(
  state: DebugVariablePagesState,
  candidate: DebugVariableMutationCandidate,
  result: DebugVariable,
): DebugVariablePagesState {
  if (
    !debugVariableMutationCandidateIsCurrent(state, candidate) ||
    result.name !== candidate.variable.name
  ) {
    return state;
  }
  return createDebugVariablePagesState(state.owner);
}

function variablePageKey(filter: DebugVariableFilter, start: number): string {
  return filter === "named" ? String(start) : `indexed:${start}`;
}

export function debugVariableMutationInvalidatedReferences(
  state: DebugVariablePagesState,
  candidate: DebugVariableMutationCandidate,
  result: DebugVariable,
): Set<number> {
  if (
    !debugVariableMutationCandidateIsCurrent(state, candidate) ||
    result.name !== candidate.variable.name
  ) {
    return new Set();
  }
  const invalidated = collectDescendantReferences(
    state.references,
    [candidate.variable.variablesReference, result.variablesReference],
    candidate.parentVariablesReference,
  );
  invalidated.add(candidate.parentVariablesReference);
  return invalidated;
}

function collectDescendantReferences(
  references: DebugVariablePagesState["references"],
  roots: readonly number[],
  protectedReference: number,
): Set<number> {
  const collected = new Set<number>();
  const pending = roots.filter((reference) => reference > 0 && reference !== protectedReference);
  while (pending.length > 0) {
    const reference = pending.pop()!;
    if (collected.has(reference)) continue;
    collected.add(reference);
    const cached = references[reference];
    if (!cached) continue;
    for (const page of Object.values(cached.pages)) {
      for (const variable of page.variables) {
        if (
          variable.variablesReference > 0 &&
          variable.variablesReference !== protectedReference &&
          !collected.has(variable.variablesReference)
        ) {
          pending.push(variable.variablesReference);
        }
      }
    }
  }
  return collected;
}
