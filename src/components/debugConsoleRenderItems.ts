import type { DebugConsoleEntry, DebugConsoleResultOwner } from "../domain/debugConsoleState";
import type { DebugVariable } from "../domain/debug";
import {
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariableExpansionState,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";

export const MAX_DEBUG_CONSOLE_RESULT_ROWS = 500;

export type DebugConsoleRenderItem =
  | {
      readonly kind: "entry";
      readonly entry: DebugConsoleEntry;
      readonly entryId: string;
      readonly id: string;
      readonly expandable: boolean;
      readonly expanded: boolean;
      readonly resultInspectionOwner: DebugInspectionOwner | null;
      readonly lineCount: number;
    }
  | {
      readonly kind: "result-variable";
      readonly entryId: string;
      readonly id: string;
      readonly depth: number;
      readonly variable: DebugVariable;
      readonly ancestors: readonly number[];
      readonly expandable: boolean;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "result-status";
      readonly entryId: string;
      readonly id: string;
      readonly depth: number;
      readonly label: string;
    }
  | {
      readonly kind: "result-load";
      readonly entryId: string;
      readonly id: string;
      readonly depth: number;
      readonly label: string;
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly nextStart: number;
    };

export interface BuildDebugConsoleRenderItemsInput {
  readonly currentResultOwner: DebugConsoleResultOwner | null;
  readonly entries: readonly DebugConsoleEntry[];
  readonly expandedResultIds: ReadonlySet<string>;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly resultTreeEnabled: boolean;
  readonly variablePages: DebugVariablePagesState | undefined;
  readonly workspaceOwnerKey: string | null;
}

interface BuildContext {
  readonly expandedResultIds: ReadonlySet<string>;
  readonly items: DebugConsoleRenderItem[];
  readonly owner: DebugInspectionOwner;
  readonly variablePages: DebugVariablePagesState;
  variableCount: number;
  exhausted: boolean;
}

export function buildDebugConsoleRenderItems(
  input: BuildDebugConsoleRenderItemsInput,
): readonly DebugConsoleRenderItem[] {
  const items: DebugConsoleRenderItem[] = [];
  const budget = { count: 0, exhausted: false };

  for (const entry of input.entries) {
    const resultInspectionOwner =
      entry.kind === "result"
        ? consoleResultInspectionOwner(
            entry,
            input.currentResultOwner,
            input.inspectionOwner,
            input.workspaceOwnerKey,
          )
        : null;
    const expansion =
      entry.kind === "result" &&
      entry.variablesReference > 0 &&
      resultInspectionOwner &&
      input.variablePages &&
      input.resultTreeEnabled
        ? selectDebugVariableExpansion(
            input.variablePages,
            resultInspectionOwner,
            entry.variablesReference,
          )
        : null;
    const expandable = expansion ? isExpandableResultState(expansion) : false;
    const expanded = expandable && input.expandedResultIds.has(entry.id);
    items.push({
      entry,
      entryId: entry.id,
      expandable,
      expanded,
      id: entry.id,
      kind: "entry",
      lineCount: formattedEntryLineCount(entry),
      resultInspectionOwner,
    });

    if (
      entry.kind !== "result" ||
      !expanded ||
      !expansion ||
      !resultInspectionOwner ||
      !input.variablePages
    ) {
      continue;
    }

    const context: BuildContext = {
      expandedResultIds: input.expandedResultIds,
      exhausted: budget.exhausted,
      items,
      owner: resultInspectionOwner,
      variableCount: budget.count,
      variablePages: input.variablePages,
    };
    appendExpansion(context, {
      ancestors: [],
      depth: 0,
      entryId: entry.id,
      expansion,
      id: entry.id,
      variablesReference: entry.variablesReference,
    });
    budget.count = context.variableCount;
    budget.exhausted = context.exhausted;
  }

  return items;
}

export function formatDebugConsoleEntry(entry: DebugConsoleEntry): string {
  switch (entry.kind) {
    case "stdout":
    case "stderr":
      return entry.text;
    case "pending":
      return `> ${entry.expression}`;
    case "result":
      return entry.valueType ? `${entry.value} (${entry.valueType})` : entry.value;
    case "error":
      return entry.message;
    case "truncated":
      return `Earlier debug console entries were truncated (${entry.omittedEntries}).`;
  }
}

function appendExpansion(
  context: BuildContext,
  options: {
    readonly ancestors: readonly number[];
    readonly depth: number;
    readonly entryId: string;
    readonly expansion: DebugVariableExpansionState;
    readonly id: string;
    readonly variablesReference: number;
  },
): void {
  const variables = "variables" in options.expansion ? options.expansion.variables : [];

  for (let index = 0; index < variables.length; index += 1) {
    if (context.variableCount >= MAX_DEBUG_CONSOLE_RESULT_ROWS) {
      appendLimitMarker(context, options.entryId, options.id, options.depth + 1);
      return;
    }

    const variable = variables[index]!;
    const variableId = `${options.id}/${index}:${variable.name}`;
    const ancestors = [...options.ancestors, options.variablesReference];
    const depth = options.depth + 1;
    const expansion = selectDebugVariableExpansion(
      context.variablePages,
      context.owner,
      variable.variablesReference,
      ancestors,
      depth,
    );
    const expandable = isExpandableResultState(expansion);
    const expanded = expandable && context.expandedResultIds.has(variableId);
    context.variableCount += 1;
    context.items.push({
      ancestors,
      depth,
      entryId: options.entryId,
      expandable,
      expanded,
      id: variableId,
      kind: "result-variable",
      variable,
    });

    if (!expanded) {
      continue;
    }

    appendExpansion(context, {
      ancestors,
      depth,
      entryId: options.entryId,
      expansion,
      id: variableId,
      variablesReference: variable.variablesReference,
    });

    if (context.exhausted) {
      return;
    }
  }

  if (context.variableCount >= MAX_DEBUG_CONSOLE_RESULT_ROWS) {
    return;
  }

  appendExpansionStatus(context, options);
}

function appendLimitMarker(
  context: BuildContext,
  entryId: string,
  id: string,
  depth: number,
): void {
  if (context.exhausted) {
    return;
  }

  context.exhausted = true;
  context.items.push({
    depth,
    entryId,
    id: `${id}/limit`,
    kind: "result-status",
    label: "Display limit reached",
  });
}

function appendExpansionStatus(
  context: BuildContext,
  options: {
    readonly depth: number;
    readonly entryId: string;
    readonly expansion: DebugVariableExpansionState;
    readonly id: string;
    readonly variablesReference: number;
  },
): void {
  const depth = options.depth + 1;

  if (options.expansion.kind === "idle" || options.expansion.kind === "loading") {
    context.items.push({
      depth,
      entryId: options.entryId,
      id: `${options.id}/loading`,
      kind: "result-status",
      label: "Loading…",
    });
    return;
  }

  if (options.expansion.kind === "error") {
    context.items.push({
      depth,
      entryId: options.entryId,
      id: `${options.id}/retry:${options.expansion.nextStart}`,
      kind: "result-load",
      label: `Retry: ${options.expansion.message}`,
      nextStart: options.expansion.nextStart,
      owner: context.owner,
      variablesReference: options.variablesReference,
    });
    return;
  }

  if (options.expansion.kind !== "ready" || options.expansion.nextStart === null) {
    return;
  }

  context.items.push({
    depth,
    entryId: options.entryId,
    id: `${options.id}/more:${options.expansion.nextStart}`,
    kind: "result-load",
    label: "Load more",
    nextStart: options.expansion.nextStart,
    owner: context.owner,
    variablesReference: options.variablesReference,
  });
}

function consoleResultInspectionOwner(
  entry: Extract<DebugConsoleEntry, { readonly kind: "result" }>,
  currentResultOwner: DebugConsoleResultOwner | null,
  owner: DebugInspectionOwner | null,
  workspaceOwnerKey: string | null,
): DebugInspectionOwner | null {
  if (
    !entry.resultOwner ||
    !currentResultOwner ||
    !owner ||
    entry.resultOwner.epoch !== currentResultOwner.epoch ||
    entry.resultOwner.rootKey !== currentResultOwner.rootKey ||
    entry.resultOwner.workspaceOwnerKey !== currentResultOwner.workspaceOwnerKey ||
    entry.resultOwner.sessionId !== currentResultOwner.sessionId ||
    entry.resultOwner.pauseGeneration !== currentResultOwner.pauseGeneration ||
    entry.resultOwner.frameId !== currentResultOwner.frameId ||
    entry.resultOwner.workspaceOwnerKey !== workspaceOwnerKey ||
    entry.resultOwner.rootKey !== owner.rootKey ||
    entry.resultOwner.sessionId !== owner.sessionId ||
    entry.resultOwner.pauseGeneration !== owner.pauseGeneration ||
    entry.resultOwner.frameId !== owner.frameId
  ) {
    return null;
  }

  return owner;
}

function isExpandableResultState(expansion: DebugVariableExpansionState): boolean {
  return (
    expansion.kind !== "stale" &&
    expansion.kind !== "leaf" &&
    expansion.kind !== "circular" &&
    expansion.kind !== "limit"
  );
}

function formattedEntryLineCount(entry: DebugConsoleEntry): number {
  const text = formatDebugConsoleEntry(entry);
  return 1 + (text.match(/\n/g)?.length ?? 0);
}
