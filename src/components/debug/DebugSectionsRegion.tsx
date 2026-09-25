import { CircleCheckBig, CircleOff, Copy, Trash2 } from "lucide-react";
import type { DebugExceptionTypeFilter } from "../../domain/debug";
import type { DebugPanelProps } from "../DebugPanel";
import { DebugWatchesPanel } from "../DebugWatchesPanel";
import { ExceptionTypeFilter } from "../ExceptionTypeFilter";
import { FunctionBreakpoints } from "../FunctionBreakpoints";
import { DebugActionButton } from "./DebugActionButton";
import { DebugBreakpoints } from "./DebugBreakpoints";
import { CallStack } from "./DebugCallStack";
import { canCopyStackTrace } from "./debugStackTraceCapability";
import { DebugExceptionRows } from "./DebugExceptionRows";
import { debugSessionActive } from "./debugPanelStatus";
import { DebugSection } from "./DebugSection";
import { DebugVariables } from "./DebugVariables";
import "./debug.css";

const EMPTY_EXCEPTION_TYPE_FILTER: DebugExceptionTypeFilter = Object.freeze([]);

export function DebugSectionsRegion(props: DebugPanelProps) {
  const {
    debugAddToWatch,
    debugCopyValue,
    debugSetVariable,
    inspectionOwner,
    latencyTracker,
    onLoadVariablePage,
    onLoadVariables,
    onSelectFrame,
    rootPath,
    scopeLoadState,
    scopes,
    snapshot,
    variableMutationRows,
    variablePages,
    variablesByReference,
    watches,
    debugAdapterKind,
    workspaceTrusted,
  } = props;
  const state = snapshot.state;
  const stopped = state.kind === "stopped";
  return (
    <aside aria-label="Debug" className="cv-dside">
      <DebugSection title="Variables">
        <DebugVariables
          addToWatchSurface={debugAddToWatch}
          copyValueSurface={debugCopyValue?.variables}
          inspectionOwner={inspectionOwner}
          latencyTracker={latencyTracker}
          onLoadVariablePage={onLoadVariablePage}
          onLoadVariables={onLoadVariables}
          onRetryFrame={onSelectFrame}
          scopeLoadState={scopeLoadState}
          scopes={scopes}
          setVariableSurface={debugSetVariable}
          stopped={stopped}
          variablePages={variablePages}
          variableMutationRows={variableMutationRows}
          variablesByReference={variablesByReference}
        />
      </DebugSection>
      <DebugSection count={watches.definitions.length} title="Watch">
        <DebugWatchesPanel
          {...watches}
          copyValueSurface={debugCopyValue?.watch}
          debugAdapterKind={debugAdapterKind}
          onLoadVariablePage={onLoadVariablePage}
          setVariableSurface={debugSetVariable}
          sessionState={state.kind}
          variablePages={variablePages}
          variableMutationRows={variableMutationRows}
          workspaceRoot={rootPath}
          workspaceTrusted={workspaceTrusted}
        />
      </DebugSection>
      <CallStackSection {...props} />
      <BreakpointsSection {...props} />
    </aside>
  );
}

function CallStackSection({
  debugAdapterKind,
  debugControlPending = false,
  debugCopyStackTrace,
  debugRestartFrame,
  onNavigateToFrame,
  onSelectFrame,
  rootPath,
  selectedFrameId,
  snapshot,
  workspaceTrusted,
}: DebugPanelProps) {
  const actions = canCopyStackTrace(debugCopyStackTrace) ? (
    <span aria-label="Call stack actions" className="cv-debug__title-actions" role="toolbar">
      <DebugActionButton
        disabled={false}
        label="Copy Call Stack"
        onClick={() => {
          if (canCopyStackTrace(debugCopyStackTrace)) {
            debugCopyStackTrace?.copyStackTrace();
          }
        }}
        title="Copy Call Stack"
      >
        <Copy aria-hidden="true" size={12} />
      </DebugActionButton>
    </span>
  ) : undefined;
  return (
    <DebugSection
      actions={actions}
      count={snapshot.state.kind === "stopped" ? "Paused" : undefined}
      title="Call stack"
    >
      <CallStack
        debugAdapterKind={debugAdapterKind}
        debugControlPending={debugControlPending}
        debugRestartFrame={debugRestartFrame}
        onNavigateToFrame={onNavigateToFrame}
        onSelectFrame={onSelectFrame}
        rootPath={rootPath}
        selectedFrameId={selectedFrameId}
        snapshot={snapshot}
        workspaceTrusted={workspaceTrusted}
      />
    </DebugSection>
  );
}

function BreakpointsSection(props: DebugPanelProps) {
  const {
    breakpoints,
    debugAdapterKind,
    debugCompoundActive = false,
    debugCompoundStartPending = false,
    exceptionPauseError,
    exceptionPauseMode,
    exceptionPausePending,
    exceptionTypeFilter = EMPTY_EXCEPTION_TYPE_FILTER,
    functionBreakpoints = [],
    hasJavaScriptTypeScriptWorkspace,
    onAddFunctionBreakpoint,
    onNavigateToBreakpoint,
    onRemoveBreakpoint,
    onRemoveFunctionBreakpoint,
    onSetBreakpointCondition,
    onSetBreakpointEnabled,
    onSetBreakpointHitCondition,
    onSetBreakpointLogMessage,
    onSetExceptionPauseMode,
    onSetExceptionTypeFilter,
    onSetFunctionBreakpointEnabled,
    rootPath,
    workspaceTrusted,
  } = props;
  const exceptionPauseDisabled =
    exceptionPausePending ||
    !workspaceTrusted ||
    (debugSessionActive(props) ? debugAdapterKind !== "node" : !hasJavaScriptTypeScriptWorkspace);
  return (
    <DebugSection
      actions={<BreakpointActions {...props} />}
      count={breakpoints.length}
      title="Breakpoints"
    >
      <DebugExceptionRows
        disabled={exceptionPauseDisabled}
        error={exceptionPauseError}
        mode={exceptionPauseMode}
        onChange={onSetExceptionPauseMode}
        pending={exceptionPausePending}
      />
      {debugAdapterKind !== "php" &&
      hasJavaScriptTypeScriptWorkspace &&
      onSetExceptionTypeFilter ? (
        <ExceptionTypeFilter
          disabled={exceptionPauseDisabled || exceptionPauseMode === "none"}
          filter={exceptionTypeFilter}
          key={rootPath ?? ""}
          onChange={onSetExceptionTypeFilter}
        />
      ) : null}
      <DebugBreakpoints
        breakpoints={breakpoints}
        onNavigateToBreakpoint={onNavigateToBreakpoint}
        onRemoveBreakpoint={onRemoveBreakpoint}
        onSetBreakpointCondition={onSetBreakpointCondition}
        onSetBreakpointHitCondition={onSetBreakpointHitCondition}
        onSetBreakpointLogMessage={onSetBreakpointLogMessage}
        onSetBreakpointEnabled={onSetBreakpointEnabled}
        supportsHitConditions={debugAdapterKind !== "php" && hasJavaScriptTypeScriptWorkspace}
        supportsLogpoints={debugAdapterKind !== "php" && hasJavaScriptTypeScriptWorkspace}
        rootPath={rootPath}
      />
      {debugAdapterKind !== "php" &&
      !debugCompoundActive &&
      !debugCompoundStartPending &&
      hasJavaScriptTypeScriptWorkspace &&
      onAddFunctionBreakpoint &&
      onRemoveFunctionBreakpoint &&
      onSetFunctionBreakpointEnabled ? (
        <FunctionBreakpoints
          breakpoints={functionBreakpoints}
          disabled={!workspaceTrusted}
          onAdd={onAddFunctionBreakpoint}
          onRemove={onRemoveFunctionBreakpoint}
          onSetEnabled={onSetFunctionBreakpointEnabled}
        />
      ) : null}
    </DebugSection>
  );
}

function BreakpointActions({
  breakpointBulkMutationPending = false,
  breakpointCounts = { disabled: 0, enabled: 0 },
  breakpointsActivated = true,
  canToggleBreakpointsActivated = false,
  debugAdapterKind,
  debugControlPending = false,
  onDisableAllBreakpoints,
  onEnableAllBreakpoints,
  onRemoveAllBreakpoints,
  onToggleBreakpointsActivated,
}: DebugPanelProps) {
  return (
    <span
      aria-busy={breakpointBulkMutationPending || undefined}
      aria-label="Breakpoint actions"
      className="cv-debug__title-actions"
      role="toolbar"
    >
      {debugAdapterKind === "node" ? (
        <DebugActionButton
          busy={debugControlPending}
          disabled={
            !canToggleBreakpointsActivated ||
            breakpointBulkMutationPending ||
            debugControlPending ||
            !onToggleBreakpointsActivated
          }
          label={breakpointsActivated ? "Deactivate breakpoints" : "Activate breakpoints"}
          onClick={() => onToggleBreakpointsActivated?.()}
          pressed={breakpointsActivated}
          title={
            debugControlPending
              ? "Updating breakpoint activation"
              : breakpointsActivated
                ? "Deactivate breakpoints"
                : "Activate breakpoints"
          }
        >
          {breakpointsActivated ? (
            <CircleCheckBig aria-hidden="true" size={12} />
          ) : (
            <CircleOff aria-hidden="true" size={12} />
          )}
        </DebugActionButton>
      ) : null}
      <DebugActionButton
        busy={breakpointBulkMutationPending}
        disabled={
          breakpointCounts.disabled === 0 ||
          breakpointBulkMutationPending ||
          !onEnableAllBreakpoints
        }
        label="Enable all breakpoints"
        onClick={() => onEnableAllBreakpoints?.()}
        title={breakpointBulkMutationPending ? "Updating breakpoints" : "Enable all breakpoints"}
      >
        <CircleCheckBig aria-hidden="true" size={12} />
      </DebugActionButton>
      <DebugActionButton
        busy={breakpointBulkMutationPending}
        disabled={
          breakpointCounts.enabled === 0 ||
          breakpointBulkMutationPending ||
          !onDisableAllBreakpoints
        }
        label="Disable all breakpoints"
        onClick={() => onDisableAllBreakpoints?.()}
        title={breakpointBulkMutationPending ? "Updating breakpoints" : "Disable all breakpoints"}
      >
        <CircleOff aria-hidden="true" size={12} />
      </DebugActionButton>
      <DebugActionButton
        busy={breakpointBulkMutationPending}
        disabled={
          breakpointCounts.enabled + breakpointCounts.disabled === 0 ||
          breakpointBulkMutationPending ||
          !onRemoveAllBreakpoints
        }
        label="Remove all breakpoints"
        onClick={() => onRemoveAllBreakpoints?.()}
        title={breakpointBulkMutationPending ? "Updating breakpoints" : "Remove all breakpoints"}
      >
        <Trash2 aria-hidden="true" size={12} />
      </DebugActionButton>
    </span>
  );
}
