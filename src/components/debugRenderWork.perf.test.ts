import { describe, expect, it } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugConsoleEntry, DebugConsoleResultOwner } from "../domain/debugConsoleState";
import type {
  DebugInspectionOwner,
  DebugVariablePagesState,
  DebugVariableReferencePages,
} from "../domain/debugVariablePages";
import {
  buildDebugConsoleRenderItems,
  MAX_DEBUG_CONSOLE_RESULT_ROWS,
} from "./debugConsoleRenderItems";
import { buildRows } from "./debugVariableTreeRows";

const INSPECTION_OWNER: DebugInspectionOwner = {
  frameId: 11,
  pauseGeneration: 3,
  rootKey: "/workspace",
  sessionId: 7,
};

const RESULT_OWNER: DebugConsoleResultOwner = {
  ...INSPECTION_OWNER,
  epoch: 5,
  workspaceOwnerKey: "workspace-owner",
};

describe("debug render work bounds", () => {
  it("caps a 10,000-node variable tree after 500 sibling entry visits", () => {
    let childReads = 0;
    const children = countedArray(
      Array.from({ length: 9_999 }, (_value, index): DebugVariable => {
        return {
          name: `child-${index}`,
          value: String(index),
          variablesReference: index + 2,
        };
      }),
      () => {
        childReads += 1;
      },
    );
    let expansionChecks = 0;
    let referenceReads = 0;
    const expandedIds = countingReadonlySet(new Set(["root:adversarial"]), () => {
      expansionChecks += 1;
    });
    const variablesByReference = new Proxy<Record<number, readonly DebugVariable[]>>(
      { 1: children },
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            referenceReads += 1;
          }

          return Reflect.get(target, property, receiver);
        },
      },
    );

    const rows = buildRows({
      expandedIds,
      maxRows: 500,
      paged: false,
      roots: [
        {
          id: "adversarial",
          label: "Adversarial",
          owner: INSPECTION_OWNER,
          variablesReference: 1,
        },
      ],
      variableMutationRows: undefined,
      variablePages: undefined,
      variablesByReference,
    });

    expect(rows).toHaveLength(500);
    expect(rows[rows.length - 1]).toMatchObject({
      kind: "status",
      label: "Display limit reached",
    });
    expect(expansionChecks).toBeLessThanOrEqual(500);
    expect(referenceReads).toBeLessThanOrEqual(500);
    expect(childReads).toBeLessThanOrEqual(500);
  });

  it("caps deep console expansion work across 1,000 entries", () => {
    let variableReads = 0;
    const references: Record<number, DebugVariableReferencePages> = {};

    for (let variablesReference = 1; variablesReference <= 32; variablesReference += 1) {
      references[variablesReference] = referencePages(
        countedVariables(
          [
            {
              name: `depth-${variablesReference}`,
              value: "Object",
              variablesReference: variablesReference + 1,
            },
          ],
          () => {
            variableReads += 1;
          },
        ),
      );
    }

    let entryReads = 0;
    const entries = countedArray(
      Array.from({ length: 1_000 }, (_value, index): DebugConsoleEntry => {
        return {
          id: `result-${index}`,
          kind: "result",
          owner: { pauseGeneration: 3, sessionId: 7 },
          requestId: `request-${index}`,
          resultOwner: RESULT_OWNER,
          sequence: index + 1,
          value: "Object",
          valueType: "object",
          variablesReference: 1,
        };
      }),
      () => {
        entryReads += 1;
      },
    );
    const expandedIds = new Set(entries.map((entry) => entry.id));

    for (let entryIndex = 0; entryIndex < 16; entryIndex += 1) {
      let id = `result-${entryIndex}`;

      for (let depth = 1; depth <= 32; depth += 1) {
        id = `${id}/0:depth-${depth}`;
        expandedIds.add(id);
      }
    }

    entryReads = 0;
    let expansionChecks = 0;
    const expandedResultIds = countingReadonlySet(expandedIds, () => {
      expansionChecks += 1;
    });
    const variablePages: DebugVariablePagesState = {
      owner: INSPECTION_OWNER,
      pendingCount: 0,
      references,
      totalBytes: 0,
      totalVariables: 32,
    };

    const items = buildDebugConsoleRenderItems({
      currentResultOwner: RESULT_OWNER,
      entries,
      expandedResultIds,
      inspectionOwner: INSPECTION_OWNER,
      resultTreeEnabled: true,
      variablePages,
      workspaceOwnerKey: "workspace-owner",
    });
    const variableItems = items.filter((item) => item.kind === "result-variable");

    expect(variableItems.length).toBeLessThanOrEqual(MAX_DEBUG_CONSOLE_RESULT_ROWS);
    expect(variableItems).toHaveLength(500);
    expect(entryReads).toBe(1_000);
    expect(variableReads).toBeLessThanOrEqual(1_600);
    expect(expansionChecks).toBeLessThanOrEqual(1_600);
  });
});

function referencePages(variables: readonly DebugVariable[]): DebugVariableReferencePages {
  return {
    errors: {},
    limit: null,
    pages: {
      0: {
        nextStart: null,
        start: 0,
        variables,
      },
    },
    pending: {},
  };
}

function countedArray<Value>(values: Value[], onRead: () => void): readonly Value[] {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        onRead();
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function countedVariables(
  variables: DebugVariable[],
  onRead: () => void,
): readonly DebugVariable[] {
  return countedArray(variables, onRead);
}

function countingReadonlySet<Value>(
  values: ReadonlySet<Value>,
  onHas: () => void,
): ReadonlySet<Value> {
  return {
    entries: () => values.entries(),
    forEach: (callback, thisArg) => values.forEach(callback, thisArg),
    has(value) {
      onHas();
      return values.has(value);
    },
    keys: () => values.keys(),
    size: values.size,
    values: () => values.values(),
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}
