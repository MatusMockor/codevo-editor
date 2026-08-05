import {
  nativeWindowReady,
  nativeWindowTransitionEvidenceValid,
  type PerfCaptureNativeWindowState,
} from "./perfCaptureNativeWindowState";

export type { PerfCaptureNativeWindowState } from "./perfCaptureNativeWindowState";

const ACTIVATE_COMMAND = "perf_capture_activate_window";
const RELEASE_COMMAND = "perf_capture_release_window_lease";
const RESET_BASELINE_COMMAND = "perf_capture_reset_window_lease_baseline";
const SNAPSHOT_COMMAND = "perf_capture_snapshot_window_lease";
const RELEASE_TIMEOUT_MS = 2_000;
const MAX_ALLOWED_ACTIVATION_ATTEMPTS = 100;
const MAX_ALLOWED_ACTIVATION_TIMEOUT_MS = 5_000;
const ACTIVATION_LIMIT_KEYS = ["maxAttempts", "pollMs", "timeoutMs"] as const;
const NATIVE_STATE_KEYS = [
  "active",
  "appActivationTransitions",
  "diagnosticSpaceLease",
  "hidden",
  "key",
  "keyTransitions",
  "leaseId",
  "minimizeTransitions",
  "minimized",
  "occluded",
  "occlusionTransitions",
  "occlusionVisible",
  "onActiveSpace",
  "transitionOverflow",
  "visible",
  "windowStabilityEpoch",
] as const;
const NATIVE_BOOLEAN_STATE_KEYS = [
  "active",
  "diagnosticSpaceLease",
  "hidden",
  "key",
  "minimized",
  "occluded",
  "occlusionVisible",
  "onActiveSpace",
  "transitionOverflow",
  "visible",
] as const;
const NATIVE_COUNTER_STATE_KEYS = [
  "appActivationTransitions",
  "keyTransitions",
  "minimizeTransitions",
  "occlusionTransitions",
  "windowStabilityEpoch",
] as const;

export interface PerfProductionCaptureActivationLimits {
  readonly maxAttempts: number;
  readonly pollMs: number;
  readonly timeoutMs: number;
}

export const DEFAULT_PRODUCTION_CAPTURE_ACTIVATION_LIMITS = Object.freeze({
  maxAttempts: 100,
  pollMs: 50,
  timeoutMs: 5_000,
}) satisfies PerfProductionCaptureActivationLimits;

export const DIAGNOSTIC_PRODUCTION_CAPTURE_ACTIVATION_LIMITS = Object.freeze({
  maxAttempts: 20,
  pollMs: 100,
  timeoutMs: 2_000,
}) satisfies PerfProductionCaptureActivationLimits;

export interface PerfCaptureDomWindowState {
  readonly focused: boolean;
  readonly visible: boolean;
}

interface PerfCaptureWindowReadyObservation {
  readonly domState: PerfCaptureDomWindowState;
  readonly nativeState: PerfCaptureNativeWindowState;
}

export interface PerfProductionCaptureActivationDependencies {
  readonly invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  readonly readDomState: () => PerfCaptureDomWindowState;
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
  readonly awaitResponse: (request: Promise<unknown>, timeoutMs: number) => Promise<unknown>;
}

export async function activateProductionCaptureWindow(
  runToken: string,
  overrides: Partial<PerfProductionCaptureActivationDependencies> = {},
  limitsValue: PerfProductionCaptureActivationLimits = DEFAULT_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
  leaseId: string | null = null,
): Promise<PerfCaptureNativeWindowState> {
  const limits = parseActivationLimits(limitsValue);
  const dependencies = { ...defaultDependencies, ...overrides };
  const startedAt = dependencies.now();
  let lastNativeState: PerfCaptureNativeWindowState | null = null;
  let lastDomState: PerfCaptureDomWindowState | null = null;
  let currentLeaseId = leaseId;
  let activationSucceeded = false;
  let readyObservation: PerfCaptureWindowReadyObservation | null = null;

  try {
    for (let attempt = 1; attempt <= limits.maxAttempts; attempt += 1) {
      const remainingMs = limits.timeoutMs - (dependencies.now() - startedAt);

      if (remainingMs <= 0) {
        break;
      }

      let rawState: unknown;
      try {
        const command = attempt === 1 ? ACTIVATE_COMMAND : SNAPSHOT_COMMAND;
        const args = currentLeaseId === null ? { runToken } : { runToken, leaseId: currentLeaseId };
        rawState = await dependencies.awaitResponse(
          dependencies.invoke(command, args),
          remainingMs,
        );
      } catch {
        throw new Error("Native production capture window activation failed.");
      }

      if (currentLeaseId === null) {
        currentLeaseId = cleanupLeaseId(rawState);
      }
      const nativeState = parseNativeWindowState(rawState);
      if (currentLeaseId !== null && nativeState.leaseId !== currentLeaseId) {
        throw new Error("Native production capture window lease identity was invalid.");
      }
      currentLeaseId = nativeState.leaseId;
      const domState = dependencies.readDomState();
      lastNativeState = nativeState;
      lastDomState = domState;

      if (limits.timeoutMs - (dependencies.now() - startedAt) <= 0) {
        break;
      }

      if (
        nativeWindowReady(nativeState) &&
        nativeWindowTransitionEvidenceValid(nativeState) &&
        domState.visible &&
        domState.focused
      ) {
        const nextObservation = { domState, nativeState };
        if (
          readyObservation !== null &&
          equivalentReadyObservation(readyObservation, nextObservation)
        ) {
          activationSucceeded = true;
          return nativeState;
        }
        readyObservation = nextObservation;
      } else {
        readyObservation = null;
      }

      if (attempt === limits.maxAttempts) {
        break;
      }

      const afterAttemptMs = limits.timeoutMs - (dependencies.now() - startedAt);
      if (afterAttemptMs <= 0) {
        break;
      }

      await dependencies.delay(Math.min(limits.pollMs, afterAttemptMs));
    }

    throw new Error(
      `Production capture window did not converge within ${limits.timeoutMs} ms or ${limits.maxAttempts} attempts; ${activationStateEvidence(lastNativeState, lastDomState)}.`,
    );
  } finally {
    if (!activationSucceeded && leaseId === null && currentLeaseId !== null) {
      await releaseAcquiredWindowLease(dependencies, runToken, currentLeaseId);
    }
  }
}

function equivalentReadyObservation(
  previous: PerfCaptureWindowReadyObservation,
  next: PerfCaptureWindowReadyObservation,
): boolean {
  return (
    previous.domState.focused === next.domState.focused &&
    previous.domState.visible === next.domState.visible &&
    NATIVE_BOOLEAN_STATE_KEYS.every((key) => previous.nativeState[key] === next.nativeState[key]) &&
    NATIVE_COUNTER_STATE_KEYS.every((key) => previous.nativeState[key] === next.nativeState[key]) &&
    previous.nativeState.leaseId === next.nativeState.leaseId
  );
}

function cleanupLeaseId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const leaseId = (value as Record<string, unknown>).leaseId;
  return typeof leaseId === "string" && /^[!-~]{1,128}$/.test(leaseId) ? leaseId : null;
}

async function releaseAcquiredWindowLease(
  dependencies: PerfProductionCaptureActivationDependencies,
  runToken: string,
  leaseId: string,
): Promise<void> {
  try {
    await dependencies.awaitResponse(
      dependencies.invoke(RELEASE_COMMAND, { runToken, leaseId }),
      RELEASE_TIMEOUT_MS,
    );
  } catch {
    // The production driver aborts the isolated capture app when the authenticated
    // result reports failure, providing the final cleanup boundary.
  }
}

export async function releaseProductionCaptureWindowLease(
  runToken: string,
  leaseId: string,
  overrides: Partial<PerfProductionCaptureActivationDependencies> = {},
): Promise<PerfCaptureNativeWindowState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const startedAt = dependencies.now();
  let failureMessage = "Native production capture window lease release failed.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingMs = RELEASE_TIMEOUT_MS - (dependencies.now() - startedAt);
    if (remainingMs <= 0) {
      break;
    }
    try {
      const state = await invokeWindowLeaseCommand(
        RELEASE_COMMAND,
        runToken,
        leaseId,
        dependencies,
        failureMessage,
        remainingMs,
      );
      if (state.diagnosticSpaceLease) {
        failureMessage = "Native production capture window lease release was not observed.";
        continue;
      }
      return state;
    } catch {
      failureMessage = "Native production capture window lease release failed.";
    }
  }

  throw new Error(failureMessage);
}

export async function resetProductionCaptureWindowLeaseBaseline(
  runToken: string,
  leaseId: string,
  overrides: Partial<PerfProductionCaptureActivationDependencies> = {},
): Promise<PerfCaptureNativeWindowState> {
  const state = await invokeWindowLeaseCommand(
    RESET_BASELINE_COMMAND,
    runToken,
    leaseId,
    overrides,
    "Native production capture window lease baseline reset failed.",
  );
  if (
    state.transitionOverflow ||
    state.windowStabilityEpoch !== 0 ||
    state.appActivationTransitions !== 0 ||
    state.keyTransitions !== 0 ||
    state.minimizeTransitions !== 0 ||
    state.occlusionTransitions !== 0
  ) {
    throw new Error("Native production capture window lease baseline reset was not observed.");
  }
  return state;
}

export async function snapshotProductionCaptureWindowLease(
  runToken: string,
  leaseId: string,
  overrides: Partial<PerfProductionCaptureActivationDependencies> = {},
): Promise<PerfCaptureNativeWindowState> {
  return await invokeWindowLeaseCommand(
    SNAPSHOT_COMMAND,
    runToken,
    leaseId,
    overrides,
    "Native production capture window lease snapshot failed.",
  );
}

async function invokeWindowLeaseCommand(
  command: string,
  runToken: string,
  leaseId: string,
  overrides: Partial<PerfProductionCaptureActivationDependencies>,
  failureMessage: string,
  timeoutMs = RELEASE_TIMEOUT_MS,
): Promise<PerfCaptureNativeWindowState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let rawState: unknown;
  try {
    rawState = await dependencies.awaitResponse(
      dependencies.invoke(command, { runToken, leaseId }),
      timeoutMs,
    );
  } catch {
    throw new Error(failureMessage);
  }
  const state = parseNativeWindowState(rawState);
  if (state.leaseId !== leaseId) {
    throw new Error("Native production capture window lease identity was invalid.");
  }
  return state;
}

function activationStateEvidence(
  nativeState: PerfCaptureNativeWindowState | null,
  domState: PerfCaptureDomWindowState | null,
): string {
  if (nativeState === null || domState === null) {
    return "lastState=unavailable";
  }

  return [
    `native.active=${String(nativeState.active)}`,
    `native.appActivationTransitions=${String(nativeState.appActivationTransitions)}`,
    `native.hidden=${String(nativeState.hidden)}`,
    `native.visible=${String(nativeState.visible)}`,
    `native.key=${String(nativeState.key)}`,
    `native.keyTransitions=${String(nativeState.keyTransitions)}`,
    `native.leaseIdPresent=${String(nativeState.leaseId.length > 0)}`,
    `native.minimized=${String(nativeState.minimized)}`,
    `native.minimizeTransitions=${String(nativeState.minimizeTransitions)}`,
    `native.occluded=${String(nativeState.occluded)}`,
    `native.occlusionTransitions=${String(nativeState.occlusionTransitions)}`,
    `native.occlusionVisible=${String(nativeState.occlusionVisible)}`,
    `native.onActiveSpace=${String(nativeState.onActiveSpace)}`,
    `native.transitionOverflow=${String(nativeState.transitionOverflow)}`,
    `native.diagnosticSpaceLease=${String(nativeState.diagnosticSpaceLease)}`,
    `native.windowStabilityEpoch=${String(nativeState.windowStabilityEpoch)}`,
    `dom.visible=${String(domState.visible)}`,
    `dom.focused=${String(domState.focused)}`,
  ].join(",");
}

function parseActivationLimits(value: unknown): PerfProductionCaptureActivationLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Production capture activation limits were invalid.");
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const maxAttempts = candidate.maxAttempts;
  const pollMs = candidate.pollMs;
  const timeoutMs = candidate.timeoutMs;

  if (
    keys.length !== ACTIVATION_LIMIT_KEYS.length ||
    !ACTIVATION_LIMIT_KEYS.every((key, index) => keys[index] === key) ||
    !Number.isSafeInteger(maxAttempts) ||
    !Number.isSafeInteger(pollMs) ||
    !Number.isSafeInteger(timeoutMs) ||
    (maxAttempts as number) < 1 ||
    (maxAttempts as number) > MAX_ALLOWED_ACTIVATION_ATTEMPTS ||
    (pollMs as number) < 1 ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > MAX_ALLOWED_ACTIVATION_TIMEOUT_MS ||
    (maxAttempts as number) * (pollMs as number) > (timeoutMs as number)
  ) {
    throw new Error("Production capture activation limits were invalid.");
  }

  return {
    maxAttempts: maxAttempts as number,
    pollMs: pollMs as number,
    timeoutMs: timeoutMs as number,
  };
}

function parseNativeWindowState(value: unknown): PerfCaptureNativeWindowState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native production capture window state was invalid.");
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();

  if (
    keys.length !== NATIVE_STATE_KEYS.length ||
    !NATIVE_STATE_KEYS.every((key, index) => keys[index] === key) ||
    !NATIVE_BOOLEAN_STATE_KEYS.every((key) => typeof candidate[key] === "boolean") ||
    typeof candidate.leaseId !== "string" ||
    !/^[!-~]{1,128}$/.test(candidate.leaseId) ||
    !NATIVE_COUNTER_STATE_KEYS.every(
      (key) => Number.isSafeInteger(candidate[key]) && (candidate[key] as number) >= 0,
    )
  ) {
    throw new Error("Native production capture window state was invalid.");
  }

  return {
    active: candidate.active as boolean,
    appActivationTransitions: candidate.appActivationTransitions as number,
    diagnosticSpaceLease: candidate.diagnosticSpaceLease as boolean,
    hidden: candidate.hidden as boolean,
    key: candidate.key as boolean,
    keyTransitions: candidate.keyTransitions as number,
    leaseId: candidate.leaseId as string,
    minimized: candidate.minimized as boolean,
    minimizeTransitions: candidate.minimizeTransitions as number,
    occluded: candidate.occluded as boolean,
    occlusionTransitions: candidate.occlusionTransitions as number,
    occlusionVisible: candidate.occlusionVisible as boolean,
    onActiveSpace: candidate.onActiveSpace as boolean,
    transitionOverflow: candidate.transitionOverflow as boolean,
    visible: candidate.visible as boolean,
    windowStabilityEpoch: candidate.windowStabilityEpoch as number,
  };
}

const defaultDependencies: PerfProductionCaptureActivationDependencies = {
  invoke: async (command, args) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke(command, args);
  },
  readDomState: () => ({
    focused: typeof document.hasFocus === "function" && document.hasFocus(),
    visible: document.visibilityState === "visible",
  }),
  now: () => performance.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  awaitResponse: awaitResponseWithin,
};

function awaitResponseWithin(request: Promise<unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Native production capture window activation timed out.")),
      timeoutMs,
    );

    request.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
