// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceHomeReference } from "../../domain/workspaceRootEligibility";
import type { AgentCloneDestinationPreference } from "./agentWorkbenchChrome";
import { useAgentCloneDestinationPreference } from "./useAgentCloneDestinationPreference";

const HOME: WorkspaceHomeReference = { path: "/Users/dev", pathCase: "insensitive" };

function mount(
  lastParentPath: string | null,
  save: (parentPath: string) => Promise<void>,
  resolveHome: () => Promise<WorkspaceHomeReference>,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const result: { current: AgentCloneDestinationPreference | null } = { current: null };
  function Harness() {
    result.current = useAgentCloneDestinationPreference({ lastParentPath, save, resolveHome });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  return { result, unmount: () => act(() => root.unmount()) };
}

describe("useAgentCloneDestinationPreference", () => {
  it("saves a new normalized parent once and skips the current one", async () => {
    const save = vi.fn(async () => undefined);
    const hook = mount("/Users/dev/code", save, async () => HOME);
    await act(async () => hook.result.current?.remember("/Users/dev/code/"));
    await act(async () => hook.result.current?.remember("/Users/dev/src/"));
    await act(async () => hook.result.current?.remember("/Users/dev/src"));
    await act(async () => hook.result.current?.remember("relative"));
    expect(save).toHaveBeenCalledExactlyOnceWith("/Users/dev/src");
    hook.unmount();
  });

  it("never remembers the home folder, the disk root or an ancestor of home", async () => {
    const save = vi.fn(async () => undefined);
    const hook = mount(null, save, async () => HOME);
    await act(async () => hook.result.current?.remember("/Users/dev"));
    await act(async () => hook.result.current?.remember("/users/DEV/"));
    await act(async () => hook.result.current?.remember("/Users"));
    await act(async () => hook.result.current?.remember("/"));
    expect(save).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("does not remember anything when the home folder cannot be resolved", async () => {
    const save = vi.fn(async () => undefined);
    const hook = mount(null, save, async () => Promise.reject(new Error("unavailable")));
    await act(async () => hook.result.current?.remember("/Users/dev/src"));
    expect(save).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("hides a stored disk root and lets a failed save be retried", async () => {
    const save = vi
      .fn<(parentPath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const hook = mount("/", save, async () => HOME);
    expect(hook.result.current?.lastParentPath).toBeNull();
    await act(async () => hook.result.current?.remember("/Users/dev/src"));
    await act(async () => hook.result.current?.remember("/Users/dev/src"));
    expect(save).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("only saves the latest of overlapping requests", async () => {
    const save = vi.fn(async () => undefined);
    const homes: Array<(home: WorkspaceHomeReference) => void> = [];
    const hook = mount(
      null,
      save,
      () =>
        new Promise<WorkspaceHomeReference>((resolve) => {
          homes.push(resolve);
        }),
    );
    act(() => {
      hook.result.current?.remember("/Users/dev/one");
      hook.result.current?.remember("/Users/dev/two");
    });
    await act(async () => {
      homes[1]?.(HOME);
    });
    await act(async () => {
      homes[0]?.(HOME);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("/Users/dev/two");
    hook.unmount();
  });
});
