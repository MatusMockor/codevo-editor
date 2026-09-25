import { PanelRightOpen, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import { DebugConsolePanel } from "../DebugConsolePanel";
import type { DebugPanelProps } from "../DebugPanel";
import { NodeDebugConfigurationPicker } from "../NodeDebugConfigurationPicker";
import { NodeDebugLaunchSelector } from "../NodeDebugLaunchSelector";
import { NodeLaunchConfigurationsAction } from "../NodeLaunchConfigurationsAction";
import { NodeRunWithoutDebuggingPickerAction } from "../NodeRunWithoutDebuggingPickerAction";
import { debugSessionActive } from "./debugPanelStatus";
import "./debug.css";

export interface DebugConsoleHeaderProps extends DebugPanelProps {
  readonly onShowDebugViews: (() => void) | null;
}

export function DebugConsoleRegion(props: DebugPanelProps) {
  const {
    console,
    consoleCompletion,
    consoleFocusRequest = null,
    consoleWorkspaceOwnerKey = null,
    debugCopyValue,
    inspectionOwner,
    lastStartError,
    latencyTracker,
    onConsoleCompletionAccept,
    onConsoleCompletionDismiss,
    onConsoleCompletionInputChanged,
    onConsoleCompletionRequest,
    onConsoleFocusRequestHandled,
    onLoadVariablePage,
    snapshot,
    variablePages,
    workspaceTrusted,
  } = props;
  return (
    <div className="cv-debug-console">
      {lastStartError ? (
        <span className="cv-debug__stderr" role="alert">
          {lastStartError}
        </span>
      ) : null}
      <section aria-label="Debug console" className="cv-debug-console__log">
        <DebugConsolePanel
          completion={consoleCompletion}
          console={console}
          copyDisplayedValueSurface={debugCopyValue?.console}
          enabled={snapshot.state.kind === "stopped" && workspaceTrusted}
          focusRequest={consoleFocusRequest}
          onAccept={onConsoleCompletionAccept}
          onDismiss={onConsoleCompletionDismiss}
          onFocusRequestHandled={onConsoleFocusRequestHandled}
          onInputChanged={onConsoleCompletionInputChanged}
          onLoadVariablePage={onLoadVariablePage}
          onRequest={onConsoleCompletionRequest}
          inspectionOwner={inspectionOwner}
          latencyTracker={latencyTracker}
          variablePages={variablePages}
          workspaceOwnerKey={consoleWorkspaceOwnerKey}
        />
      </section>
      <NodeConfigurationPicker {...props} />
    </div>
  );
}

export function DebugConsoleHeader(props: DebugConsoleHeaderProps) {
  const {
    canClearConsole = false,
    debugRestartPending = false,
    debugStopPending = false,
    hasJavaScriptTypeScriptWorkspace,
    nodeLaunchConfigurations,
    nodeRunWithoutDebuggingPicker,
    onClearConsole,
    onOpenNodeLaunchConfigurations,
    onShowDebugViews,
    workspaceTrusted,
  } = props;
  return (
    <span aria-label="Debug console actions" className="cv-debug-console__actions" role="toolbar">
      {hasJavaScriptTypeScriptWorkspace && nodeLaunchConfigurations ? (
        <NodeDebugLaunchSelector
          {...nodeLaunchConfigurations}
          mutationPending={debugStopPending || debugRestartPending}
          sessionActive={debugSessionActive(props)}
          workspaceTrusted={workspaceTrusted}
        />
      ) : null}
      {hasJavaScriptTypeScriptWorkspace && nodeRunWithoutDebuggingPicker ? (
        <NodeRunWithoutDebuggingPickerAction command={nodeRunWithoutDebuggingPicker} />
      ) : null}
      {hasJavaScriptTypeScriptWorkspace && onOpenNodeLaunchConfigurations ? (
        <NodeLaunchConfigurationsAction onOpen={onOpenNodeLaunchConfigurations} />
      ) : null}
      <IconButton
        disabled={!workspaceTrusted || !canClearConsole || !onClearConsole}
        icon={<Trash2 size={14} />}
        label="Clear debug console"
        onClick={() => onClearConsole?.()}
        size="xs"
      />
      {onShowDebugViews === null ? null : (
        <IconButton
          icon={<PanelRightOpen size={14} />}
          label="Show debug views"
          onClick={onShowDebugViews}
          size="xs"
        />
      )}
    </span>
  );
}

function NodeConfigurationPicker(props: DebugPanelProps) {
  const {
    debugRestartPending = false,
    debugStopPending = false,
    hasJavaScriptTypeScriptWorkspace,
    nodeLaunchConfigurations,
    workspaceTrusted,
  } = props;
  const visible =
    hasJavaScriptTypeScriptWorkspace &&
    Boolean(nodeLaunchConfigurations?.pickerOpen) &&
    workspaceTrusted &&
    !debugSessionActive(props) &&
    !debugStopPending &&
    !debugRestartPending;
  if (!visible || !nodeLaunchConfigurations) return null;
  return (
    <NodeDebugConfigurationPicker
      busy={nodeLaunchConfigurations.busy}
      choices={nodeLaunchConfigurations.choices}
      diagnosticNotice={nodeLaunchConfigurations.diagnosticNotice}
      error={nodeLaunchConfigurations.error}
      onClose={nodeLaunchConfigurations.onClosePicker ?? (() => undefined)}
      onRefresh={nodeLaunchConfigurations.onRefresh}
      onStartNamed={nodeLaunchConfigurations.onStartNamed ?? (() => undefined)}
      open
      selectedName={nodeLaunchConfigurations.selectedName}
      state={nodeLaunchConfigurations.state}
    />
  );
}
