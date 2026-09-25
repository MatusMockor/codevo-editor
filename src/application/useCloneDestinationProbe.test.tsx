// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloneDestinationProbe } from "../domain/cloneForm";
import type { DirectoryListing, DirectoryListingGateway } from "../domain/directoryListing";
import { useCloneDestinationProbe } from "./useCloneDestinationProbe";

type Target = Readonly<{ parentPath: string; name: string }> | null;
type ListingGateway = Pick<DirectoryListingGateway, "listDirectoryEntries">;

describe("useCloneDestinationProbe", () => {
  const result: { current: CloneDestinationProbe } = { current: { kind: "unknown" } };
  let host: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });
  function mount(gateway: ListingGateway | null, roots: readonly string[] = []) {
    const root = createRoot(host);
    function Harness({ target }: { readonly target: Target }) {
      result.current = useCloneDestinationProbe(gateway, target, roots, 200);
      return null;
    }
    return {
      render: (target: Target) => act(() => root.render(<Harness target={target} />)),
      unmount: () => act(() => root.unmount()),
    };
  }
  const listing = (names: readonly string[], truncated = false) =>
    vi.fn(async (): Promise<DirectoryListing> => ({
      path: "/Users/dev/code",
      parent: "/Users/dev",
      entries: names.map((name) => ({ name, kind: "directory" as const, hidden: false })),
      truncated,
    }));

  it("reports an existing folder case-insensitively after the debounce", async () => {
    const listDirectoryEntries = listing(["Web-Dashboard"]);
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/Users/dev/code", name: "web-dashboard" });
    expect(result.current).toEqual({ kind: "checking" });
    expect(listDirectoryEntries).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(listDirectoryEntries).toHaveBeenCalledWith({
      path: "/Users/dev/code",
      includeFiles: true,
    });
    expect(result.current).toEqual({ kind: "exists" });
    probe.unmount();
  });

  it("reports a free destination and coalesces rapid typing into one listing", async () => {
    const listDirectoryEntries = listing(["other"]);
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/Users/dev/code", name: "a" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    probe.render({ parentPath: "/Users/dev/code", name: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    probe.render({ parentPath: "/Users/dev/code", name: "abc" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(listDirectoryEntries).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ kind: "free" });
    probe.unmount();
  });

  it("reports open projects without IO and stays unknown when the listing is truncated or fails", async () => {
    const listDirectoryEntries = listing([], true);
    const probe = mount({ listDirectoryEntries }, ["/Users/dev/code/app/"]);
    probe.render({ parentPath: "/Users/dev/code", name: "app" });
    expect(result.current).toEqual({ kind: "project", rootPath: "/Users/dev/code/app/" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(listDirectoryEntries).not.toHaveBeenCalled();
    probe.render({ parentPath: "/Users/dev/code", name: "other" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toEqual({ kind: "unknown" });
    probe.unmount();
    const failing = mount({
      listDirectoryEntries: vi.fn(async () => Promise.reject(new Error("missing"))),
    });
    failing.render({ parentPath: "/Users/dev/code", name: "x" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toEqual({ kind: "unknown" });
    failing.unmount();
  });

  it("stays unknown without a target or a gateway", () => {
    const probe = mount(null);
    probe.render({ parentPath: "/Users/dev/code", name: "x" });
    expect(result.current).toEqual({ kind: "unknown" });
    probe.render(null);
    expect(result.current).toEqual({ kind: "unknown" });
    probe.unmount();
  });

  it("never publishes a stale answer for a superseded target", async () => {
    const releases: Array<() => void> = [];
    const listDirectoryEntries = vi.fn(
      () =>
        new Promise<DirectoryListing>((resolve) => {
          releases.push(() =>
            resolve({
              path: "/a",
              parent: "/",
              entries: [{ name: "one", kind: "directory", hidden: false }],
              truncated: false,
            }),
          );
        }),
    );
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/a", name: "one" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    probe.render({ parentPath: "/a", name: "two" });
    await act(async () => {
      releases[0]?.();
    });
    expect(result.current).toEqual({ kind: "checking" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      releases[1]?.();
    });
    expect(result.current).toEqual({ kind: "free" });
    probe.render({ parentPath: "/a", name: "one" });
    expect(result.current).toEqual({ kind: "checking" });
    probe.unmount();
  });

  it("drops an answer that settles after unmount", async () => {
    let release: () => void = () => undefined;
    const listDirectoryEntries = vi.fn(
      () =>
        new Promise<DirectoryListing>((resolve) => {
          release = () => resolve({ path: "/a", parent: "/", entries: [], truncated: false });
        }),
    );
    const errors = vi.spyOn(console, "error");
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/a", name: "one" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    probe.unmount();
    await act(async () => {
      release();
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
