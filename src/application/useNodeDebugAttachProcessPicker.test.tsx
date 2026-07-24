// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugRuntimeStatus } from "../domain/debug";
import type { NodeDebugAttachCandidateListResult } from "../domain/nodeDebugAttachCandidate";
import {
  useNodeDebugAttachProcessPicker,
  type NodeDebugAttachCandidateListGateway,
  type NodeDebugAttachProcessPickerController,
  type StartNodeDebugAttachCandidate,
} from "./useNodeDebugAttachProcessPicker";

const FIRST_LEASE = "0123456789abcdef0123456789abcdef";
const SECOND_LEASE = "fedcba9876543210fedcba9876543210";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}

function listed(leaseId = FIRST_LEASE, label = "node api"): NodeDebugAttachCandidateListResult {
  return Object.freeze({
    status: "ok",
    candidates: Object.freeze([
      Object.freeze({
        candidateLeaseId: leaseId,
        label,
        detail: "server.js",
        port: 9229,
      }),
    ]),
    truncated: false,
  });
}

function renderHook(
  overrides: Partial<{
    enabled: boolean;
    listGateway: NodeDebugAttachCandidateListGateway;
    onManualAttach: () => void;
    rootPath: string | null;
    startCandidate: StartNodeDebugAttachCandidate;
  }> = {},
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { current: NodeDebugAttachProcessPickerController | null } = {
    current: null,
  };
  let props = {
    enabled: true,
    listGateway: {
      list: vi.fn<NodeDebugAttachCandidateListGateway["list"]>().mockResolvedValue(listed()),
    },
    onManualAttach: vi.fn(),
    rootPath: "/workspace" as string | null,
    startCandidate: vi
      .fn<StartNodeDebugAttachCandidate>()
      .mockResolvedValue({ kind: "ok", sessionId: 7 }),
    ...overrides,
  };

  function Harness() {
    captured.current = useNodeDebugAttachProcessPicker(props);
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    hook() {
      if (!captured.current) throw new Error("Hook is not mounted.");
      return captured.current;
    },
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function openAndSettle(harness: ReturnType<typeof renderHook>) {
  await act(async () => {
    harness.hook().open();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function selectedId(harness: ReturnType<typeof renderHook>): string {
  const result = harness.hook().result;
  if (result?.status !== "ok") throw new Error("Expected candidates.");
  return result.candidates[0].presentationId;
}

describe("useNodeDebugAttachProcessPicker", () => {
  it("projects only presentation data and never exposes the lease capability in state", async () => {
    const harness = renderHook();
    await openAndSettle(harness);

    const serializedState = JSON.stringify({
      isOpen: harness.hook().isOpen,
      result: harness.hook().result,
    });
    expect(serializedState).not.toContain(FIRST_LEASE);
    expect(harness.hook().result).toEqual({
      status: "ok",
      candidates: [
        {
          presentationId: "node-attach-candidate-1",
          label: "node api",
          detail: "server.js",
          port: 9229,
        },
      ],
      truncated: false,
    });
    harness.unmount();
  });

  it("deletes a selected capability before start and rejects a synchronous replay", async () => {
    const start = deferred<DebugRuntimeStatus>();
    const startCandidate = vi.fn<StartNodeDebugAttachCandidate>().mockReturnValue(start.promise);
    const harness = renderHook({ startCandidate });
    await openAndSettle(harness);
    const presentationId = selectedId(harness);

    let first!: Promise<void>;
    act(() => {
      first = harness.hook().selectCandidate(presentationId);
      void harness.hook().selectCandidate(presentationId);
    });

    expect(startCandidate).toHaveBeenCalledExactlyOnceWith("/workspace", FIRST_LEASE);
    await act(async () => start.resolve({ kind: "ok", sessionId: 9 }));
    await first;
    expect(startCandidate).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("serializes list calls and coalesces repeated retries into one follow-up", async () => {
    const first = deferred<NodeDebugAttachCandidateListResult>();
    const second = deferred<NodeDebugAttachCandidateListResult>();
    let inFlight = 0;
    let maximumInFlight = 0;
    const list = vi
      .fn<NodeDebugAttachCandidateListGateway["list"]>()
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        const value = await first.promise;
        inFlight -= 1;
        return value;
      })
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        const value = await second.promise;
        inFlight -= 1;
        return value;
      });
    const harness = renderHook({ listGateway: { list } });

    act(() => {
      harness.hook().open();
    });
    await act(async () => Promise.resolve());
    act(() => {
      harness.hook().retry();
      harness.hook().retry();
      harness.hook().retry();
    });
    expect(list).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(listed()));
    expect(list).toHaveBeenCalledTimes(2);
    expect(maximumInFlight).toBe(1);
    await act(async () => second.resolve(listed(SECOND_LEASE, "worker")));
    expect(list).toHaveBeenCalledTimes(2);
    expect(maximumInFlight).toBe(1);
    harness.unmount();
  });

  it("drops late results after close and after a workspace change", async () => {
    for (const invalidate of [
      (harness: ReturnType<typeof renderHook>) => harness.hook().close(),
      (harness: ReturnType<typeof renderHook>) => harness.set({ rootPath: "/other" }),
    ]) {
      const pending = deferred<NodeDebugAttachCandidateListResult>();
      const list = vi
        .fn<NodeDebugAttachCandidateListGateway["list"]>()
        .mockReturnValue(pending.promise);
      const harness = renderHook({ listGateway: { list } });
      act(() => harness.hook().open());
      await act(async () => Promise.resolve());
      act(() => invalidate(harness));
      await act(async () => pending.resolve(listed()));

      expect(harness.hook().isOpen).toBe(false);
      expect(harness.hook().result).toBeNull();
      harness.unmount();
    }
  });

  it.each(["status", "rejection"] as const)(
    "shows a generic retry state when candidate start fails via %s",
    async (failureKind) => {
      const startCandidate = vi
        .fn<StartNodeDebugAttachCandidate>()
        .mockImplementation(() =>
          failureKind === "status"
            ? Promise.resolve({ kind: "error", message: "generic" })
            : Promise.reject(new Error("transport details and capability must not escape")),
        );
      const harness = renderHook({ startCandidate });
      await openAndSettle(harness);

      await act(async () => harness.hook().selectCandidate(selectedId(harness)));

      expect(harness.hook().isOpen).toBe(true);
      expect(harness.hook().result).toEqual({ status: "error" });
      expect(JSON.stringify(harness.hook().result)).not.toContain(FIRST_LEASE);
      harness.unmount();
    },
  );

  it("keeps controller callbacks stable and closes before invoking manual attach", async () => {
    const onManualAttach = vi.fn();
    const harness = renderHook({ onManualAttach });
    const callbacks = {
      open: harness.hook().open,
      close: harness.hook().close,
      retry: harness.hook().retry,
      selectCandidate: harness.hook().selectCandidate,
      attachByPort: harness.hook().attachByPort,
    };
    await openAndSettle(harness);
    harness.set({ rootPath: "/workspace" });
    expect({
      open: harness.hook().open,
      close: harness.hook().close,
      retry: harness.hook().retry,
      selectCandidate: harness.hook().selectCandidate,
      attachByPort: harness.hook().attachByPort,
    }).toEqual(callbacks);

    act(() => harness.hook().attachByPort());
    expect(harness.hook().isOpen).toBe(false);
    expect(harness.hook().result).toBeNull();
    expect(onManualAttach).toHaveBeenCalledOnce();
    harness.unmount();
  });
});
