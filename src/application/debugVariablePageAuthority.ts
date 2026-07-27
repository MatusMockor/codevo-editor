import type { DebugVariable, DebugVariableFilter, DebugVariablePage } from "../domain/debug";
import type {
  DebugInspectionOwner,
  DebugVariableExpansionState,
  DebugVariablePageResult,
  DebugVariablePagesState,
} from "../domain/debugVariablePages";

interface DebugVariablePagePublicationAuthority {
  readonly owner: DebugInspectionOwner;
  readonly workspaceId: string | null;
  readonly workspaceEpoch: number;
  readonly currentRootKey: string | null;
  readonly stoppedSessionId: number | null;
  readonly pauseGeneration: number;
  readonly selectedFrameId: number | null;
}

export function debugVariablePageRequestKey(
  owner: DebugInspectionOwner,
  variablesReference: number,
  filter: DebugVariableFilter,
  start: number,
): string {
  return `${debugVariablePageOwnerPrefix(owner)}${[variablesReference, filter, start].join("\0")}`;
}

export function debugVariablePageOwnerPrefix(owner: DebugInspectionOwner): string {
  return `${[
    owner.rootKey,
    owner.workspaceId ?? "",
    owner.workspaceEpoch ?? -1,
    owner.sessionId,
    owner.pauseGeneration,
    owner.frameId,
  ].join("\0")}\0`;
}

export function debugVariablePagePublicationIsCurrent({
  owner,
  workspaceId,
  workspaceEpoch,
  currentRootKey,
  stoppedSessionId,
  pauseGeneration,
  selectedFrameId,
}: DebugVariablePagePublicationAuthority): boolean {
  return (
    (owner.workspaceEpoch ?? 0) === workspaceEpoch &&
    (owner.workspaceId ?? null) === workspaceId &&
    currentRootKey === owner.rootKey &&
    stoppedSessionId === owner.sessionId &&
    pauseGeneration === owner.pauseGeneration &&
    selectedFrameId === owner.frameId
  );
}

export function debugVariablePageCanLoad(
  expansion: DebugVariableExpansionState,
  filter: DebugVariableFilter,
  start: number,
): boolean {
  if (
    expansion.kind === "stale" ||
    expansion.kind === "leaf" ||
    expansion.kind === "circular" ||
    expansion.kind === "limit"
  ) {
    return false;
  }
  return filter === "indexed" || expansion.kind === "idle" || expansion.nextStart === start;
}

export function normalizeDebugVariablePageResult(
  page: DebugVariablePage,
  variablesReference: number,
  requestedFilter: DebugVariableFilter,
): DebugVariablePageResult {
  return {
    variablesReference,
    filter: page.filter ?? requestedFilter,
    start: page.start,
    variables: page.variables,
    nextStart: page.nextStart ?? null,
    total: page.total ?? (page.truncated ? null : page.start + page.returned),
    truncated: page.truncated,
    limitReason: page.limitReason ?? (page.truncated ? "page-bytes" : null),
  };
}

export function currentDebugInspectionOwner(
  rootKey: string,
  workspaceId: string | null,
  workspaceEpoch: number,
  stoppedSessionId: number | null,
  pauseGeneration: number,
  frameId: number | null,
): DebugInspectionOwner | null {
  if (stoppedSessionId === null || pauseGeneration <= 0 || frameId === null) return null;
  return {
    rootKey,
    workspaceId,
    workspaceEpoch,
    sessionId: stoppedSessionId,
    pauseGeneration,
    frameId,
  };
}

export function flattenNamedDebugVariables(
  references: DebugVariablePagesState["references"],
): Record<number, DebugVariable[]> {
  const cache: Record<number, DebugVariable[]> = {};
  return new Proxy(cache, {
    get(target, property, receiver) {
      if (typeof property !== "string" || !/^(?:0|[1-9]\d*)$/.test(property)) {
        return Reflect.get(target, property, receiver);
      }
      const reference = Number(property);
      if (!(reference in references)) return undefined;
      target[reference] ??= Object.values(references[reference]!.pages)
        .filter((page) => (page.filter ?? "named") === "named")
        .sort((left, right) => left.start - right.start)
        .flatMap((page) => page.variables);
      return target[reference];
    },
    ownKeys: () => Object.keys(references),
    getOwnPropertyDescriptor(_target, property) {
      return typeof property === "string" && property in references
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });
}
