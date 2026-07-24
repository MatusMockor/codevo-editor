import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
} from "../application/debugSessionContracts";
import type { DebugVariable } from "../domain/debug";
import {
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariableExpansionState,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";

interface TreeRoot {
  readonly id: string;
  readonly label: string;
  readonly owner: DebugInspectionOwner | null;
  readonly variablesReference: number;
  readonly value?: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly testId?: string;
}

export interface TreeRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly kind: "node" | "action" | "status";
  readonly label: string;
  readonly value?: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly testId?: string;
  readonly owner: DebugInspectionOwner | null;
  readonly variablesReference: number;
  readonly nextStart?: number;
  readonly loadOnExpand?: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly busy?: boolean;
  readonly terminal?: string;
  readonly mutation?: DebugVariableRowMutation;
  readonly rowIdentity?: object;
}

export function stabilizeRowMutations(
  rows: readonly TreeRow[],
  cache: WeakMap<object, DebugVariableRowMutation>,
): TreeRow[] {
  return rows.map((row) => {
    if (!row.rowIdentity || !row.mutation) return row;
    const cached = cache.get(row.rowIdentity);
    if (cached?.currentValue === row.mutation.currentValue) return { ...row, mutation: cached };
    cache.set(row.rowIdentity, row.mutation);
    return row;
  });
}

export function buildRows({
  expandedIds,
  maxRows,
  paged,
  roots,
  variablePages,
  variableMutationRows,
  variablesByReference,
}: {
  expandedIds: ReadonlySet<string>;
  maxRows: number;
  paged: boolean;
  roots: readonly TreeRoot[];
  variablePages: DebugVariablePagesState | undefined;
  variableMutationRows: DebugVariableMutationRows | undefined;
  variablesByReference: Readonly<Record<number, readonly DebugVariable[]>>;
}): TreeRow[] {
  const rows: TreeRow[] = [];
  if (maxRows === 0) return rows;
  let overflowed = false;
  const append = (row: TreeRow) => {
    if (rows.length < maxRows) rows.push(row);
    else overflowed = true;
  };
  const visit = (
    id: string,
    parentId: string | null,
    depth: number,
    label: string,
    value: string | undefined,
    type: string | null | undefined,
    evaluateName: string | undefined,
    adapterEvaluateName: string | undefined,
    variablesReference: number,
    owner: DebugInspectionOwner | null,
    ancestors: readonly number[],
    testId?: string,
    mutation?: DebugVariableRowMutation,
    rowIdentity?: object,
  ) => {
    if (rows.length >= maxRows) {
      overflowed = true;
      return;
    }
    const expansion = expansionFor(
      paged,
      variablePages,
      variablesByReference,
      owner,
      variablesReference,
      ancestors,
      depth,
    );
    const terminalExpansion =
      expansion.kind === "circular" || expansion.kind === "limit" || expansion.kind === "stale";
    const terminal = terminalExpansion ? terminalExpansionLabel(expansion) : undefined;
    const expandable = variablesReference > 0 && expansion.kind !== "leaf" && !terminalExpansion;
    const expanded = expandable && expandedIds.has(id);
    append({
      id,
      parentId,
      depth,
      kind: "node",
      label,
      value,
      type,
      evaluateName,
      adapterEvaluateName,
      testId,
      owner,
      variablesReference,
      expandable,
      expanded,
      busy: expanded && expansion.kind === "loading",
      terminal,
      mutation,
      rowIdentity,
      loadOnExpand: expansion.kind === "idle",
    });
    if (terminalExpansion) return;
    if (!expanded) return;
    const variables = "variables" in expansion ? expansion.variables : [];
    variables.forEach((variable, index) => {
      const location = variablePages
        ? findPagedVariableLocation(variablePages, variablesReference, variable)
        : null;
      const mutation =
        owner && location
          ? (variableMutationRows?.forRow(
              owner,
              variablesReference,
              location.pageStart,
              location.index,
            ) ?? undefined)
          : undefined;
      visit(
        `${id}/${index}:${variable.name}`,
        id,
        depth + 1,
        variable.name,
        variable.value,
        variable.type,
        variable.evaluateName,
        variable.evaluateName,
        variable.variablesReference,
        owner,
        [...ancestors, variablesReference],
        undefined,
        mutation,
        variable,
      );
    });
    if (expansion.kind === "idle" || expansion.kind === "loading") {
      append(statusRow(id, depth + 1, "Loading…"));
    } else if (expansion.kind === "error") {
      append(
        actionRow(
          id,
          depth + 1,
          `Retry: ${expansion.message}`,
          owner,
          variablesReference,
          expansion.nextStart,
        ),
      );
    } else if (expansion.kind === "ready" && expansion.nextStart !== null) {
      append(actionRow(id, depth + 1, "Load more", owner, variablesReference, expansion.nextStart));
    }
  };
  roots.forEach((root) =>
    visit(
      `root:${root.id}`,
      null,
      0,
      root.label,
      root.value,
      root.type,
      root.evaluateName,
      root.adapterEvaluateName,
      root.variablesReference,
      root.owner,
      [],
      root.testId,
      undefined,
      undefined,
    ),
  );
  if (overflowed) {
    rows[maxRows - 1] = statusRow(null, 0, "Display limit reached");
  }
  return rows;
}

function findPagedVariableLocation(
  state: DebugVariablePagesState,
  parentVariablesReference: number,
  variable: DebugVariable,
): { readonly pageStart: number; readonly index: number } | null {
  const pages = state.references[parentVariablesReference]?.pages;
  if (!pages) return null;
  for (const [pageStart, page] of Object.entries(pages)) {
    const index = page.variables.indexOf(variable);
    if (index >= 0) return { pageStart: Number(pageStart), index };
  }
  return null;
}

function expansionFor(
  paged: boolean,
  variablePages: DebugVariablePagesState | undefined,
  variablesByReference: Readonly<Record<number, readonly DebugVariable[]>>,
  owner: DebugInspectionOwner | null,
  variablesReference: number,
  ancestors: readonly number[],
  depth: number,
): DebugVariableExpansionState {
  if (variablesReference <= 0) return { kind: "leaf" };
  if (paged) {
    if (!variablePages || !owner) return { kind: "stale" };
    return selectDebugVariableExpansion(variablePages, owner, variablesReference, ancestors, depth);
  }
  if (ancestors.includes(variablesReference)) return { kind: "circular" };
  if (depth >= 10) return { kind: "limit", reason: "depth" };
  const variables = variablesByReference[variablesReference];
  return variables ? { kind: "ready", variables, nextStart: null } : { kind: "idle", nextStart: 0 };
}

function statusRow(parentId: string | null, depth: number, label: string): TreeRow {
  return {
    id: `${parentId ?? "tree"}/status:${label}`,
    parentId,
    depth,
    kind: "status",
    label,
    owner: null,
    variablesReference: 0,
    expandable: false,
    expanded: false,
  };
}

function actionRow(
  parentId: string,
  depth: number,
  label: string,
  owner: DebugInspectionOwner | null,
  variablesReference: number,
  nextStart: number,
): TreeRow {
  return {
    id: `${parentId}/action:${nextStart}`,
    parentId,
    depth,
    kind: "action",
    label,
    owner,
    variablesReference,
    nextStart,
    expandable: false,
    expanded: false,
  };
}

export function rowAriaLabel(row: TreeRow): string {
  if (row.kind !== "node") return row.label;
  if (row.expandable) return `${row.expanded ? "Collapse" : "Expand"} ${row.label}`;
  const value = row.value === undefined ? "" : `, ${row.value}`;
  const type = row.type ? `, ${row.type}` : "";
  const terminal = row.terminal ? `, ${row.terminal}` : "";
  return `${row.label}${value}${type}${terminal}`;
}

function terminalExpansionLabel(
  expansion: Extract<DebugVariableExpansionState, { kind: "circular" | "limit" | "stale" }>,
): string {
  if (expansion.kind === "circular") return "Circular reference";
  if (expansion.kind === "limit") return `Limit reached: ${expansion.reason}`;
  return "No longer available";
}

export function resolveActiveRow(
  activeId: string | null,
  rows: readonly TreeRow[],
  previousRows: readonly TreeRow[],
): string | null {
  if (activeId && rows.some((row) => row.id === activeId)) return activeId;
  if (!activeId) return rows[0]?.id ?? null;
  const previousActive = previousRows.find((row) => row.id === activeId);
  if (!previousActive) return rows[0]?.id ?? null;
  const previousIds = new Set(previousRows.map((row) => row.id));
  const newSibling = rows.find(
    (row) => row.parentId === previousActive.parentId && !previousIds.has(row.id),
  );
  if (newSibling) return newSibling.id;
  const replacementState = rows.find(
    (row) => row.parentId === previousActive.parentId && row.kind !== "node",
  );
  if (replacementState) return replacementState.id;
  if (previousActive.parentId && rows.some((row) => row.id === previousActive.parentId)) {
    return previousActive.parentId;
  }
  return rows[0]?.id ?? null;
}
