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
const B: AgentProjectWorkspaceTarget = {
  rootKey: "b",
  rootPath: "/b",
  ownerId: "owner-b",
  generation: 1,
  label: "B",
};

function deferred() {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a" });
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
    expect(current.state).toEqual({ kind: "ready", rootPath: "/b" });
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
    expect(current.state).toEqual({ kind: "ready", rootPath: "/a" });
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
