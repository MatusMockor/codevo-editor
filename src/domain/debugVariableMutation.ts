import type { DebugVariable } from "./debug";
import { debugUtf8ByteLength } from "./debugEvaluationPolicy";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "./debugVariablePages";

export interface DebugVariableMutationCandidate {
  readonly owner: DebugInspectionOwner;
  readonly parentVariablesReference: number;
  readonly pageStart: number;
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
): DebugVariableMutationCandidate | null {
  if (!debugInspectionOwnersEqual(state.owner, owner)) return null;
  const row = state.references[parentVariablesReference]?.pages[pageStart]?.variables[index];
  if (!row || row.canSetValue !== true) return null;
  return Object.freeze({
    owner: Object.freeze({ ...owner }),
    parentVariablesReference,
    pageStart,
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
    state.references[candidate.parentVariablesReference]?.pages[candidate.pageStart]?.variables[
      candidate.index
    ] === candidate.rowIdentity
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
  const sourceReference = state.references[candidate.parentVariablesReference]!;
  const sourcePage = sourceReference.pages[candidate.pageStart]!;
  const nextVariables = [...sourcePage.variables];
  nextVariables[candidate.index] = Object.freeze({ ...result });
  const references = { ...state.references };
  references[candidate.parentVariablesReference] = {
    ...sourceReference,
    pending: {},
    pages: {
      ...sourceReference.pages,
      [candidate.pageStart]: { ...sourcePage, variables: nextVariables },
    },
  };

  const invalidated = debugVariableMutationInvalidatedReferences(state, candidate, result);
  invalidated.delete(candidate.parentVariablesReference);
  for (const reference of invalidated) delete references[reference];

  let pendingCount = 0;
  let totalVariables = 0;
  let totalBytes = 0;
  for (const reference of Object.values(references)) {
    pendingCount += Object.keys(reference.pending).length;
    for (const page of Object.values(reference.pages)) {
      totalVariables += page.variables.length;
      totalBytes += page.variables.reduce((total, variable) => total + variableBytes(variable), 0);
    }
  }
  return { ...state, references, pendingCount, totalVariables, totalBytes };
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

function variableBytes(variable: DebugVariable): number {
  return (
    debugUtf8ByteLength(variable.name) +
    debugUtf8ByteLength(variable.value) +
    debugUtf8ByteLength(variable.type ?? "") +
    debugUtf8ByteLength(variable.evaluateName ?? "")
  );
}
