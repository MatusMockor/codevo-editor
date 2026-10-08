// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAgentProjectWorkspaceSync,
  type AgentProjectWorkspaceSync,
  type AgentProjectWorkspaceTarget,
} from "./useAgentProjectWorkspaceSync";

const A: AgentProjectWorkspaceTarget = {
  rootKey: "a",
  rootPath: "/a",
  ownerId: "owner-a",
  generation: 1,
  label: "A",
};
const OWNER_A = { ownerId: "owner-a", generation: 1 } as const;
const OWNER_B = { ownerId: "owner-b", generation: 1 } as const;
const B: AgentProjectWorkspaceTarget = {
  rootKey: "b",
  rootPath: "/b",
  ownerId: "owner-b",
  generation: 1,
  label: "B",
};

const REGISTERED_A: AgentProjectWorkspaceTarget = {
  ...A,
  registration: { workspaceId: "workspace-a", generation: 2 },
};
const REGISTERED_B: AgentProjectWorkspaceTarget = {
  ...B,
  registration: { workspaceId: "workspace-b", generation: 2 },
};
const PROMOTED = { ownerId: "promoted", generation: 1 } as const;

function deferred() {
  let resolve: (value: boolean) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<boolean>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("project workspace synchronization", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let current: AgentProjectWorkspaceSync;
  let workspaceRoot: string | null;
  const activate = vi.fn<(path: string) => Promise<boolean>>();
  function Harness() {
    current = useAgentProjectWorkspaceSync({ workspaceRoot, activate });
    return null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    workspaceRoot = "/a";
    activate.mockReset().mockResolvedValue(true);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
  });

  it("uses the current project without reopening it", () => {
    act(() => current.select(A));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a", owner: OWNER_A });
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates a selected background project and settles once", async () => {
    const pending = deferred();
    activate.mockReturnValue(pending.promise);
    act(() => current.select(B));
    expect(current.state.kind).toBe("pending");
    act(() => current.select({ ...B }));
    expect(activate).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/b", owner: OWNER_B });
  });

  it("issues a real return-to-A request while B is pending and ignores late B", async () => {
    const b = deferred();
    const a = deferred();
    activate.mockReturnValueOnce(b.promise).mockReturnValueOnce(a.promise);
    act(() => current.select(A));
    act(() => current.select(B));
    act(() => current.select(A));
    expect(activate.mock.calls).toEqual([["/b"], ["/a"]]);
    await act(async () => a.resolve(true));
    await act(async () => b.resolve(true));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a", owner: OWNER_A });
  });

  it("reports a failed activation without retry loops and allows explicit retry", async () => {
    activate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => current.select(B));
    expect(current.state.kind).toBe("failed");
    await act(async () => current.select({ ...B }));
    expect(activate).toHaveBeenCalledTimes(1);
    await act(async () => current.retry());
    expect(activate).toHaveBeenCalledTimes(2);
    expect(current.state.kind).toBe("ready");
  });

  it("does not treat a replaced owner at the same path as already activated", async () => {
    act(() => current.select(A));
    await act(async () => current.select({ ...A, ownerId: "replacement", generation: 2 }));
    expect(activate).toHaveBeenCalledWith("/a");
  });

  it("adopts a promoted owner of the same registration without reopening its root", async () => {
    act(() => current.select(REGISTERED_A));
    await act(async () => current.select({ ...REGISTERED_A, ownerId: "promoted" }));
    expect(activate).not.toHaveBeenCalled();
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a", owner: PROMOTED });
  });

  it("reopens the root when its owner changes with a different workspace registration", async () => {
    act(() => current.select(REGISTERED_A));
    await act(async () =>
      current.select({
        ...REGISTERED_A,
        ownerId: "promoted",
        registration: { workspaceId: "workspace-a", generation: 3 },
      }),
    );
    expect(activate).toHaveBeenCalledWith("/a");
  });

  it("reopens the root when an owner change carries no workspace registration", async () => {
    act(() => current.select(A));
    await act(async () => current.select({ ...A, ownerId: "promoted" }));
    expect(activate).toHaveBeenCalledWith("/a");
  });

  it("keeps one pending activation when its owner is promoted before it settles", async () => {
    const pending = deferred();
    activate.mockReturnValueOnce(pending.promise);
    act(() => current.select(REGISTERED_B));
    workspaceRoot = "/b";
    render();
    act(() => current.select({ ...REGISTERED_B, ownerId: "promoted" }));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(current.state).toEqual({ kind: "pending", rootPath: "/b", owner: PROMOTED });
    await act(async () => pending.resolve(true));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/b", owner: PROMOTED });
  });

  it.each([
    ["reports it was not opened", (pending: ReturnType<typeof deferred>) => pending.resolve(false)],
    ["rejects", (pending: ReturnType<typeof deferred>) => pending.reject(new Error("open failed"))],
  ] as const)(
    "offers a working retry to the promoted owner when its activation %s",
    async (_label, settle) => {
      const pending = deferred();
      activate.mockReturnValueOnce(pending.promise);
      act(() => current.select(REGISTERED_B));
      act(() => current.select({ ...REGISTERED_B, ownerId: "promoted" }));
      await act(async () => settle(pending));
      expect(current.state).toMatchObject({ kind: "failed", rootPath: "/b", owner: PROMOTED });

      act(() => current.select({ ...REGISTERED_B, ownerId: "promoted" }));
      expect(activate).toHaveBeenCalledTimes(1);
      await act(async () => current.retry());
      expect(activate).toHaveBeenCalledTimes(2);
      expect(current.state).toEqual({ kind: "ready", rootPath: "/b", owner: PROMOTED });
    },
  );

  it("names the exact owner of every pending, ready and failed activation", async () => {
    const pending = deferred();
    activate.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(false);
    const replacement = { ...A, ownerId: "replacement", generation: 2 };
    act(() => current.select(A));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a", owner: OWNER_A });
    act(() => current.select(replacement));
    expect(current.state).toEqual({
      kind: "pending",
      rootPath: "/a",
      owner: { ownerId: "replacement", generation: 2 },
    });
    await act(async () => pending.resolve(true));
    expect(current.state).toEqual({
      kind: "ready",
      rootPath: "/a",
      owner: { ownerId: "replacement", generation: 2 },
    });
    await act(async () => current.select(B));
    expect(current.state).toMatchObject({ kind: "failed", rootPath: "/b", owner: OWNER_B });
  });

  it("hands A back to A's owner after A to B to A", async () => {
    const b = deferred();
    activate.mockReturnValueOnce(b.promise).mockResolvedValueOnce(true);
    act(() => current.select(A));
    act(() => current.select(B));
    expect(current.state).toEqual({ kind: "pending", rootPath: "/b", owner: OWNER_B });
    await act(async () => current.select({ ...A }));
    await act(async () => b.resolve(true));
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a", owner: OWNER_A });
  });

  it("reconciles selection after an external workspace change", async () => {
    act(() => current.select(A));
    workspaceRoot = "/b";
    render();
    await act(async () => current.select(A));
    expect(activate).toHaveBeenCalledWith("/a");
  });

  it("cancels a pending foreign selection when its project disappears", async () => {
    const b = deferred();
    activate.mockReturnValueOnce(b.promise).mockResolvedValueOnce(true);
    act(() => current.select(B));
    await act(async () => current.select(null));
    expect(activate.mock.calls).toEqual([["/b"], ["/a"]]);
    await act(async () => b.resolve(true));
    expect(current.state.kind).toBe("none");
  });
});
