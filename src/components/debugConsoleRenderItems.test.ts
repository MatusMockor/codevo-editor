import { describe, expect, it } from "vitest";
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

const INSPECTION_OWNER: DebugInspectionOwner = {
  frameId: 11,
  pauseGeneration: 1,
  rootKey: "/workspace",
  sessionId: 7,
};
const RESULT_OWNER: DebugConsoleResultOwner = {
  ...INSPECTION_OWNER,
  epoch: 3,
  workspaceOwnerKey: "workspace-owner",
};

describe("buildDebugConsoleRenderItems", () => {
  it("places one exhaustion marker after the last allowed expanded variable", () => {
    const variables = Array.from(
      { length: MAX_DEBUG_CONSOLE_RESULT_ROWS + 1 },
      (_value, index) => ({
        name: `item-${index}`,
        value: String(index),
        variablesReference: 0,
      }),
    );
    const items = build({
      entries: [resultEntry("result-1", 41)],
      variablePages: pages(41, variables),
    });
    const variablesItems = items.filter((item) => item.kind === "result-variable");
    const lastVariable = variablesItems[variablesItems.length - 1]!;
    const marker = items.find((item) => item.kind === "result-status");

    expect(variablesItems).toHaveLength(MAX_DEBUG_CONSOLE_RESULT_ROWS);
    expect(lastVariable.id).toBe("result-1/499:item-499");
    expect(marker).toMatchObject({
      depth: 1,
      entryId: "result-1",
      id: "result-1/limit",
      kind: "result-status",
      label: "Display limit reached",
    });
    expect(items.indexOf(marker!)).toBe(items.indexOf(lastVariable) + 1);
  });

  it("fails closed when the result owner or inspection epoch is stale", () => {
    const entry = resultEntry("result-1", 41);
    const variablePages = pages(41, [{ name: "child", value: "1", variablesReference: 0 }]);

    const staleCurrent = build({
      currentResultOwner: { ...RESULT_OWNER, epoch: RESULT_OWNER.epoch + 1 },
      entries: [entry],
      variablePages,
    });
    const staleInspection = build({
      entries: [entry],
      inspectionOwner: { ...INSPECTION_OWNER, pauseGeneration: 2 },
      variablePages,
    });

    for (const items of [staleCurrent, staleInspection]) {
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        entryId: "result-1",
        expandable: false,
        expanded: false,
        kind: "entry",
        resultInspectionOwner: null,
      });
    }
  });

  it("keeps expansion paths and ids stable while flattening nested references", () => {
    const variablePages = pages(
      41,
      [
        { name: "nested", value: "Object", variablesReference: 42 },
        { name: "leaf", value: "2", variablesReference: 0 },
      ],
      {
        42: referencePages([{ name: "deep", value: "true", variablesReference: 0 }]),
      },
    );
    const items = build({
      entries: [resultEntry("result-1", 41)],
      expandedResultIds: new Set(["result-1", "result-1/0:nested"]),
      variablePages,
    });

    expect(items.map((item) => item.id)).toEqual([
      "result-1",
      "result-1/0:nested",
      "result-1/0:nested/0:deep",
      "result-1/1:leaf",
    ]);
    expect(items[1]).toMatchObject({
      ancestors: [41],
      depth: 1,
      expandable: true,
      expanded: true,
      kind: "result-variable",
    });
    expect(items[2]).toMatchObject({
      ancestors: [41, 42],
      depth: 2,
      kind: "result-variable",
    });
  });
});

function build(overrides: Partial<Parameters<typeof buildDebugConsoleRenderItems>[0]> = {}) {
  return buildDebugConsoleRenderItems({
    currentResultOwner: RESULT_OWNER,
    entries: [],
    expandedResultIds: new Set(["result-1"]),
    inspectionOwner: INSPECTION_OWNER,
    resultTreeEnabled: true,
    variablePages: undefined,
    workspaceOwnerKey: "workspace-owner",
    ...overrides,
  });
}

function resultEntry(id: string, variablesReference: number): DebugConsoleEntry {
  return {
    id,
    kind: "result",
    owner: { pauseGeneration: 1, sessionId: 7 },
    requestId: `request-${id}`,
    resultOwner: RESULT_OWNER,
    sequence: 1,
    value: "Object",
    valueType: "object",
    variablesReference,
  };
}

function pages(
  variablesReference: number,
  variables: readonly {
    readonly name: string;
    readonly value: string;
    readonly variablesReference: number;
  }[],
  additionalReferences: DebugVariablePagesState["references"] = {},
): DebugVariablePagesState {
  return {
    owner: INSPECTION_OWNER,
    pendingCount: 0,
    references: {
      ...additionalReferences,
      [variablesReference]: referencePages(variables),
    },
    totalBytes: 0,
    totalVariables: variables.length,
  };
}

function referencePages(
  variables: readonly {
    readonly name: string;
    readonly value: string;
    readonly variablesReference: number;
  }[],
): DebugVariableReferencePages {
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
