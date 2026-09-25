import {
  ArrowDownToDot,
  ArrowUpFromDot,
  Pause,
  Play,
  RotateCw,
  Square,
  StepForward,
  Unplug,
} from "lucide-react";
import type { DebugPanelProps } from "../DebugPanel";
import { DebugActionButton } from "./DebugActionButton";
import { debuggerStatusLabel } from "./debugPanelStatus";
import "./debug.css";

export function DebugToolbarRegion({
  canRestartDebug = false,
  debugAdapterKind,
  debugCompoundStartPending = false,
  debugRestartPending = false,
  debugSessionAttached = false,
  debugStartBlockedByOtherOwner = false,
  debugStartPending = false,
  debugStopPending = false,
  onDisconnect,
  onPause,
  onRestart,
  onStep,
  onStop,
  snapshot,
  workspaceTrusted,
}: DebugPanelProps) {
  const state = snapshot.state;
  const stopped = state.kind === "stopped";
  const running = state.kind === "running";
  const steppingDisabled = !stopped || !workspaceTrusted || debugRestartPending || debugStopPending;
  return (
    <div aria-label="Debug session" className="cv-dbar" role="toolbar">
      <span className="cv-dbar__status" data-testid="debug-status">
        <i aria-hidden="true" className="cv-dbar__dot" data-state={state.kind} />
        {debuggerStatusLabel(
          snapshot,
          debugStartPending || debugCompoundStartPending,
          debugStopPending,
          debugStartBlockedByOtherOwner,
        )}
      </span>
      {running ? (
        <DebugActionButton
          disabled={!workspaceTrusted || debugRestartPending || debugStopPending}
          label="Pause"
          onClick={onPause}
          title="Pause F6"
        >
          <Pause aria-hidden="true" size={14} />
        </DebugActionButton>
      ) : (
        <DebugActionButton
          disabled={steppingDisabled}
          label="Continue"
          onClick={() => onStep("continue")}
          title="Continue F5"
        >
          <Play aria-hidden="true" size={14} />
        </DebugActionButton>
      )}
      <DebugActionButton
        disabled={steppingDisabled}
        label="Step over"
        onClick={() => onStep("stepOver")}
        title="Step over F10"
      >
        <StepForward aria-hidden="true" size={14} />
      </DebugActionButton>
      <DebugActionButton
        disabled={steppingDisabled}
        label="Step into"
        onClick={() => onStep("stepInto")}
        title="Step into F11"
      >
        <ArrowDownToDot aria-hidden="true" size={14} />
      </DebugActionButton>
      <DebugActionButton
        disabled={steppingDisabled}
        label="Step out"
        onClick={() => onStep("stepOut")}
        title="Step out ⇧F11"
      >
        <ArrowUpFromDot aria-hidden="true" size={14} />
      </DebugActionButton>
      <span aria-hidden="true" className="cv-dbar__sep" />
      <DebugActionButton
        busy={debugRestartPending}
        disabled={
          (!running && !stopped) ||
          debugAdapterKind !== "node" ||
          !workspaceTrusted ||
          !canRestartDebug ||
          debugRestartPending ||
          debugStopPending ||
          !onRestart
        }
        label="Restart debugging"
        onClick={() => onRestart?.()}
        title={
          debugRestartPending
            ? "Restarting debugging"
            : debugStopPending
              ? "Stopping debugging"
              : "Restart ⇧⌘F5"
        }
      >
        <RotateCw aria-hidden="true" size={14} />
      </DebugActionButton>
      <DebugActionButton
        busy={debugStopPending}
        disabled={
          debugRestartPending ||
          debugStopPending ||
          (!running &&
            !stopped &&
            state.kind !== "starting" &&
            !debugStartPending &&
            !debugCompoundStartPending)
        }
        label={debugSessionAttached ? "Disconnect debugging" : "Stop debugging"}
        onClick={debugSessionAttached ? onDisconnect : onStop}
        title={
          debugStopPending
            ? debugSessionAttached
              ? "Disconnecting debugging"
              : "Stopping debugging"
            : debugSessionAttached
              ? "Disconnect ⇧F5"
              : "Stop ⇧F5"
        }
      >
        {debugSessionAttached ? (
          <Unplug aria-hidden="true" size={14} />
        ) : (
          <Square aria-hidden="true" size={14} />
        )}
      </DebugActionButton>
    </div>
  );
}
