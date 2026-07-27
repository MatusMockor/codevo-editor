import type { DebugGateway } from "../domain/debug";
import { describe, expect, it, vi } from "vitest";
import { invokeDebugIpc, type InvokeDebugCommand } from "../infrastructure/tauriDebugIpcContract";
import { DebugCompoundSessionProjection } from "./debugCompoundSessionProjection";
import {
  startDebugCompoundAccepted,
  type ActiveDebugCompound,
  type DebugCompoundStartContext,
} from "./debugCompoundStart";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  NodeDebugCompoundSessionCoordinator,
} from "./nodeDebugCompoundSessionCoordinator";

describe("startDebugCompoundAccepted", () => {
  it("starts eight members with identical breakpoint and exception policy fan-out", async () => {
    const startCompound = vi.fn().mockResolvedValue({
      kind: "ok",
      sessionIds: Array.from({ length: MAX_NODE_DEBUG_COMPOUND_MEMBERS }, (_, index) => index + 11),
    });
    const context = compoundContext(startCompound);
    context.breakpointsByRootRef.current["/workspace"] = [
      {
        enabled: true,
        filePath: "/workspace/api.ts",
        id: "api-entry",
        lineNumber: 4,
      },
    ];

    await expect(
      startDebugCompoundAccepted(context, launchTargets(MAX_NODE_DEBUG_COMPOUND_MEMBERS)),
    ).resolves.toBe(true);

    expect(startCompound).toHaveBeenCalledOnce();
    const request = startCompound.mock.calls[0]?.[0];
    expect(request.members).toHaveLength(MAX_NODE_DEBUG_COMPOUND_MEMBERS);
    expect(
      request.members.map(
        ({
          breakpoints,
          exceptionPauseMode,
          exceptionTypeFilter,
        }: {
          breakpoints: readonly unknown[];
          exceptionPauseMode: string;
          exceptionTypeFilter: readonly string[];
        }) => ({
          breakpointIds: breakpoints.map((breakpoint) => (breakpoint as { id: string }).id),
          exceptionPauseMode,
          exceptionTypeFilter,
        }),
      ),
    ).toEqual(
      Array.from({ length: MAX_NODE_DEBUG_COMPOUND_MEMBERS }, () => ({
        breakpointIds: ["api-entry"],
        exceptionPauseMode: "all",
        exceptionTypeFilter: ["TypeError"],
      })),
    );
  });

  it("rejects nine members before starting", async () => {
    const startCompound = vi.fn();
    const context = compoundContext(startCompound);

    await expect(
      startDebugCompoundAccepted(context, launchTargets(MAX_NODE_DEBUG_COMPOUND_MEMBERS + 1)),
    ).resolves.toBe(false);
    expect(startCompound).not.toHaveBeenCalled();
  });

  it("carries an eight-member 900-breakpoint payload rejection as too large", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    const startCompound = vi.fn(async (request) => {
      await invokeDebugIpc(invokeCommand, "debug_start_compound", { request });
      return { kind: "error" as const, message: "unexpected acceptance" };
    });
    const context = compoundContext(startCompound);
    context.breakpointsByRootRef.current["/workspace"] = Array.from(
      { length: 900 },
      (_, index) => ({
        condition: null,
        enabled: true,
        filePath: `/workspace/packages/service-${String(index).padStart(4, "0")}/src/handler-with-realistic-path.ts`,
        id: `breakpoint-${index}`,
        lineNumber: index + 1,
      }),
    );

    await expect(
      startDebugCompoundAccepted(context, launchTargets(MAX_NODE_DEBUG_COMPOUND_MEMBERS)),
    ).resolves.toEqual({ kind: "request-too-large" });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rolls back an incomplete late batch through one exact group representative", async () => {
    const startCompound = vi.fn().mockResolvedValue({
      kind: "ok",
      sessionIds: Array.from(
        { length: MAX_NODE_DEBUG_COMPOUND_MEMBERS - 1 },
        (_, index) => index + 31,
      ),
    });
    const context = compoundContext(startCompound);

    await expect(
      startDebugCompoundAccepted(context, launchTargets(MAX_NODE_DEBUG_COMPOUND_MEMBERS)),
    ).resolves.toBe(false);

    expect(context.gateway.stop).toHaveBeenCalledExactlyOnceWith(31);
    expect(context.activeCompoundRef.current).toBeNull();
    expect(context.compoundCoordinator.snapshot()).toEqual({ kind: "idle" });
    expect(context.compoundProjection.snapshot()).toEqual({ kind: "idle" });
  });
});

function compoundContext(startCompound: ReturnType<typeof vi.fn>): DebugCompoundStartContext {
  const stop = vi.fn<DebugGateway["stop"]>(async () => undefined);
  const gateway = { startCompound, stop } as unknown as DebugGateway;
  return {
    activeCompoundRef: { current: null as ActiveDebugCompound | null },
    adoptBreakpointsActivation: vi.fn(),
    adoptExceptionPauseSession: vi.fn(),
    breakpointsByRootRef: { current: {} },
    clearFrameSelection: vi.fn(),
    compoundCoordinator: new NodeDebugCompoundSessionCoordinator(),
    compoundProjection: new DebugCompoundSessionProjection(),
    currentRootRef: { current: "/workspace" },
    currentWorkspaceIdRef: { current: "workspace-a" },
    exceptionPauseStartPolicy: () => ({
      adapterKind: "node",
      exceptionTypeFilter: ["TypeError"],
      mode: "all",
    }),
    gateway,
    isExactWorkspaceOwnerCurrent: () => true,
    isWorkspaceTrusted: () => true,
    mountedRef: { current: true },
    pendingActiveStopsRef: { current: { has: () => false } },
    pendingControlsRef: { current: { has: () => false } },
    pendingRestartsRef: { current: { has: () => false } },
    pendingStartKeysRef: { current: new Set() },
    sessionOwnersRef: { current: new Map() },
    sessionsByRootRef: { current: {} },
    setDebugCompoundActive: vi.fn(),
    setDebugCompoundStartPending: vi.fn(),
    setOutputBySession: vi.fn(),
    setPauseGeneration: vi.fn(),
    setSnapshots: vi.fn(),
    setStartErrors: vi.fn(),
    setStartPendingByRoot: vi.fn(),
    snapshotsRef: { current: {} },
    workspaceOwnerEpochRef: { current: { epoch: 7 } },
  };
}

function launchTargets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    kind: "node-script" as const,
    scriptPath: `/workspace/service-${index}.ts`,
  }));
}
