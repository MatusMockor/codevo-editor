import type {
  DebugScopeLoadState,
  DebugVariableMutationRows,
} from "../../application/debugSessionContracts";
import type { DebugScope, DebugVariable, DebugVariableFilter } from "../../domain/debug";
import type {
  DebugInspectionOwner,
  DebugVariablePagesState,
} from "../../domain/debugVariablePages";
import type { LatencyTracker } from "../../domain/latencyTracker";
import type { DebugAddToWatchVariableSurface } from "../debugAddToWatchSurface";
import type { DebugCopyValueSurface } from "../debugCopyValueSurface";
import type { DebugSetVariableSurface } from "../debugSetVariableSurface";
import { DebugVariableTree, type DebugVariableTreeRoot } from "../DebugVariableTree";

export function DebugVariables({
  addToWatchSurface,
  copyValueSurface,
  inspectionOwner,
  latencyTracker,
  onLoadVariablePage,
  onLoadVariables,
  onRetryFrame,
  scopeLoadState,
  scopes,
  setVariableSurface,
  stopped,
  variablePages,
  variableMutationRows,
  variablesByReference,
}: {
  addToWatchSurface?: DebugAddToWatchVariableSurface;
  copyValueSurface?: DebugCopyValueSurface;
  inspectionOwner?: DebugInspectionOwner | null;
  latencyTracker?: LatencyTracker;
  onLoadVariablePage?(
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
    filter?: DebugVariableFilter,
  ): void | Promise<void>;
  onLoadVariables(variablesReference: number): void;
  onRetryFrame(frameId: number): void;
  scopeLoadState: DebugScopeLoadState;
  scopes: DebugScope[];
  setVariableSurface?: DebugSetVariableSurface;
  stopped: boolean;
  variablePages?: DebugVariablePagesState;
  variableMutationRows?: DebugVariableMutationRows;
  variablesByReference: Record<number, DebugVariable[]>;
}) {
  if (!stopped || scopeLoadState.kind === "inactive") {
    return <div className="cv-debug__message">Not paused</div>;
  }

  if (scopeLoadState.kind === "unavailable") {
    return <div className="cv-debug__message">No stack frame available</div>;
  }

  if (scopeLoadState.kind === "loading") {
    return (
      <div aria-live="polite" role="status" className="cv-debug__message">
        Loading variables…
      </div>
    );
  }

  if (scopeLoadState.kind === "error") {
    return (
      <div role="alert" className="cv-debug__message">
        <div>{scopeLoadState.message}</div>
        <button
          aria-label="Retry"
          onClick={() => onRetryFrame(scopeLoadState.frameId)}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  if (scopes.length === 0) {
    return <div className="cv-debug__message">No variables in selected frame</div>;
  }

  const roots: DebugVariableTreeRoot[] = scopes.map((scope, index) => ({
    id: `${index}:${scope.variablesReference}`,
    label: scope.name,
    owner: inspectionOwner ?? null,
    variablesReference: scope.variablesReference,
    testId: "debug-scope",
  }));
  return (
    <DebugVariableTree
      addToWatchSurface={addToWatchSurface}
      ariaLabel="Variables"
      copyValueSurface={copyValueSurface}
      latencyTracker={latencyTracker}
      onLoadPage={onLoadVariablePage}
      onLoadVariables={onLoadVariables}
      roots={roots}
      setVariableSurface={setVariableSurface}
      variablePages={variablePages}
      variableMutationRows={variableMutationRows}
      variablesByReference={variablesByReference}
      virtualizeRows
    />
  );
}
