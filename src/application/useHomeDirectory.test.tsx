// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceHomeReference } from "../domain/workspaceRootEligibility";
import { useHomeDirectory, type HomeDirectoryResolver } from "./useHomeDirectory";

function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const result: { current: string | null } = { current: null };
  function Harness({ resolver }: { readonly resolver: HomeDirectoryResolver | null }) {
    result.current = useHomeDirectory(resolver);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return {
    result,
    render: (resolver: HomeDirectoryResolver | null) =>
      act(async () => root.render(<Harness resolver={resolver} />)),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useHomeDirectory", () => {
  it("reads the home folder from the cheap resolver instead of listing it", async () => {
    const resolveHome = vi.fn(async (): Promise<WorkspaceHomeReference> => ({
      path: "/Users/dev",
      pathCase: "sensitive",
    }));
    const hook = mount();
    await hook.render(resolveHome);
    expect(hook.result.current).toBe("/Users/dev");
    expect(resolveHome).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("stays unknown when the resolver cannot find a home folder or fails", async () => {
    const missing = vi.fn(async (): Promise<WorkspaceHomeReference> => ({
      path: null,
      pathCase: "insensitive",
    }));
    const failing = vi.fn(async (): Promise<WorkspaceHomeReference> => {
      return Promise.reject(new Error("unavailable"));
    });
    const hook = mount();
    await hook.render(missing);
    expect(hook.result.current).toBeNull();
    await hook.render(failing);
    expect(hook.result.current).toBeNull();
    await hook.render(null);
    expect(hook.result.current).toBeNull();
    hook.unmount();
  });

  it("never publishes a late answer from a replaced resolver", async () => {
    let resolveFirst: (home: WorkspaceHomeReference) => void = () => undefined;
    const first = vi.fn(
      () =>
        new Promise<WorkspaceHomeReference>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = vi.fn(async (): Promise<WorkspaceHomeReference> => ({
      path: "/home/b",
      pathCase: "sensitive",
    }));
    const hook = mount();
    await hook.render(first);
    await hook.render(second);
    await act(async () => resolveFirst({ path: "/home/a", pathCase: "sensitive" }));
    expect(hook.result.current).toBe("/home/b");
    hook.unmount();
  });
});
