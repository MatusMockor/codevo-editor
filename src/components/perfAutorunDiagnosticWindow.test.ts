// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  annotateDiagnosticWindowInterruptions,
  annotateReleasedNativeWindowState,
  createDiagnosticActivationLease,
  verifyDiagnosticWindowTransaction,
} from "./perfAutorunDiagnosticWindow";
import {
  nativeWindowTransitionCount,
  nativeWindowTransitionEvidenceValid,
  type PerfCaptureNativeWindowState,
} from "./perfCaptureNativeWindowState";

function nativeState(
  overrides: Partial<PerfCaptureNativeWindowState> = {},
): PerfCaptureNativeWindowState {
  return {
    active: true,
    appActivationTransitions: 0,
    diagnosticSpaceLease: true,
    hidden: false,
    key: true,
    keyTransitions: 0,
    leaseId: "lease-id",
    minimized: false,
    minimizeTransitions: 0,
    occluded: false,
    occlusionTransitions: 0,
    occlusionVisible: true,
    onActiveSpace: true,
    transitionOverflow: false,
    visible: true,
    windowStabilityEpoch: 0,
    ...overrides,
  };
}

describe("diagnostic activation lease", () => {
  it("coalesces an interruption episode and preserves exact native lease authority", async () => {
    let now = 1_000;
    const reactivate = vi.fn(async () => nativeState());
    const lease = createDiagnosticActivationLease(
      {
        now: () => now,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: reactivate,
        sleep: async (ms) => {
          now += ms;
        },
      },
      "run-token",
      "lease-id",
      true,
    );

    lease.recordInterruption("typing");
    lease.recordInterruption("typing");
    await lease.settle();

    expect(reactivate).toHaveBeenCalledOnce();
    expect(reactivate).toHaveBeenCalledWith("run-token", "lease-id");
    expect(lease.domSignalCount()).toBe(2);
    expect(lease.interruptionCount()).toBe(1);
    expect(lease.interruptionStages()).toEqual(["typing"]);
  });

  it("closes synchronously before awaiting an existing native recovery", async () => {
    let resolveRecovery!: (state: PerfCaptureNativeWindowState) => void;
    const reactivate = vi.fn(
      () =>
        new Promise<PerfCaptureNativeWindowState>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const lease = createDiagnosticActivationLease(
      {
        now: () => 1_000,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: reactivate,
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );

    lease.recordInterruption("typing");
    const closing = lease.close();
    lease.recordInterruption("late-cleanup-signal");
    resolveRecovery(nativeState());
    await closing;

    expect(reactivate).toHaveBeenCalledOnce();
    expect(lease.domSignalCount()).toBe(1);
    expect(lease.interruptionStages()).toEqual(["typing"]);
  });

  it("coalesces signals across stages while one recovery is still in flight", async () => {
    let now = 1_000;
    let resolveRecovery!: (state: PerfCaptureNativeWindowState) => void;
    const lease = createDiagnosticActivationLease(
      {
        now: () => now,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: () =>
          new Promise<PerfCaptureNativeWindowState>((resolve) => {
            resolveRecovery = resolve;
          }),
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );

    for (const stage of [
      "open-large-files-workspace",
      "open-file",
      "open-file",
      "measure-large-file-tab-switches",
    ]) {
      lease.recordInterruption(stage);
      now += 300;
    }

    expect(lease.domSignalCount()).toBe(4);
    expect(lease.interruptionCount()).toBe(1);
    expect(lease.interruptionStages()).toEqual(["open-large-files-workspace"]);
    expect(lease.recoveryInterventionCount()).toBe(1);
    resolveRecovery(nativeState());
    await lease.settle();
    expect(lease.failure()).toBeNull();
  });

  it("reports only bounded stage and count evidence when interruption budget is exhausted", async () => {
    let now = 1_000;
    const lease = createDiagnosticActivationLease(
      {
        now: () => now,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: async () => nativeState(),
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );

    for (const stage of ["typing", "references", "definition"]) {
      lease.recordInterruption(stage);
      await lease.settle();
      now += 300;
    }
    lease.recordInterruption("rename");

    expect(lease.failure()).toBe(
      "Perf diagnostic capture exceeded 3 window interruptions; " +
        "stages=typing,references,definition; nextStage=rename; " +
        "domSignals=4; recoveryInterventions=3",
    );
  });

  it("shapes recovered diagnostic results without exposing the private lease id", () => {
    const lease = createDiagnosticActivationLease(
      {
        now: () => 0,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: async () => nativeState(),
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );
    lease.recordInterruption("open-file");

    const payload = annotateDiagnosticWindowInterruptions(
      JSON.stringify({
        status: "ok",
        result: {
          bridgeResults: [{ id: "typing-large-5k" }],
          scenarioStatuses: [{ id: "typing-large-5k", status: "ok" }],
        },
      }),
      lease,
    );
    const parsed = JSON.parse(payload) as {
      readonly result: { readonly environment: Record<string, unknown> };
    };

    expect(parsed.result.environment).toMatchObject({
      diagnosticSpaceLease: true,
      domWindowSignalCount: 1,
      windowInterruptionCount: 1,
      windowInterruptionStages: ["open-file"],
      windowStability: "recovered-diagnostic",
    });
    expect(payload).not.toContain("lease-id");
  });

  it("records a native transition that settled before the first postflight snapshot", async () => {
    let now = 1_000;
    const transitioned = nativeState({
      appActivationTransitions: 1,
      windowStabilityEpoch: 1,
    });
    const reactivate = vi.fn(async () => transitioned);
    const preflight = vi.fn(async () => {});
    const lease = createDiagnosticActivationLease(
      {
        now: () => now,
        preflightMeasurementWindow: preflight,
        reactivateDiagnosticProductionCaptureWindow: reactivate,
        sleep: async (ms) => {
          now += ms;
        },
      },
      "run-token",
      "lease-id",
      true,
    );

    await verifyDiagnosticWindowTransaction(
      { preflightMeasurementWindow: preflight },
      lease,
      async () => {},
      async () => transitioned,
    );

    expect(reactivate).toHaveBeenCalledOnce();
    expect(lease.domSignalCount()).toBe(0);
    expect(lease.interruptionCount()).toBe(1);
    expect(lease.interruptionStages()).toEqual(["native-window-transition"]);
    expect(preflight).toHaveBeenCalledOnce();
  });

  it("does not recursively recover transitions caused by its own native recovery", async () => {
    const interrupted = nativeState({
      appActivationTransitions: 1,
      windowStabilityEpoch: 1,
    });
    const recovered = nativeState({
      appActivationTransitions: 1,
      keyTransitions: 2,
      windowStabilityEpoch: 3,
    });
    const reactivate = vi.fn(async () => recovered);
    const snapshots = [interrupted, recovered, recovered];
    const lease = createDiagnosticActivationLease(
      {
        now: () => 1_000,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: reactivate,
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );

    await verifyDiagnosticWindowTransaction(
      { preflightMeasurementWindow: async () => {} },
      lease,
      async () => {},
      async () => snapshots.shift() ?? recovered,
    );

    expect(reactivate).toHaveBeenCalledOnce();
    expect(lease.recoveryInterventionCount()).toBe(1);
    expect(lease.interruptionCount()).toBe(1);
    expect(lease.recoveredNativeEpoch()).toBe(3);
  });

  it("acknowledges the native epochs from DOM recovery and final convergence", async () => {
    const firstRecovery = nativeState({
      appActivationTransitions: 1,
      keyTransitions: 1,
      windowStabilityEpoch: 2,
    });
    const finalConvergence = nativeState({
      appActivationTransitions: 2,
      keyTransitions: 2,
      windowStabilityEpoch: 4,
    });
    const recoveryStates = [firstRecovery, finalConvergence];
    const reactivate = vi.fn(async () => recoveryStates.shift() ?? finalConvergence);
    const lease = createDiagnosticActivationLease(
      {
        now: () => 1_000,
        preflightMeasurementWindow: async () => {},
        reactivateDiagnosticProductionCaptureWindow: reactivate,
        sleep: async () => {},
      },
      "run-token",
      "lease-id",
      true,
    );
    lease.recordInterruption("typing");

    await verifyDiagnosticWindowTransaction(
      { preflightMeasurementWindow: async () => {} },
      lease,
      async () => {},
      async () => finalConvergence,
    );

    expect(reactivate).toHaveBeenCalledTimes(2);
    expect(lease.recoveryInterventionCount()).toBe(2);
    expect(lease.interruptionCount()).toBe(1);
    expect(lease.recoveredNativeEpoch()).toBe(4);
  });
});

describe("native transition evidence", () => {
  it("accounts for every transition category and rejects overflow", () => {
    const valid = nativeState({
      appActivationTransitions: 1,
      keyTransitions: 2,
      minimizeTransitions: 3,
      occlusionTransitions: 4,
      windowStabilityEpoch: 10,
    });

    expect(nativeWindowTransitionCount(valid)).toBe(10);
    expect(nativeWindowTransitionEvidenceValid(valid)).toBe(true);
    expect(nativeWindowTransitionEvidenceValid({ ...valid, transitionOverflow: true })).toBe(false);
    expect(nativeWindowTransitionEvidenceValid({ ...valid, windowStabilityEpoch: 9 })).toBe(false);
  });

  it("adds bounded native counters to successful result metadata", () => {
    const payload = annotateReleasedNativeWindowState(
      JSON.stringify({ status: "ok", result: { environment: { retained: true } } }),
      nativeState({
        diagnosticSpaceLease: false,
        appActivationTransitions: 1,
        keyTransitions: 2,
        minimizeTransitions: 3,
        occlusionTransitions: 4,
        windowStabilityEpoch: 10,
      }),
    );

    expect(JSON.parse(payload).result.environment).toEqual({
      retained: true,
      appActivationTransitions: 1,
      keyTransitions: 2,
      minimizeTransitions: 3,
      occlusionTransitions: 4,
      onActiveSpaceAtRelease: true,
      transitionOverflow: false,
      windowStabilityEpoch: 10,
    });
  });
});
