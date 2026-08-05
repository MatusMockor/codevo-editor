import { describe, expect, it, vi } from "vitest";
import {
  activateProductionCaptureWindow,
  DEFAULT_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
  DIAGNOSTIC_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
  releaseProductionCaptureWindowLease,
  resetProductionCaptureWindowLeaseBaseline,
  snapshotProductionCaptureWindowLease,
  type PerfProductionCaptureActivationLimits,
} from "./perfProductionCaptureActivation";

const READY = Object.freeze({
  active: true,
  appActivationTransitions: 0,
  diagnosticSpaceLease: true,
  hidden: false,
  key: true,
  keyTransitions: 0,
  leaseId: "lease-1",
  minimized: false,
  minimizeTransitions: 0,
  occluded: false,
  occlusionTransitions: 0,
  occlusionVisible: true,
  onActiveSpace: true,
  transitionOverflow: false,
  visible: true,
  windowStabilityEpoch: 0,
});
const NOT_READY = Object.freeze({ ...READY, active: false, key: false });

function activationFixture(options: {
  readonly nativeStates: readonly unknown[];
  readonly domStates?: readonly { readonly focused: boolean; readonly visible: boolean }[];
  readonly advanceAfterInvokeMs?: readonly number[];
  readonly advanceAfterDomReadMs?: readonly number[];
}) {
  let now = 0;
  let nativeIndex = 0;
  let domIndex = 0;
  const delays: number[] = [];
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => {
    const state = options.nativeStates[Math.min(nativeIndex, options.nativeStates.length - 1)];
    const elapsed =
      options.advanceAfterInvokeMs?.[
        Math.min(nativeIndex, (options.advanceAfterInvokeMs?.length ?? 1) - 1)
      ];
    nativeIndex += 1;
    now += elapsed ?? 0;
    return state;
  });

  return {
    invoke,
    delays,
    dependencies: {
      invoke,
      readDomState: () => {
        const states = options.domStates ?? [{ focused: true, visible: true }];
        const state = states[Math.min(domIndex, states.length - 1)];
        const elapsed =
          options.advanceAfterDomReadMs?.[
            Math.min(domIndex, (options.advanceAfterDomReadMs?.length ?? 1) - 1)
          ];
        domIndex += 1;
        now += elapsed ?? 0;
        return state;
      },
      now: () => now,
      delay: async (ms: number) => {
        delays.push(ms);
        now += ms;
      },
      awaitResponse: async (request: Promise<unknown>) => await request,
    },
  };
}

describe("activateProductionCaptureWindow", () => {
  it("activates once, then requires two equivalent native and DOM snapshots on separate turns", async () => {
    const fixture = activationFixture({
      nativeStates: [NOT_READY, READY, READY],
      domStates: [
        { focused: false, visible: true },
        { focused: false, visible: true },
        { focused: true, visible: true },
      ],
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies),
    ).resolves.toEqual(READY);

    expect(fixture.invoke).toHaveBeenCalledTimes(4);
    expect(fixture.invoke).toHaveBeenNthCalledWith(1, "perf_capture_activate_window", {
      runToken: "run-token",
    });
    expect(fixture.invoke).toHaveBeenNthCalledWith(2, "perf_capture_snapshot_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(
      fixture.invoke.mock.calls.filter(([command]) => command === "perf_capture_activate_window"),
    ).toHaveLength(1);
    expect(fixture.delays).toEqual([50, 50, 50]);
  });

  it("reactivates an exact existing lease once, then polls stable snapshots", async () => {
    const fixture = activationFixture({
      nativeStates: [NOT_READY, READY, READY],
      domStates: [
        { focused: false, visible: true },
        { focused: true, visible: true },
        { focused: true, visible: true },
      ],
    });

    await expect(
      activateProductionCaptureWindow(
        "run-token",
        fixture.dependencies,
        DEFAULT_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
        "lease-1",
      ),
    ).resolves.toEqual(READY);

    expect(fixture.invoke).toHaveBeenNthCalledWith(1, "perf_capture_activate_window", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.invoke).toHaveBeenNthCalledWith(2, "perf_capture_snapshot_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.invoke).toHaveBeenNthCalledWith(3, "perf_capture_snapshot_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.invoke).toHaveBeenCalledTimes(3);
    expect(fixture.delays).toEqual([50, 50]);
  });

  it("rejects a foreign lease response after one authenticated recovery activation", async () => {
    const fixture = activationFixture({ nativeStates: [{ ...READY, leaseId: "lease-2" }] });

    await expect(
      activateProductionCaptureWindow(
        "run-token",
        fixture.dependencies,
        DEFAULT_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
        "lease-1",
      ),
    ).rejects.toThrow("Native production capture window lease identity was invalid.");

    expect(fixture.invoke).toHaveBeenCalledOnce();
    expect(fixture.invoke).toHaveBeenCalledWith("perf_capture_activate_window", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
  });

  it("resets readiness convergence when the native transition generation changes", async () => {
    const transitioned = {
      ...READY,
      appActivationTransitions: 1,
      windowStabilityEpoch: 1,
    };
    const fixture = activationFixture({
      nativeStates: [READY, transitioned, transitioned],
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies),
    ).resolves.toEqual(transitioned);

    expect(fixture.invoke).toHaveBeenCalledTimes(3);
    expect(fixture.delays).toEqual([50, 50]);
  });

  it.each([
    ["overflowed", { ...READY, transitionOverflow: true }],
    ["internally inconsistent", { ...READY, appActivationTransitions: 1 }],
  ])("refuses to converge on %s native transition evidence", async (_label, invalidState) => {
    const fixture = activationFixture({ nativeStates: [READY, invalidState, invalidState] });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies, {
        maxAttempts: 3,
        pollMs: 1,
        timeoutMs: 3,
      }),
    ).rejects.toThrow(/3 ms or 3 attempts/);

    expect(fixture.invoke).toHaveBeenCalledTimes(4);
    expect(fixture.invoke).toHaveBeenLastCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.delays).toEqual([1, 1]);
  });

  it("resets readiness convergence after an intervening non-ready DOM observation", async () => {
    const fixture = activationFixture({
      nativeStates: [READY, READY, READY, READY],
      domStates: [
        { focused: true, visible: true },
        { focused: false, visible: true },
        { focused: true, visible: true },
        { focused: true, visible: true },
      ],
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies),
    ).resolves.toEqual(READY);

    expect(fixture.invoke).toHaveBeenCalledTimes(4);
    expect(fixture.delays).toEqual([50, 50, 50]);
  });

  it("does not accept a lone ready observation at the attempt boundary", async () => {
    const fixture = activationFixture({ nativeStates: [READY] });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies, {
        maxAttempts: 1,
        pollMs: 1,
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/1 ms or 1 attempts/);

    expect(fixture.invoke).toHaveBeenCalledTimes(2);
    expect(fixture.invoke).toHaveBeenLastCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.delays).toEqual([]);
  });

  it("rejects a ready observation that arrives exactly at the elapsed-time boundary", async () => {
    const fixture = activationFixture({
      nativeStates: [READY],
      advanceAfterInvokeMs: [4],
      advanceAfterDomReadMs: [1],
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies, {
        maxAttempts: 5,
        pollMs: 1,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/5 ms or 5 attempts/);

    expect(fixture.invoke).toHaveBeenCalledTimes(2);
    expect(fixture.invoke).toHaveBeenLastCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.delays).toEqual([]);
  });

  it("fails after exactly 100 non-converging attempts without exceeding five seconds", async () => {
    const fixture = activationFixture({ nativeStates: [NOT_READY] });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies),
    ).rejects.toThrow(/5000 ms or 100 attempts/);

    expect(
      fixture.invoke.mock.calls.filter(([command]) => command === "perf_capture_activate_window"),
    ).toHaveLength(1);
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "perf_capture_snapshot_window_lease",
      ),
    ).toHaveLength(99);
    expect(fixture.invoke).toHaveBeenLastCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.delays).toHaveLength(99);
    expect(fixture.delays.reduce((sum, delay) => sum + delay, 0)).toBe(4_950);
  });

  it("honors the exact bounded diagnostic profile", async () => {
    const fixture = activationFixture({ nativeStates: [NOT_READY] });

    await expect(
      activateProductionCaptureWindow(
        "run-token",
        fixture.dependencies,
        DIAGNOSTIC_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
      ),
    ).rejects.toThrow(/2000 ms or 20 attempts/);

    expect(
      fixture.invoke.mock.calls.filter(([command]) => command === "perf_capture_activate_window"),
    ).toHaveLength(1);
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "perf_capture_snapshot_window_lease",
      ),
    ).toHaveLength(19);
    expect(fixture.invoke).toHaveBeenLastCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.delays).toEqual(Array.from({ length: 19 }, () => 100));
    expect(fixture.delays.reduce((sum, delay) => sum + delay, 0)).toBe(1_900);
  });

  it("requires truthful native occlusion visibility and reports only bounded state evidence", async () => {
    const fixture = activationFixture({
      nativeStates: [{ ...READY, occluded: true, occlusionVisible: false }],
    });

    await expect(
      activateProductionCaptureWindow("secret-run-token", fixture.dependencies, {
        maxAttempts: 1,
        pollMs: 1,
        timeoutMs: 1,
      }),
    ).rejects.toThrow(
      /native\.occluded=true,native\.occlusionTransitions=0,native\.occlusionVisible=false/,
    );
    await expect(
      activateProductionCaptureWindow("secret-run-token", fixture.dependencies, {
        maxAttempts: 1,
        pollMs: 1,
        timeoutMs: 1,
      }),
    ).rejects.not.toThrow(/secret-run-token/);
  });

  it("requires the window to be on the active Space", async () => {
    const fixture = activationFixture({
      nativeStates: [{ ...READY, onActiveSpace: false }],
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies, {
        maxAttempts: 1,
        pollMs: 1,
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/native\.onActiveSpace=false/);
  });

  it("fails closed on malformed or weakened caller-supplied limits before invoking native code", async () => {
    const invalidLimits: readonly unknown[] = [
      null,
      {},
      { maxAttempts: 20, pollMs: 100 },
      { maxAttempts: 20, pollMs: 100, timeoutMs: 2_000, foreign: true },
      { maxAttempts: 20.5, pollMs: 100, timeoutMs: 2_000 },
      { maxAttempts: 0, pollMs: 100, timeoutMs: 2_000 },
      { maxAttempts: 101, pollMs: 10, timeoutMs: 2_000 },
      { maxAttempts: 20, pollMs: 0, timeoutMs: 2_000 },
      { maxAttempts: 20, pollMs: 100, timeoutMs: 5_001 },
      { maxAttempts: 20, pollMs: 101, timeoutMs: 2_000 },
    ];

    for (const limits of invalidLimits) {
      const fixture = activationFixture({ nativeStates: [READY] });
      await expect(
        activateProductionCaptureWindow(
          "run-token",
          fixture.dependencies,
          limits as PerfProductionCaptureActivationLimits,
        ),
      ).rejects.toThrow("Production capture activation limits were invalid.");
      expect(fixture.invoke).not.toHaveBeenCalled();
      expect(fixture.delays).toEqual([]);
    }
  });

  it("fails closed on command rejection without polling again", async () => {
    const fixture = activationFixture({ nativeStates: [READY] });
    fixture.dependencies.invoke = vi.fn(async () => {
      throw new Error("backend detail");
    });

    await expect(
      activateProductionCaptureWindow("run-token", fixture.dependencies),
    ).rejects.toThrow("Native production capture window activation failed.");
    expect(fixture.dependencies.invoke).toHaveBeenCalledOnce();
    expect(fixture.delays).toEqual([]);
  });

  it("rejects unknown, incomplete, and non-boolean native state", async () => {
    for (const invalid of [
      null,
      { ...READY, foreign: false },
      {
        active: true,
        appActivationTransitions: 0,
        diagnosticSpaceLease: true,
        visible: true,
        key: true,
        keyTransitions: 0,
        leaseId: "lease-1",
        minimized: false,
        minimizeTransitions: 0,
        occluded: false,
        occlusionTransitions: 0,
        occlusionVisible: true,
        onActiveSpace: true,
        transitionOverflow: false,
        windowStabilityEpoch: 0,
      },
      { ...READY, key: "yes" },
      { ...READY, onActiveSpace: "yes" },
    ]) {
      const fixture = activationFixture({ nativeStates: [invalid] });
      await expect(
        activateProductionCaptureWindow("run-token", fixture.dependencies),
      ).rejects.toThrow("Native production capture window state was invalid.");
      const expectedCalls =
        invalid &&
        typeof invalid === "object" &&
        "leaseId" in invalid &&
        typeof invalid.leaseId === "string"
          ? 2
          : 1;
      expect(fixture.invoke).toHaveBeenCalledTimes(expectedCalls);
    }
  });
});

describe("releaseProductionCaptureWindowLease", () => {
  it("authenticates release and requires the restored lease state", async () => {
    const fixture = activationFixture({
      nativeStates: [{ ...READY, diagnosticSpaceLease: false }],
    });

    await expect(
      releaseProductionCaptureWindowLease("run-token", "lease-1", fixture.dependencies),
    ).resolves.toMatchObject({ diagnosticSpaceLease: false });
    expect(fixture.invoke).toHaveBeenCalledWith("perf_capture_release_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
  });

  it("retries one transient restoration readback within the bounded release budget", async () => {
    const fixture = activationFixture({
      nativeStates: [READY, { ...READY, diagnosticSpaceLease: false }],
    });

    await expect(
      releaseProductionCaptureWindowLease("run-token", "lease-1", fixture.dependencies),
    ).resolves.toMatchObject({ diagnosticSpaceLease: false });
    expect(fixture.invoke).toHaveBeenCalledTimes(2);
  });

  it("fails closed when native restoration is rejected or remains leased", async () => {
    const stillLeased = activationFixture({ nativeStates: [READY] });
    await expect(
      releaseProductionCaptureWindowLease("run-token", "lease-1", stillLeased.dependencies),
    ).rejects.toThrow("Native production capture window lease release was not observed.");

    const rejected = activationFixture({ nativeStates: [READY] });
    rejected.dependencies.invoke = vi.fn(async () => {
      throw new Error("backend detail");
    });
    await expect(
      releaseProductionCaptureWindowLease("run-token", "lease-1", rejected.dependencies),
    ).rejects.toThrow("Native production capture window lease release failed.");
  });
});

describe("native window lease authority", () => {
  it("resets an exact zero baseline and reads a non-mutating identified snapshot", async () => {
    const fixture = activationFixture({ nativeStates: [READY, READY] });

    await expect(
      resetProductionCaptureWindowLeaseBaseline("run-token", "lease-1", fixture.dependencies),
    ).resolves.toEqual(READY);
    await expect(
      snapshotProductionCaptureWindowLease("run-token", "lease-1", fixture.dependencies),
    ).resolves.toEqual(READY);
    expect(fixture.invoke).toHaveBeenNthCalledWith(1, "perf_capture_reset_window_lease_baseline", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
    expect(fixture.invoke).toHaveBeenNthCalledWith(2, "perf_capture_snapshot_window_lease", {
      runToken: "run-token",
      leaseId: "lease-1",
    });
  });

  it("rejects nonzero reset evidence and foreign snapshot identity", async () => {
    const nonzero = activationFixture({
      nativeStates: [{ ...READY, appActivationTransitions: 1, windowStabilityEpoch: 1 }],
    });
    await expect(
      resetProductionCaptureWindowLeaseBaseline("run-token", "lease-1", nonzero.dependencies),
    ).rejects.toThrow(/baseline reset was not observed/);

    const foreign = activationFixture({ nativeStates: [{ ...READY, leaseId: "lease-2" }] });
    await expect(
      snapshotProductionCaptureWindowLease("run-token", "lease-1", foreign.dependencies),
    ).rejects.toThrow(/lease identity was invalid/);
  });
});
