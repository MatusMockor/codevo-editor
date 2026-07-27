import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
} from "../application/debugSessionContracts";
import type {
  DebugVariable,
  DebugVariableFilter,
  DebugVariablePageLimitReason,
} from "../domain/debug";
import { buildDebugVariableRanges, debugIndexedRangeExtent } from "../domain/debugVariableRanges";
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
  readonly kind: "node" | "range" | "action" | "status";
  readonly label: string;
  readonly value?: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly testId?: string;
  readonly owner: DebugInspectionOwner | null;
  readonly variablesReference: number;
  readonly nextStart?: number;
  readonly filter?: DebugVariableFilter;
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
  const pagedLocations = indexPagedVariableLocations(variablePages);
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
    const childLimitReason =
      rowIdentity &&
      "childrenLimitReason" in rowIdentity &&
      (rowIdentity.childrenLimitReason === "references" ||
        rowIdentity.childrenLimitReason === "referenceBytes")
        ? rowIdentity.childrenLimitReason
        : null;
    const terminalExpansion =
      childLimitReason !== null ||
      expansion.kind === "circular" ||
      expansion.kind === "limit" ||
      expansion.kind === "stale";
    const terminal = childLimitReason
      ? `Limit reached: ${childLimitReason}`
      : terminalExpansion
        ? terminalExpansionLabel(
            expansion as Extract<
              DebugVariableExpansionState,
              { kind: "circular" | "limit" | "stale" }
            >,
          )
        : undefined;
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
    for (let index = 0; index < variables.length; index += 1) {
      if (rows.length >= maxRows) {
        overflowed = true;
        break;
      }
      const variable = variables[index];
      const location = pagedLocations.get(variable);
      const mutation =
        owner && location
          ? (variableMutationRows?.forRow(
              owner,
              location.parentVariablesReference,
              location.pageStart,
              location.index,
              location.filter,
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
    }
    const indexedPages = variablePages?.references[variablesReference]?.pages;
    const retainedIndexed = debugIndexedRangeExtent(
      indexedPages ? Object.values(indexedPages).filter((page) => page.filter === "indexed") : [],
    );
    if (retainedIndexed !== null) {
      const ranges = buildDebugVariableRanges("indexed", {
        total: retainedIndexed,
        retained: retainedIndexed,
        truncated: false,
        limitReason: null,
      });
      for (const range of ranges) {
        if (rows.length >= maxRows) {
          overflowed = true;
          break;
        }
        const rangeId = `${id}/range:indexed:${range.start}`;
        const rangePage = indexedPages?.[`indexed:${range.start}`];
        const rangeReference = variablePages?.references[variablesReference];
        const rangeError = rangeReference?.errors[`indexed:${range.start}`];
        const rangePending = Boolean(rangeReference?.pending[`indexed:${range.start}`]);
        const rangeExpanded = expandedIds.has(rangeId);
        append({
          id: rangeId,
          parentId: id,
          depth: depth + 1,
          kind: "range",
          label: range.label,
          owner,
          variablesReference,
          filter: "indexed",
          nextStart: range.start,
          expandable: true,
          expanded: rangeExpanded,
          busy: rangeExpanded && rangePending,
          loadOnExpand: !rangePage,
        });
        if (!rangeExpanded) continue;
        if (!rangePage) {
          append(
            rangeError
              ? actionRow(
                  rangeId,
                  depth + 2,
                  `Retry: ${rangeError}`,
                  owner,
                  variablesReference,
                  range.start,
                  "indexed",
                )
              : statusRow(rangeId, depth + 2, "Loading…"),
          );
          continue;
        }
        for (let index = 0; index < rangePage.variables.length; index += 1) {
          const variable = rangePage.variables[index];
          const mutation =
            owner && variableMutationRows
              ? (variableMutationRows.forRow(
                  owner,
                  variablesReference,
                  rangePage.start,
                  index,
                  "indexed",
                ) ?? undefined)
              : undefined;
          visit(
            `${rangeId}/${range.start + index}:${variable.name}`,
            rangeId,
            depth + 2,
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
        }
      }
    }
    const namedProjectionLimit = variablePages
      ? Object.values(variablePages.references[variablesReference]?.pages ?? {}).find(
          (page) =>
            (page.filter ?? "named") === "named" && page.truncated === true && page.limitReason,
        )?.limitReason
      : undefined;
    const indexedProjectionLimit = variablePages
      ? Object.values(variablePages.references[variablesReference]?.pages ?? {}).find(
          (page) => page.filter === "indexed" && page.truncated === true && page.limitReason,
        )?.limitReason
      : undefined;
    const indexedLoadError = variablePages
      ? Object.entries(variablePages.references[variablesReference]?.errors ?? {}).find(([key]) =>
          key.startsWith("indexed:"),
        )?.[1]
      : undefined;
    if (indexedProjectionLimit) {
      append(
        statusRow(
          id,
          depth + 1,
          `Indexed limit reached: ${variablePageLimitReasonLabel(indexedProjectionLimit)}`,
        ),
      );
    }
    if (!indexedProjectionLimit && indexedLoadError) {
      append(statusRow(id, depth + 1, `Indexed unavailable: ${indexedLoadError}`));
    }
    if (namedProjectionLimit) {
      append(
        statusRow(
          id,
          depth + 1,
          `Limit reached: ${variablePageLimitReasonLabel(namedProjectionLimit)}`,
        ),
      );
    }
    switch (expansion.kind) {
      case "idle":
      case "loading":
        append(statusRow(id, depth + 1, "Loading…"));
        break;
      case "error":
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
        break;
      case "ready":
        if (expansion.nextStart !== null) {
          append(
            actionRow(id, depth + 1, "Load more", owner, variablesReference, expansion.nextStart),
          );
        }
        break;
      default:
        expansion satisfies never;
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

interface PagedVariableLocation {
  readonly parentVariablesReference: number;
  readonly pageStart: number;
  readonly index: number;
  readonly filter: DebugVariableFilter;
}

function indexPagedVariableLocations(
  state: DebugVariablePagesState | undefined,
): WeakMap<DebugVariable, PagedVariableLocation> {
  const locations = new WeakMap<DebugVariable, PagedVariableLocation>();
  if (!state) return locations;
  for (const [reference, pages] of Object.entries(state.references)) {
    for (const page of Object.values(pages.pages)) {
      for (let index = 0; index < page.variables.length; index += 1) {
        locations.set(page.variables[index]!, {
          parentVariablesReference: Number(reference),
          pageStart: page.start,
          index,
          filter: page.filter ?? "named",
        });
      }
    }
  }
  return locations;
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
  filter: DebugVariableFilter = "named",
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
    filter,
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

function variablePageLimitReasonLabel(reason: DebugVariablePageLimitReason): string {
  switch (reason) {
    case "acquisition-count":
      return "acquisition quota";
    case "capability":
      return "runtime capability";
    case "descriptor-count":
      return "descriptor count";
    case "descriptor-bytes":
      return "descriptor bytes";
    case "page-bytes":
      return "page bytes";
    case "references":
      return "references";
    case "reference-bytes":
      return "reference bytes";
  }
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
