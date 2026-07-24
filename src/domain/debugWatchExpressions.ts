import { debugUtf8ByteLength, validateDebugExpression } from "./debugEvaluationPolicy";
import { fitsDebugWatchV1PayloadBudget } from "./debugWatchPayload";

export const MAX_DEBUG_WATCH_EXPRESSIONS = 100;
export const MAX_DEBUG_WATCH_ID_BYTES = 128;

export interface DebugWatchDefinition {
  readonly id: string;
  readonly expression: string;
  readonly enabled: boolean;
  readonly revision: number;
}

export interface DebugWatchState {
  readonly definitions: readonly DebugWatchDefinition[];
  readonly nextId: number;
  readonly revision: number;
}

export type DebugWatchAction =
  | { readonly type: "add"; readonly expression: string; readonly enabled?: boolean }
  | { readonly type: "update"; readonly id: string; readonly expression: string }
  | { readonly type: "set-enabled"; readonly id: string; readonly enabled: boolean }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "replace"; readonly definitions: readonly DebugWatchDefinition[] }
  | { readonly type: "clear" };

export function createDebugWatchState(
  definitions: readonly DebugWatchDefinition[] = [],
): DebugWatchState {
  const accepted: DebugWatchDefinition[] = [];
  const ids = new Set<string>();
  const expressions = new Set<string>();
  let revision = 0;
  for (const definition of definitions) {
    if (
      accepted.length >= MAX_DEBUG_WATCH_EXPRESSIONS ||
      !isDebugWatchDefinition(definition) ||
      ids.has(definition.id) ||
      expressions.has(definition.expression)
    ) {
      continue;
    }
    if (!fitsDebugWatchV1PayloadBudget([...accepted, definition])) continue;
    accepted.push({ ...definition });
    ids.add(definition.id);
    expressions.add(definition.expression);
    revision = Math.max(revision, definition.revision);
  }
  return { definitions: accepted, nextId: nextAvailableId(accepted, 1) ?? 1, revision };
}

export function reduceDebugWatchState(
  state: DebugWatchState,
  action: DebugWatchAction,
): DebugWatchState {
  switch (action.type) {
    case "add":
      return addDefinition(state, action.expression, action.enabled ?? true);
    case "update":
      return updateDefinition(state, action.id, action.expression);
    case "set-enabled":
      return setDefinitionEnabled(state, action.id, action.enabled);
    case "remove": {
      if (!state.definitions.some((definition) => definition.id === action.id)) return state;
      return advance(
        state,
        state.definitions.filter((definition) => definition.id !== action.id),
      );
    }
    case "replace":
      return createDebugWatchState(action.definitions);
    case "clear": {
      if (state.definitions.length === 0) return state;
      const clearRevision = nextSafeRevision(state);
      return clearRevision === null
        ? state
        : { definitions: [], nextId: state.nextId, revision: clearRevision };
    }
  }
}

export function isDebugWatchDefinition(value: unknown): value is DebugWatchDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const definition = value as Record<string, unknown>;
  const keys = Object.keys(definition);
  return (
    keys.length === 4 &&
    ["id", "expression", "enabled", "revision"].every((key) =>
      Object.prototype.hasOwnProperty.call(definition, key),
    ) &&
    typeof definition.id === "string" &&
    definition.id.length > 0 &&
    !/\p{Cc}/u.test(definition.id) &&
    debugUtf8ByteLength(definition.id) <= MAX_DEBUG_WATCH_ID_BYTES &&
    validateDebugExpression(definition.expression).ok &&
    typeof definition.enabled === "boolean" &&
    Number.isSafeInteger(definition.revision) &&
    (definition.revision as number) >= 0
  );
}

function addDefinition(
  state: DebugWatchState,
  expression: string,
  enabled: boolean,
): DebugWatchState {
  const revision = nextSafeRevision(state);
  const idNumber = nextAvailableId(state.definitions, state.nextId);
  if (
    revision === null ||
    idNumber === null ||
    !Number.isSafeInteger(idNumber + 1) ||
    state.definitions.length >= MAX_DEBUG_WATCH_EXPRESSIONS ||
    typeof enabled !== "boolean" ||
    !validateDebugExpression(expression).ok ||
    state.definitions.some((definition) => definition.expression === expression) ||
    !fitsDebugWatchV1PayloadBudget([
      ...state.definitions,
      {
        id: `watch-${idNumber}`,
        expression,
        enabled,
        revision,
      },
    ])
  ) {
    return state;
  }
  return {
    definitions: [...state.definitions, { id: `watch-${idNumber}`, expression, enabled, revision }],
    nextId: idNumber + 1,
    revision,
  };
}

function updateDefinition(state: DebugWatchState, id: string, expression: string): DebugWatchState {
  const current = state.definitions.find((definition) => definition.id === id);
  const revision = nextSafeRevision(state);
  if (
    !current ||
    revision === null ||
    current.expression === expression ||
    !validateDebugExpression(expression).ok ||
    state.definitions.some(
      (definition) => definition.id !== id && definition.expression === expression,
    ) ||
    !fitsDebugWatchV1PayloadBudget(
      state.definitions.map((definition) =>
        definition.id === id ? { ...definition, expression, revision } : definition,
      ),
    )
  ) {
    return state;
  }
  return {
    ...state,
    definitions: state.definitions.map((definition) =>
      definition.id === id ? { ...definition, expression, revision } : definition,
    ),
    revision,
  };
}

function setDefinitionEnabled(
  state: DebugWatchState,
  id: string,
  enabled: boolean,
): DebugWatchState {
  const current = state.definitions.find((definition) => definition.id === id);
  const revision = nextSafeRevision(state);
  if (
    !current ||
    typeof enabled !== "boolean" ||
    current.enabled === enabled ||
    revision === null
  ) {
    return state;
  }
  const definitions = state.definitions.map((definition) =>
    definition.id === id ? { ...definition, enabled, revision } : definition,
  );
  if (!fitsDebugWatchV1PayloadBudget(definitions)) return state;
  return {
    ...state,
    definitions,
    revision,
  };
}

function advance(
  state: DebugWatchState,
  definitions: readonly DebugWatchDefinition[],
): DebugWatchState {
  const revision = nextSafeRevision(state);
  return revision === null ? state : { ...state, definitions, revision };
}

function nextSafeRevision(state: DebugWatchState): number | null {
  const revision = state.revision + 1;
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function nextAvailableId(
  definitions: readonly DebugWatchDefinition[],
  initial: number,
): number | null {
  if (!Number.isSafeInteger(initial) || initial <= 0) return null;
  const ids = new Set(definitions.map((definition) => definition.id));
  let next = initial;
  while (ids.has(`watch-${next}`)) {
    next += 1;
    if (!Number.isSafeInteger(next) || next <= 0) return null;
  }
  return next;
}
