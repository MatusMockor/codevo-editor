import {
  assertNativeWindowTransitionEvidence,
  nativeWindowReady,
  nativeWindowTransitionEvidenceValid,
  type PerfCaptureNativeWindowState,
} from "./perfCaptureNativeWindowState";

const MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS = 3;
const MAX_DIAGNOSTIC_DOM_SIGNALS = 64;
const MIN_DIAGNOSTIC_INTERVENTION_INTERVAL_MS = 250;

export interface PerfAutorunWindowGuard {
  failure(): string | null;
  interruptionCount?(): number;
  interruptionStages?(): readonly string[];
  dispose(): void;
}

export interface PerfAutorunWindowGuardOptions {
  readonly recordDiagnosticInterruption?: (stage: string) => void;
}

export interface DiagnosticActivationLease {
  readonly close: () => Promise<void>;
  readonly diagnosticSpaceLeaseObserved: () => boolean;
  readonly dispose: () => void;
  readonly domSignalCount: () => number;
  readonly ensureFinalConvergence: () => Promise<void>;
  readonly epoch: () => number;
  readonly failure: () => string | null;
  readonly interruptionCount: () => number;
  readonly interruptionStages: () => readonly string[];
  readonly recoveryInterventionCount: () => number;
  readonly recordInterruption: (stage: string) => void;
  readonly recordNativeInterruption: () => void;
  readonly recoveredNativeEpoch: () => number;
  readonly settle: () => Promise<void>;
}

export interface DiagnosticActivationDependencies {
  readonly now: () => number;
  readonly preflightMeasurementWindow: () => Promise<void>;
  readonly reactivateDiagnosticProductionCaptureWindow: (
    runToken: string,
    leaseId: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly sleep: (ms: number) => Promise<void>;
}

export function installMeasurementWindowGuard(
  options: PerfAutorunWindowGuardOptions = {},
): PerfAutorunWindowGuard {
  let failure: string | null = null;
  let interruptionCount = 0;
  const interruptionStages: string[] = [];
  const recordInterruptionOrFailure = (failureMessage: string) => {
    const stage = measurementProgressStage();

    if (options.recordDiagnosticInterruption) {
      interruptionCount += 1;
      if (interruptionStages.length < MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS) {
        interruptionStages.push(stage);
      }
      options.recordDiagnosticInterruption(stage);
      return;
    }

    failure ??= failureMessage;
  };
  const recordBlur = () => {
    recordInterruptionOrFailure("Perf autorun measurement window lost focus during the run.");
  };
  const recordVisibility = () => {
    if (document.visibilityState !== "visible") {
      recordInterruptionOrFailure(
        `Perf autorun measurement window became ${document.visibilityState} during the run.`,
      );
    }
  };
  const recordResize = () => {
    failure ??= "Perf autorun measurement window was resized during the run.";
  };

  window.addEventListener("blur", recordBlur);
  window.addEventListener("resize", recordResize);
  document.addEventListener("visibilitychange", recordVisibility);

  return {
    failure: () => failure,
    interruptionCount: () => interruptionCount,
    interruptionStages: () => [...interruptionStages],
    dispose: () => {
      window.removeEventListener("blur", recordBlur);
      window.removeEventListener("resize", recordResize);
      document.removeEventListener("visibilitychange", recordVisibility);
    },
  };
}

export function createDiagnosticActivationLease(
  dependencies: DiagnosticActivationDependencies,
  runToken: string,
  nativeWindowLeaseId: string,
  initialDiagnosticSpaceLeaseObserved: boolean,
): DiagnosticActivationLease {
  let failure: string | null = null;
  let inFlight: Promise<void> | null = null;
  let activationCount = 0;
  let domSignalCount = 0;
  let interruptionCount = 0;
  let lastActivationAt = Number.NEGATIVE_INFINITY;
  let lastInterruptionAt = Number.NEGATIVE_INFINITY;
  let epoch = 0;
  let disposed = false;
  let diagnosticSpaceLeaseObserved = initialDiagnosticSpaceLeaseObserved;
  let recoveredNativeEpoch = 0;
  const stages: string[] = [];

  const requestActivation = () => {
    if (disposed || failure !== null || inFlight !== null) {
      return;
    }

    const now = dependencies.now();
    if (activationCount >= MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS) {
      failure = `Perf diagnostic capture exceeded ${MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS} window interventions.`;
      return;
    }
    const cooldownMs = Math.max(
      0,
      MIN_DIAGNOSTIC_INTERVENTION_INTERVAL_MS - (now - lastActivationAt),
    );
    const activationEpoch = epoch;
    const activation = (async () => {
      if (cooldownMs > 0) {
        await dependencies.sleep(cooldownMs);
      }
      if (disposed || failure !== null) {
        return;
      }

      activationCount += 1;
      lastActivationAt = dependencies.now();
      try {
        const state = await dependencies.reactivateDiagnosticProductionCaptureWindow(
          runToken,
          nativeWindowLeaseId,
        );
        if (
          state.leaseId !== nativeWindowLeaseId ||
          !state.diagnosticSpaceLease ||
          !nativeWindowReady(state) ||
          !nativeWindowTransitionEvidenceValid(state)
        ) {
          throw new Error("Production capture window did not converge after native recovery.");
        }
        if (state.windowStabilityEpoch < recoveredNativeEpoch) {
          throw new Error("Production capture window did not converge after native recovery.");
        }
        recoveredNativeEpoch = state.windowStabilityEpoch;
        diagnosticSpaceLeaseObserved = true;
      } catch (error) {
        if (activationEpoch <= epoch) {
          const message = errorMessage(error);
          failure = message.startsWith("Production capture window did not converge")
            ? `Perf diagnostic capture could not recover its measurement window: ${message}`
            : "Perf diagnostic capture could not recover its measurement window.";
        }
      }
    })();
    const tracked = activation.finally(() => {
      if (inFlight === tracked) {
        inFlight = null;
      }
      if (!disposed) {
        epoch += 1;
      }
    });
    inFlight = tracked;
  };

  const recordInterruptionEvidence = (stage: string, domSignal: boolean) => {
    if (disposed || failure !== null) {
      return;
    }

    if (domSignal && domSignalCount >= MAX_DIAGNOSTIC_DOM_SIGNALS) {
      failure = `Perf diagnostic capture exceeded ${MAX_DIAGNOSTIC_DOM_SIGNALS} DOM window signals.`;
      return;
    }
    if (domSignal) {
      domSignalCount += 1;
    }
    const now = dependencies.now();
    const sameEpisode =
      inFlight !== null || now - lastInterruptionAt < MIN_DIAGNOSTIC_INTERVENTION_INTERVAL_MS;
    if (!sameEpisode) {
      if (interruptionCount >= MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS) {
        failure = [
          `Perf diagnostic capture exceeded ${MAX_DIAGNOSTIC_WINDOW_INTERVENTIONS} window interruptions`,
          `stages=${stages.join(",")}`,
          `nextStage=${stage}`,
          `domSignals=${String(domSignalCount)}`,
          `recoveryInterventions=${String(activationCount)}`,
        ].join("; ");
        return;
      }
      interruptionCount += 1;
      lastInterruptionAt = now;
      stages.push(stage);
    }
    epoch += 1;
    requestActivation();
  };
  const recordInterruption = (stage: string) => recordInterruptionEvidence(stage, true);

  return {
    close: async () => {
      const pendingActivation = inFlight;
      disposed = true;
      epoch += 1;
      await pendingActivation;
      if (inFlight === pendingActivation) {
        inFlight = null;
      }
    },
    diagnosticSpaceLeaseObserved: () => diagnosticSpaceLeaseObserved,
    dispose: () => {
      disposed = true;
      epoch += 1;
      inFlight = null;
    },
    domSignalCount: () => domSignalCount,
    ensureFinalConvergence: async () => {
      await inFlight;
      if (disposed || failure !== null) {
        return;
      }
      requestActivation();
      await inFlight;
    },
    epoch: () => epoch,
    failure: () => failure,
    interruptionCount: () => interruptionCount,
    interruptionStages: () => [...stages],
    recoveryInterventionCount: () => activationCount,
    recordInterruption,
    recordNativeInterruption: () => recordInterruptionEvidence("native-window-transition", false),
    recoveredNativeEpoch: () => recoveredNativeEpoch,
    settle: async () => {
      await inFlight;
    },
  };
}

export async function verifyDiagnosticWindowTransaction(
  dependencies: Pick<DiagnosticActivationDependencies, "preflightMeasurementWindow">,
  diagnosticLease: DiagnosticActivationLease,
  verifyNativeWindow: () => Promise<void>,
  snapshotNativeWindow: () => Promise<PerfCaptureNativeWindowState>,
): Promise<void> {
  let finalConvergencePerformed = false;
  let observedNativeEpoch = 0;
  const observeRecoveredNativeEpoch = () => {
    observedNativeEpoch = Math.max(observedNativeEpoch, diagnosticLease.recoveredNativeEpoch());
  };
  const settleAndObserveRecovery = async () => {
    await diagnosticLease.settle();
    throwIfDiagnosticActivationFailed(diagnosticLease);
    observeRecoveredNativeEpoch();
  };

  while (true) {
    await settleAndObserveRecovery();
    if (!finalConvergencePerformed && diagnosticLease.interruptionCount() > 0) {
      await diagnosticLease.ensureFinalConvergence();
      throwIfDiagnosticActivationFailed(diagnosticLease);
      observeRecoveredNativeEpoch();
      finalConvergencePerformed = true;
    }

    const stableEpoch = diagnosticLease.epoch();
    const nativeBefore = await snapshotNativeWindow();
    assertNativeWindowTransitionEvidence(nativeBefore);
    if (nativeBefore.windowStabilityEpoch < observedNativeEpoch) {
      throw new Error("Perf production capture native window transition evidence regressed.");
    }
    if (nativeBefore.windowStabilityEpoch > observedNativeEpoch) {
      observedNativeEpoch = nativeBefore.windowStabilityEpoch;
      diagnosticLease.recordNativeInterruption();
      finalConvergencePerformed = true;
      continue;
    }
    await dependencies.preflightMeasurementWindow();
    await settleAndObserveRecovery();
    await verifyNativeWindow();
    await settleAndObserveRecovery();
    const nativeAfter = await snapshotNativeWindow();
    assertNativeWindowTransitionEvidence(nativeAfter);

    if (nativeAfter.windowStabilityEpoch < observedNativeEpoch) {
      throw new Error("Perf production capture native window transition evidence regressed.");
    }
    if (nativeAfter.windowStabilityEpoch > observedNativeEpoch) {
      observedNativeEpoch = nativeAfter.windowStabilityEpoch;
      diagnosticLease.recordNativeInterruption();
      finalConvergencePerformed = true;
      continue;
    }

    if (diagnosticLease.epoch() === stableEpoch) {
      return;
    }
  }
}

export function throwIfDiagnosticActivationFailed(lease: DiagnosticActivationLease | null): void {
  const failure = lease?.failure() ?? null;
  if (failure !== null) {
    throw new Error(failure);
  }
}

export function annotateDiagnosticWindowInterruptions(
  payload: string,
  lease: DiagnosticActivationLease,
): string {
  const parsed = parseDiagnosticResultEnvelope(payload);
  if (parsed === null) {
    return payload;
  }

  const { envelope, result } = parsed;
  const environment = resultEnvironment(result);
  const bridgeResults = Array.isArray(result.bridgeResults) ? result.bridgeResults : [];
  const scenarioStatuses = Array.isArray(result.scenarioStatuses) ? result.scenarioStatuses : [];
  const bridgeIds = new Set(
    bridgeResults.flatMap((entry) =>
      entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
        ? [(entry as { id: string }).id]
        : [],
    ),
  );
  const nonComparableStatus = (id: string) => ({
    id,
    status: "non-comparable",
    reason: "The diagnostic smoke used a native window space lease or recovery intervention.",
  });
  const normalizedStatuses = scenarioStatuses.map((status) => {
    if (!status || typeof status !== "object") {
      return status;
    }
    const candidate = status as { readonly id?: unknown; readonly status?: unknown };
    return typeof candidate.id === "string" &&
      candidate.status === "ok" &&
      bridgeIds.has(candidate.id)
      ? nonComparableStatus(candidate.id)
      : status;
  });
  const existingStatusIds = new Set(
    normalizedStatuses.flatMap((status) =>
      status && typeof status === "object" && typeof (status as { id?: unknown }).id === "string"
        ? [(status as { id: string }).id]
        : [],
    ),
  );
  const nonComparableStatuses = bridgeResults.flatMap((entry) => {
    const id =
      entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
        ? (entry as { id: string }).id
        : null;
    return id !== null && !existingStatusIds.has(id) ? [nonComparableStatus(id)] : [];
  });

  return JSON.stringify({
    ...envelope,
    result: {
      ...result,
      environment: {
        ...environment,
        diagnosticSpaceLease: lease.diagnosticSpaceLeaseObserved(),
        domWindowSignalCount: lease.domSignalCount(),
        windowInterruptionCount: lease.interruptionCount(),
        windowInterruptionStages: lease.interruptionStages(),
        windowRecoveryInterventionCount: lease.recoveryInterventionCount(),
        windowStability:
          lease.interruptionCount() > 0 ? "recovered-diagnostic" : "diagnostic-space-lease",
      },
      scenarioStatuses: [...normalizedStatuses, ...nonComparableStatuses],
    },
  });
}

export function annotateReleasedNativeWindowState(
  payload: string,
  state: PerfCaptureNativeWindowState,
): string {
  const parsed = parseDiagnosticResultEnvelope(payload);
  if (parsed === null) {
    return payload;
  }
  const { envelope, result } = parsed;

  return JSON.stringify({
    ...envelope,
    result: {
      ...result,
      environment: {
        ...resultEnvironment(result),
        appActivationTransitions: state.appActivationTransitions,
        keyTransitions: state.keyTransitions,
        minimizeTransitions: state.minimizeTransitions,
        occlusionTransitions: state.occlusionTransitions,
        onActiveSpaceAtRelease: state.onActiveSpace,
        transitionOverflow: state.transitionOverflow,
        windowStabilityEpoch: state.windowStabilityEpoch,
      },
    },
  });
}

function measurementProgressStage(): string {
  const progress = (
    window as unknown as {
      readonly __codevoPerfProgress?: { readonly stage?: unknown };
    }
  ).__codevoPerfProgress;
  const stage = progress?.stage;

  if (typeof stage !== "string") {
    return "before-scenarios";
  }

  if (stage.startsWith("open file:")) return "open-file";
  if (stage.startsWith("typing ")) return "typing";
  if (stage.startsWith("wait for JS/TS language server before typing ")) {
    return "typing-language-server-wait";
  }
  if (stage.startsWith("warm up quick open:")) return "quick-open-warmup";
  if (stage.startsWith("measure quick open:")) return "quick-open-measurement";

  const fixedStages = new Set([
    "open large-files workspace",
    "open large-file tabs",
    "measure large-file tab switches",
    "prepare JS/TS language server",
    "wait for JS/TS language server",
    "measure completion-bounded latency",
    "measure completion-unbounded latency",
    "measure definition latency",
    "measure references latency",
    "measure rename latency",
    "inspect large-document policy",
    "open monorepo workspace",
    "collect performance result",
  ]);

  return fixedStages.has(stage) ? stage.split(" ").join("-") : "unknown";
}

function parseDiagnosticResultEnvelope(
  payload: string,
): { readonly envelope: Record<string, unknown>; readonly result: Record<string, unknown> } | null {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Perf diagnostic capture result payload was invalid.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.status !== "ok" || !envelope.result || typeof envelope.result !== "object") {
    return null;
  }
  return { envelope, result: envelope.result as Record<string, unknown> };
}

function resultEnvironment(result: Record<string, unknown>): Record<string, unknown> {
  return result.environment &&
    typeof result.environment === "object" &&
    !Array.isArray(result.environment)
    ? (result.environment as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
