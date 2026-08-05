const MAX_NATIVE_WINDOW_TRANSITIONS = 1_024;

export interface PerfCaptureNativeWindowState {
  readonly active: boolean;
  readonly appActivationTransitions: number;
  readonly diagnosticSpaceLease: boolean;
  readonly hidden: boolean;
  readonly key: boolean;
  readonly keyTransitions: number;
  readonly leaseId: string;
  readonly minimized: boolean;
  readonly minimizeTransitions: number;
  readonly occluded: boolean;
  readonly occlusionTransitions: number;
  readonly occlusionVisible: boolean;
  readonly onActiveSpace: boolean;
  readonly transitionOverflow: boolean;
  readonly visible: boolean;
  readonly windowStabilityEpoch: number;
}

export function nativeWindowReady(state: PerfCaptureNativeWindowState): boolean {
  return (
    state.active &&
    !state.hidden &&
    state.visible &&
    state.key &&
    !state.minimized &&
    !state.occluded &&
    state.occlusionVisible &&
    state.onActiveSpace
  );
}

export function nativeWindowTransitionCount(state: PerfCaptureNativeWindowState): number {
  return Math.max(
    state.windowStabilityEpoch,
    state.appActivationTransitions,
    state.occlusionTransitions,
    state.keyTransitions,
    state.minimizeTransitions,
  );
}

export function nativeWindowTransitionEvidenceValid(state: PerfCaptureNativeWindowState): boolean {
  const categoryTotal =
    state.appActivationTransitions +
    state.occlusionTransitions +
    state.keyTransitions +
    state.minimizeTransitions;
  return (
    !state.transitionOverflow &&
    state.windowStabilityEpoch === categoryTotal &&
    state.windowStabilityEpoch <= MAX_NATIVE_WINDOW_TRANSITIONS
  );
}

export function assertNativeWindowTransitionEvidence(state: PerfCaptureNativeWindowState): void {
  if (!nativeWindowTransitionEvidenceValid(state)) {
    throw new Error("Perf production capture native window transition evidence was invalid.");
  }
}
