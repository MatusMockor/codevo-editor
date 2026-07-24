import { describe, expect, it, vi } from "vitest";
import {
  POST_DEBUG_TASK_CLEANUP_ERROR,
  POST_DEBUG_TASK_REVALIDATION_ERROR,
  POST_DEBUG_TASK_RUN_ERROR,
  PostDebugTaskCoordinator,
  type PostDebugTaskArmRequest,
} from "./postDebugTaskCoordinator";

const IDENTITY = {
  rootPath: "/workspace/app",
  sessionId: 7,
  workspaceEpoch: 3,
  workspaceId: "workspace-a",
} as const;

describe("PostDebugTaskCoordinator", () => {
  it("runs exactly once after cleanup and immediate revalidation", async () => {
    const order: string[] = [];
    const coordinator = new PostDebugTaskCoordinator();
    const request = plan({
      cleanup: async () => {
        order.push("cleanup");
      },
      revalidate: async () => {
        order.push("revalidate");
        return true;
      },
      run: async () => {
        order.push("run");
      },
    });

    const armed = coordinator.armAfterAcceptedSession(request);
    expect(armed.kind).toBe("armed");
    if (armed.kind !== "armed") return;
    expect(coordinator.snapshot()).toEqual({ kind: "armed", occupied: false });
    const completion = coordinator.handleTerminal(IDENTITY);
    expect(completion).toBe(armed.lease.completion);
    expect(coordinator.snapshot()).toEqual({ kind: "settling", occupied: true });
    expect(await completion).toEqual({ kind: "completed" });
    expect(order).toEqual(["cleanup", "revalidate", "run"]);
    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "ignored" });
    expect(order).toEqual(["cleanup", "revalidate", "run"]);
  });

  it("bridges one exact terminal-before-acceptance race and ignores its duplicate", async () => {
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();

    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "buffered" });
    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "ignored" });
    const armed = coordinator.armAfterAcceptedSession(plan({ run }));
    expect(armed.kind).toBe("settling");
    if (armed.kind !== "settling") return;
    expect(armed.completion).toBe(armed.lease.completion);
    expect(await armed.completion).toEqual({ kind: "completed" });
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(["/workspace/app/", "/workspace/app\\"])(
    "settles exact leases across the equivalent root spelling %s while rejecting a foreign root",
    async (equivalentRoot) => {
      const armedRun = vi.fn();
      const armedCoordinator = new PostDebugTaskCoordinator();
      const armed = armedCoordinator.armAfterAcceptedSession(plan({ run: armedRun }));
      expect(armed.kind).toBe("armed");
      if (armed.kind !== "armed") return;

      expect(
        await armedCoordinator.handleTerminal({
          rootPath: "/workspace/other",
          sessionId: IDENTITY.sessionId,
        }),
      ).toEqual({ kind: "ignored" });
      await expect(
        armedCoordinator.handleTerminal({
          rootPath: equivalentRoot,
          sessionId: IDENTITY.sessionId,
        }),
      ).resolves.toEqual({ kind: "completed" });
      expect(armedRun).toHaveBeenCalledOnce();

      const earlyRun = vi.fn();
      const earlyCoordinator = new PostDebugTaskCoordinator();
      expect(
        await earlyCoordinator.handleTerminal({
          rootPath: equivalentRoot,
          sessionId: IDENTITY.sessionId,
        }),
      ).toEqual({ kind: "buffered" });
      const early = earlyCoordinator.armAfterAcceptedSession(plan({ run: earlyRun }));
      expect(early.kind).toBe("settling");
      if (early.kind !== "settling") return;
      await expect(early.completion).resolves.toEqual({ kind: "completed" });
      expect(earlyRun).toHaveBeenCalledOnce();
    },
  );

  it("keeps an opaque arm-time lease pending and settles its exact plan on demand", async () => {
    const order: string[] = [];
    const coordinator = new PostDebugTaskCoordinator();
    const armed = coordinator.armAfterAcceptedSession(
      plan({
        cleanup: () => {
          order.push("cleanup");
        },
        revalidate: () => {
          order.push("revalidate");
          return true;
        },
        run: () => {
          order.push("run");
        },
      }),
    );
    expect(armed.kind).toBe("armed");
    if (armed.kind !== "armed") return;

    let settled = false;
    void armed.lease.completion.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(Object.keys(armed.lease)).toEqual(["completion"]);
    expect(JSON.stringify(armed.lease)).not.toMatch(/workspace|session|post-build/);

    const first = coordinator.settleExact(armed.lease);
    const joined = coordinator.settleExact(armed.lease);
    expect(first).toBe(armed.lease.completion);
    expect(joined).toBe(armed.lease.completion);
    await expect(first).resolves.toEqual({ kind: "completed" });
    expect(order).toEqual(["cleanup", "revalidate", "run"]);
    expect(coordinator.settleExact(armed.lease)).toBe(armed.lease.completion);
  });

  it("rejects a lease owned by another coordinator without disturbing the armed plan", async () => {
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    const foreignCoordinator = new PostDebugTaskCoordinator();
    const armed = coordinator.armAfterAcceptedSession(plan({ run }));
    const foreign = foreignCoordinator.armAfterAcceptedSession(plan());
    expect(armed.kind).toBe("armed");
    expect(foreign.kind).toBe("armed");
    if (armed.kind !== "armed" || foreign.kind !== "armed") return;

    expect(await coordinator.settleExact(foreign.lease)).toEqual({ kind: "ignored" });
    expect(coordinator.snapshot()).toEqual({ kind: "armed", occupied: false });
    expect(run).not.toHaveBeenCalled();

    await expect(coordinator.settleExact(armed.lease)).resolves.toEqual({ kind: "completed" });
    foreignCoordinator.dispose();
  });

  it("rejects malformed lease values without throwing or changing ownership", async () => {
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    const armed = coordinator.armAfterAcceptedSession(plan({ run }));
    expect(armed.kind).toBe("armed");
    if (armed.kind !== "armed") return;

    for (const candidate of [undefined, null, {}, { completion: Promise.resolve() }]) {
      await expect(
        coordinator.settleExact(candidate as unknown as typeof armed.lease),
      ).resolves.toEqual({ kind: "ignored" });
    }
    expect(coordinator.snapshot()).toEqual({ kind: "armed", occupied: false });
    expect(run).not.toHaveBeenCalled();

    await expect(coordinator.settleExact(armed.lease)).resolves.toEqual({ kind: "completed" });
  });

  it("ignores foreign and duplicate terminal identities while occupied", async () => {
    const cleanup = deferred<void>();
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    coordinator.armAfterAcceptedSession(plan({ cleanup: () => cleanup.promise, run }));

    expect(
      await coordinator.handleTerminal({ rootPath: "/other", sessionId: IDENTITY.sessionId }),
    ).toEqual({ kind: "ignored" });
    const completion = coordinator.handleTerminal(IDENTITY);
    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "ignored" });
    expect(
      await coordinator.handleTerminal({
        rootPath: IDENTITY.rootPath,
        sessionId: IDENTITY.sessionId + 1,
      }),
    ).toEqual({ kind: "ignored" });
    cleanup.resolve();
    expect(await completion).toEqual({ kind: "completed" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("cancels after cleanup when the exact workspace is invalidated", async () => {
    const cleanup = deferred<void>();
    const revalidate = vi.fn(() => true);
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    const armed = coordinator.armAfterAcceptedSession(
      plan({ cleanup: () => cleanup.promise, revalidate, run }),
    );
    expect(armed.kind).toBe("armed");
    if (armed.kind !== "armed") return;
    const completion = coordinator.handleTerminal(IDENTITY);

    expect(
      coordinator.invalidate({
        rootPath: IDENTITY.rootPath,
        workspaceEpoch: IDENTITY.workspaceEpoch + 1,
        workspaceId: IDENTITY.workspaceId,
      }),
    ).toBe(false);
    expect(coordinator.invalidate(IDENTITY)).toBe(true);
    let leaseSettled = false;
    void armed.lease.completion.then(() => {
      leaseSettled = true;
    });
    await Promise.resolve();
    expect(leaseSettled).toBe(false);
    cleanup.resolve();

    expect(await completion).toEqual({ kind: "cancelled" });
    expect(revalidate).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("gives cancellation precedence when an invalidated asynchronous stage rejects", async () => {
    const cleanup = deferred<void>();
    const reportError = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    const armed = coordinator.armAfterAcceptedSession(
      plan({ cleanup: () => cleanup.promise, reportError }),
    );
    expect(armed.kind).toBe("armed");
    if (armed.kind !== "armed") return;
    const completion = coordinator.settleExact(armed.lease);

    expect(coordinator.invalidate(IDENTITY)).toBe(true);
    cleanup.reject(new Error("private failure"));

    await expect(completion).resolves.toEqual({ kind: "cancelled" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("resolves an armed lease as cancelled on invalidation or disposal", async () => {
    const invalidated = new PostDebugTaskCoordinator();
    const invalidatedArm = invalidated.armAfterAcceptedSession(plan());
    expect(invalidatedArm.kind).toBe("armed");
    if (invalidatedArm.kind !== "armed") return;

    expect(invalidated.invalidate(IDENTITY)).toBe(true);
    await expect(invalidatedArm.lease.completion).resolves.toEqual({ kind: "cancelled" });
    expect(await invalidated.settleExact(invalidatedArm.lease)).toEqual({ kind: "cancelled" });

    const disposed = new PostDebugTaskCoordinator();
    const disposedArm = disposed.armAfterAcceptedSession(plan());
    expect(disposedArm.kind).toBe("armed");
    if (disposedArm.kind !== "armed") return;

    disposed.dispose();
    await expect(disposedArm.lease.completion).resolves.toEqual({ kind: "cancelled" });
    expect(await disposed.settleExact(disposedArm.lease)).toEqual({ kind: "cancelled" });
  });

  it("clears only buffered terminal tombstones for the invalidated exact root", async () => {
    const coordinator = new PostDebugTaskCoordinator();
    const other = { ...IDENTITY, rootPath: "/workspace/other", sessionId: 8 };
    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "buffered" });
    expect(await coordinator.handleTerminal(other)).toEqual({ kind: "buffered" });

    expect(coordinator.invalidate(IDENTITY)).toBe(true);

    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "buffered" });
    expect(await coordinator.handleTerminal(other)).toEqual({ kind: "ignored" });
  });

  it("does not run when disposed during asynchronous revalidation", async () => {
    const validation = deferred<boolean>();
    const run = vi.fn();
    const coordinator = new PostDebugTaskCoordinator();
    coordinator.armAfterAcceptedSession(plan({ revalidate: () => validation.promise, run }));
    const completion = coordinator.handleTerminal(IDENTITY);
    await Promise.resolve();
    coordinator.dispose();
    let leaseSettled = false;
    void completion.then(() => {
      leaseSettled = true;
    });
    await Promise.resolve();
    expect(leaseSettled).toBe(false);
    validation.resolve(true);

    expect(await completion).toEqual({ kind: "cancelled" });
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toEqual({ kind: "disposed", occupied: false });
  });

  it.each([
    ["cleanup", POST_DEBUG_TASK_CLEANUP_ERROR],
    ["revalidate", POST_DEBUG_TASK_REVALIDATION_ERROR],
    ["run", POST_DEBUG_TASK_RUN_ERROR],
  ] as const)("reports only the generic %s failure", async (stage, expectedMessage) => {
    const reportError = vi.fn();
    const secret = "private-task-secret";
    const coordinator = new PostDebugTaskCoordinator();
    coordinator.armAfterAcceptedSession(
      plan({
        cleanup: () => {
          if (stage === "cleanup") throw new Error(secret);
        },
        reportError,
        revalidate: () => {
          if (stage === "revalidate") throw new Error(secret);
          return true;
        },
        run: () => {
          if (stage === "run") throw new Error(secret);
        },
      }),
    );

    expect(await coordinator.handleTerminal(IDENTITY)).toEqual({ kind: "failed" });
    expect(reportError).toHaveBeenCalledExactlyOnceWith(expectedMessage);
    expect(JSON.stringify(coordinator.snapshot())).not.toContain(secret);
    expect(JSON.stringify(coordinator.snapshot())).not.toContain("post-build");
  });

  it("rejects malformed acceptance without occupying the coordinator", () => {
    const coordinator = new PostDebugTaskCoordinator();
    expect(
      coordinator.armAfterAcceptedSession(
        plan({ sessionId: 0, task: { label: "post-build\nsecret" } }),
      ),
    ).toEqual({ kind: "rejected" });
    expect(coordinator.snapshot()).toEqual({ kind: "idle", occupied: false });
  });

  it("rejects duplicate or replacement arm attempts until the exact plan settles", async () => {
    const cleanup = deferred<void>();
    const coordinator = new PostDebugTaskCoordinator();
    const request = plan({ cleanup: () => cleanup.promise });

    expect(coordinator.armAfterAcceptedSession(request).kind).toBe("armed");
    expect(coordinator.armAfterAcceptedSession(request)).toEqual({ kind: "rejected" });
    const completion = coordinator.handleTerminal(IDENTITY);
    expect(
      coordinator.armAfterAcceptedSession(plan({ sessionId: IDENTITY.sessionId + 1 })),
    ).toEqual({ kind: "rejected" });
    cleanup.resolve();
    await expect(completion).resolves.toEqual({ kind: "completed" });
  });
});

function plan(overrides: Partial<PostDebugTaskArmRequest> = {}): PostDebugTaskArmRequest {
  return {
    ...IDENTITY,
    task: { label: "post-build" },
    cleanup: async () => undefined,
    revalidate: async () => true,
    run: async () => undefined,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}
