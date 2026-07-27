import { describe, expect, it } from "vitest";
import type { DebugVariable } from "./debug";
import {
  reconcileDebugVariableMutation,
  selectDebugVariableMutationCandidate,
} from "./debugVariableMutation";
import type { DebugInspectionOwner, DebugVariablePagesState } from "./debugVariablePages";
import { reduceDebugVariablePages } from "./debugVariablePages";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 1,
  pauseGeneration: 2,
  frameId: 3,
};

function variable(
  name: string,
  value: string,
  variablesReference: number,
  canSetValue: true | undefined = undefined,
): DebugVariable {
  return { name, value, variablesReference, ...(canSetValue ? { canSetValue } : {}) };
}

function state(): DebugVariablePagesState {
  const selected = variable("duplicate", "old", 30, true);
  const sibling = variable("duplicate", "sibling", 0, true);
  const otherPage = variable("duplicate", "other page", 0, true);
  const otherParent = variable("duplicate", "other parent", 0, true);
  return {
    owner,
    references: {
      20: {
        pages: {
          0: { start: 0, variables: [selected, sibling], nextStart: 2 },
          2: { start: 2, variables: [otherPage], nextStart: null },
        },
        pending: { 3: "late-parent" },
        errors: {},
        limit: null,
      },
      21: {
        pages: { 0: { start: 0, variables: [otherParent], nextStart: null } },
        pending: {},
        errors: {},
        limit: null,
      },
      30: {
        pages: { 0: { start: 0, variables: [variable("child", "old", 31)], nextStart: null } },
        pending: { 1: "old-child-pending" },
        errors: {},
        limit: null,
      },
      31: {
        pages: { 0: { start: 0, variables: [variable("leaf", "old", 0)], nextStart: null } },
        pending: {},
        errors: {},
        limit: null,
      },
      40: {
        pages: {
          0: { start: 0, variables: [variable("new child", "cached", 41)], nextStart: null },
        },
        pending: {},
        errors: {},
        limit: null,
      },
      41: {
        pages: { 0: { start: 0, variables: [variable("new leaf", "cached", 0)], nextStart: null } },
        pending: {},
        errors: {},
        limit: null,
      },
    },
    pendingCount: 2,
    totalVariables: 9,
    totalBytes: 999,
  };
}

describe("debug variable mutation reconciliation", () => {
  it("creates only a frozen writable candidate for the exact row metadata", () => {
    const current = state();
    const candidate = selectDebugVariableMutationCandidate(current, owner, 20, 0, 0);
    expect(candidate).not.toBeNull();
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate?.variable)).toBe(true);
    expect(candidate?.variable).toMatchObject({ name: "duplicate", value: "old" });
    expect(selectDebugVariableMutationCandidate(current, owner, 20, 0, 99)).toBeNull();
    expect(
      selectDebugVariableMutationCandidate(current, { ...owner, pauseGeneration: 9 }, 20, 0, 0),
    ).toBeNull();
    expect(selectDebugVariableMutationCandidate(current, owner, 30, 0, 0)).toBeNull();
  });

  it("invalidates both parent filters and the old and new child trees", () => {
    const current = state();
    const candidate = selectDebugVariableMutationCandidate(current, owner, 20, 0, 0)!;
    const result = variable("duplicate", "updated", 40, true);
    const next = reconcileDebugVariableMutation(current, candidate, result);

    expect(next).not.toBe(current);
    expect(next.references[20]).toBeUndefined();
    expect(next.references[21]).toBeUndefined();
    expect(next.references[30]).toBeUndefined();
    expect(next.references[31]).toBeUndefined();
    expect(next.references[40]).toBeUndefined();
    expect(next.references[41]).toBeUndefined();
    expect(next.pendingCount).toBe(0);
    expect(next.totalVariables).toBe(0);
    expect(next.totalBytes).toBe(0);

    const afterLateParentReply = reduceDebugVariablePages(next, {
      type: "resolve",
      owner,
      variablesReference: 20,
      start: 3,
      requestId: "late-parent",
      result: {
        variablesReference: 20,
        start: 3,
        variables: [variable("duplicate", "stale overwrite", 0, true)],
        nextStart: null,
      },
    });
    expect(afterLateParentReply).toBe(next);
  });

  it("fails closed for stale identity, owner, and mismatched result names", () => {
    const current = state();
    const candidate = selectDebugVariableMutationCandidate(current, owner, 20, 0, 0)!;
    const replacedRow = {
      ...current,
      references: {
        ...current.references,
        20: {
          ...current.references[20]!,
          pages: {
            ...current.references[20]!.pages,
            0: {
              ...current.references[20]!.pages[0]!,
              variables: [...current.references[20]!.pages[0]!.variables],
            },
          },
        },
      },
    };
    replacedRow.references[20]!.pages[0]!.variables[0] = variable("duplicate", "foreign", 0, true);
    expect(reconcileDebugVariableMutation(replacedRow, candidate, candidate.variable)).toBe(
      replacedRow,
    );
    const staleOwner = { ...current, owner: { ...owner, frameId: 99 } };
    expect(reconcileDebugVariableMutation(staleOwner, candidate, candidate.variable)).toBe(
      staleOwner,
    );
    expect(reconcileDebugVariableMutation(current, candidate, variable("other", "x", 0))).toBe(
      current,
    );
  });

  it("evicts a same-reference cyclic subtree and fences its late pending load", () => {
    const current = state();
    const cyclic: DebugVariablePagesState = {
      ...current,
      references: {
        ...current.references,
        31: {
          pages: {
            0: { start: 0, variables: [variable("cycle", "old", 30)], nextStart: null },
          },
          pending: { 1: "late-child" },
          errors: {},
          limit: null,
        },
      },
      pendingCount: 3,
    };
    const candidate = selectDebugVariableMutationCandidate(cyclic, owner, 20, 0, 0)!;
    const next = reconcileDebugVariableMutation(
      cyclic,
      candidate,
      variable("duplicate", "updated", 30, true),
    );
    expect(next.references[30]).toBeUndefined();
    expect(next.references[31]).toBeUndefined();
    expect(next.pendingCount).toBe(0);

    const afterLateReply = reduceDebugVariablePages(next, {
      type: "resolve",
      owner,
      variablesReference: 31,
      start: 1,
      requestId: "late-child",
      result: {
        variablesReference: 31,
        start: 1,
        variables: [variable("late", "reply", 0)],
        nextStart: null,
      },
    });
    expect(afterLateReply).toBe(next);
  });
});
