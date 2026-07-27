import { describe, expect, it } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { buildRows, resolveActiveRow, type TreeRow } from "./debugVariableTreeRows";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};

function pages(variables: readonly DebugVariable[]): DebugVariablePagesState {
  return {
    owner,
    references: {
      10: {
        pages: { 0: { start: 0, variables, nextStart: null } },
        pending: {},
        errors: {},
        limit: null,
      },
    },
    pendingCount: 0,
    totalVariables: variables.length,
    totalBytes: 0,
  };
}

function rowsFor(
  variables: readonly DebugVariable[],
  maxRows = 500,
  expandedIds: ReadonlySet<string> = new Set(["root:local"]),
): TreeRow[] {
  return buildRows({
    expandedIds,
    maxRows,
    paged: true,
    roots: [{ id: "local", label: "Local", owner, variablesReference: 10 }],
    variablePages: pages(variables),
    variableMutationRows: undefined,
    variablesByReference: {},
  });
}

describe("debugVariableTreeRows", () => {
  it("builds expanded rows and preserves the model display limit", () => {
    const variables = Array.from({ length: 700 }, (_, index) => ({
      name: `value${index}`,
      value: String(index),
      variablesReference: 0,
    }));

    const rows = rowsFor(variables);

    expect(rows).toHaveLength(500);
    expect(rows[0]).toMatchObject({
      id: "root:local",
      kind: "node",
      expanded: true,
      label: "Local",
    });
    expect(rows[1]).toMatchObject({
      id: "root:local/0:value0",
      parentId: "root:local",
      label: "value0",
      value: "0",
    });
    expect(rows[rows.length - 1]).toMatchObject({
      kind: "status",
      label: "Display limit reached",
    });
  });

  it("resolves disappearing active rows to appended content and replacement states", () => {
    const first = { name: "first", value: "1", variablesReference: 0 } as const;
    const previousRows = rowsFor([first]);
    const loadMore: TreeRow = {
      id: "root:local/action:100",
      parentId: "root:local",
      depth: 1,
      kind: "action",
      label: "Load more",
      owner,
      variablesReference: 10,
      expandable: false,
      expanded: false,
    };
    const previousWithAction = [...previousRows, loadMore];
    const appendedRows = rowsFor([first, { name: "second", value: "2", variablesReference: 0 }]);

    expect(resolveActiveRow(loadMore.id, appendedRows, previousWithAction)).toBe(
      "root:local/1:second",
    );

    const loading: TreeRow = {
      ...loadMore,
      id: "root:local/status:Loading…",
      kind: "status",
      label: "Loading…",
      owner: null,
      variablesReference: 0,
    };
    expect(resolveActiveRow(loadMore.id, [...previousRows, loading], previousWithAction)).toBe(
      loading.id,
    );
    expect(resolveActiveRow("missing", previousRows, [])).toBe("root:local");
  });

  it("shows the retained-cap receipt together with the next page action", () => {
    const variablePages: DebugVariablePagesState = {
      owner,
      references: {
        10: {
          pages: {
            0: {
              start: 0,
              filter: "named",
              variables: [{ name: "0", value: "entry", variablesReference: 0 }],
              nextStart: 100,
              total: null,
              truncated: true,
              limitReason: "descriptor-count",
            },
          },
          pending: {},
          errors: {},
          limit: null,
        },
      },
      pendingCount: 0,
      totalVariables: 1,
      totalBytes: 0,
    };

    const rows = buildRows({
      expandedIds: new Set(["root:local"]),
      maxRows: 500,
      paged: true,
      roots: [{ id: "local", label: "Local", owner, variablesReference: 10 }],
      variablePages,
      variableMutationRows: undefined,
      variablesByReference: {},
    });

    expect(rows.map((row) => row.label)).toContain("Limit reached: descriptor count");
    expect(rows.map((row) => row.label)).toContain("Load more");
  });
});
