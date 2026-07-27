import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

export interface WatchRefreshAuthority extends DebugInspectionOwner {
  readonly epoch: number;
  readonly externalRefreshVersion: number;
  readonly rootRevision: number;
}

export interface PendingWatchRefreshEvaluations {
  readonly owner: DebugInspectionOwner | null;
  readonly ids: readonly string[];
}

interface SettledWatchEvaluation {
  readonly owner: DebugInspectionOwner;
  readonly definitionRevision: number;
  readonly frameId: number;
}

export function watchRefreshOwner({
  debugAdapterKind,
  externalRefreshVersion,
  inspectionOwner,
  rootKey,
  rootRevision,
  rootStateKey,
  sessionStateKind,
  snapshot,
  stoppedFrameId,
  trusted,
  workspaceRoot,
}: {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly externalRefreshVersion: number;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly rootKey: string;
  readonly rootRevision: number;
  readonly rootStateKey: string | null;
  readonly sessionStateKind: DebuggerSessionSnapshot["state"]["kind"];
  readonly snapshot: DebuggerSessionSnapshot;
  readonly stoppedFrameId: number | null;
  readonly trusted: boolean;
  readonly workspaceRoot: string | null;
}): Omit<WatchRefreshAuthority, "epoch"> | null {
  if (
    !workspaceRoot ||
    !rootKey ||
    rootStateKey !== rootKey ||
    !trusted ||
    debugAdapterKind !== "node" ||
    sessionStateKind !== "stopped" ||
    snapshot.state.kind !== "stopped" ||
    stoppedFrameId === null ||
    !inspectionOwner ||
    inspectionOwner.rootKey !== rootKey ||
    inspectionOwner.sessionId !== snapshot.state.sessionId ||
    inspectionOwner.frameId !== stoppedFrameId
  ) {
    return null;
  }
  return { ...inspectionOwner, externalRefreshVersion, rootRevision };
}

export function canRefreshWatches({
  captured,
  current,
  definitions,
  evaluations,
  lease,
  pending,
  trustReader,
}: {
  readonly captured: WatchRefreshAuthority | null;
  readonly current: WatchRefreshAuthority | null;
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, SettledWatchEvaluation>>;
  readonly lease: WatchRefreshAuthority | null;
  readonly pending: PendingWatchRefreshEvaluations;
  readonly trustReader: () => boolean;
}): boolean {
  if (
    !captured ||
    current !== captured ||
    lease !== null ||
    pending.ids.length > 0 ||
    !workspaceTrustedNow(trustReader)
  ) {
    return false;
  }
  const enabled = definitions.filter((definition) => definition.enabled);
  return (
    enabled.length > 0 &&
    enabled.every((definition) => {
      const evaluation = evaluations[definition.id];
      return (
        evaluation !== undefined &&
        evaluation.definitionRevision === definition.revision &&
        evaluation.frameId === captured.frameId &&
        debugInspectionOwnersEqual(evaluation.owner, captured)
      );
    })
  );
}

export function watchEvaluationRequestCurrent({
  current,
  generation,
  request,
  requestGeneration,
  trustReader,
}: {
  readonly current: WatchRefreshAuthority | null;
  readonly generation: number;
  readonly request: WatchRefreshAuthority | null;
  readonly requestGeneration: number;
  readonly trustReader: () => boolean;
}): boolean {
  return (
    generation === requestGeneration &&
    request !== null &&
    current === request &&
    workspaceTrustedNow(trustReader)
  );
}

export function watchRefreshOwnersEqual(
  left: Omit<WatchRefreshAuthority, "epoch"> | WatchRefreshAuthority | null,
  right: Omit<WatchRefreshAuthority, "epoch"> | WatchRefreshAuthority | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.externalRefreshVersion === right.externalRefreshVersion &&
      left.rootRevision === right.rootRevision &&
      debugInspectionOwnersEqual(left, right))
  );
}

export function workspaceTrustedNow(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted() === true;
  } catch {
    return false;
  }
}
