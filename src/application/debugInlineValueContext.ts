import type { DebugScope } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import {
  isDebugInspectionOwner,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

export interface DebugInlineValueContext {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly owner: DebugInspectionOwner;
  readonly scopes: readonly DebugScope[];
  readonly variablePages: DebugVariablePagesState;
}

export function createDebugInlineValueContext({
  debugAdapterKind,
  isWorkspaceTrusted,
  inspectionOwner,
  scopes,
  snapshot,
  variablePages,
}: {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly isWorkspaceTrusted: boolean;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly scopes: readonly DebugScope[];
  readonly snapshot: DebuggerSessionSnapshot;
  readonly variablePages: DebugVariablePagesState;
}): DebugInlineValueContext | null {
  if (
    debugAdapterKind !== "node" ||
    !isWorkspaceTrusted ||
    !isDebugInspectionOwner(inspectionOwner) ||
    snapshot.state.kind !== "stopped" ||
    snapshot.state.sessionId !== inspectionOwner.sessionId
  )
    return null;
  const frame = snapshot.state.frames.find(({ frameId }) => frameId === inspectionOwner.frameId);
  if (!frame?.filePath || !Number.isSafeInteger(frame.lineNumber) || frame.lineNumber <= 0)
    return null;
  return {
    filePath: frame.filePath,
    lineNumber: frame.lineNumber,
    owner: inspectionOwner,
    scopes,
    variablePages,
  };
}
