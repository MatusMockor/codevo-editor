// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  ArtisanRoutesGateway,
  ArtisanRoutesResult,
} from "../domain/artisanRoutes";
import { useArtisanRoutes, type ArtisanRoutesState } from "./useArtisanRoutes";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function ok(uri: string): ArtisanRoutesResult {
  return {
    status: "ok",
    routes: [{ methods: ["GET"], uri }],
    total: 1,
  };
}

function renderHook(gateway: ArtisanRoutesGateway) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: ArtisanRoutesState | null } = { value: null };
  let props = { isOpen: false, rootPath: "/one" as string | null };

  function Harness() {
    captured.value = useArtisanRoutes({ gateway, ...props });
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();

  return {
    hook: () => {
      if (!captured.value) {
        throw new Error("hook not mounted");
      }
      return captured.value;
    },
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useArtisanRoutes", () => {
  it("fetches once on first open and refreshes manually", async () => {
    const list = vi
      .fn<ArtisanRoutesGateway["list"]>()
      .mockResolvedValueOnce(ok("users"))
      .mockResolvedValueOnce(ok("posts"));
    const harness = renderHook({ list });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledExactlyOnceWith("/one");
    expect(harness.hook().routes[0].uri).toBe("users");

    await act(async () => harness.hook().refresh());

    expect(list).toHaveBeenCalledTimes(2);
    expect(harness.hook().routes[0].uri).toBe("posts");
    harness.unmount();
  });

  it("drops a stale result after the root changes", async () => {
    const first = deferred<ArtisanRoutesResult>();
    const list = vi
      .fn<ArtisanRoutesGateway["list"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok("two"));
    const harness = renderHook({ list });

    act(() => harness.set({ isOpen: true }));
    await act(async () => {
      harness.set({ rootPath: "/two" });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => first.resolve(ok("stale")));

    expect(harness.hook().routes[0].uri).toBe("two");
    harness.unmount();
  });

  it("settles and caches the original root when it finishes in the background", async () => {
    const first = deferred<ArtisanRoutesResult>();
    const list = vi
      .fn<ArtisanRoutesGateway["list"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok("two"))
      .mockResolvedValueOnce(ok("refreshed"));
    const harness = renderHook({ list });

    act(() => harness.set({ isOpen: true }));
    await act(async () => {
      harness.set({ rootPath: "/two" });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => first.resolve(ok("cached-a")));
    act(() => harness.set({ rootPath: "/one" }));

    expect(harness.hook().loading).toBe(false);
    expect(harness.hook().routes[0].uri).toBe("cached-a");

    await act(async () => harness.hook().refresh());

    expect(harness.hook().routes[0].uri).toBe("refreshed");
    expect(list).toHaveBeenCalledTimes(3);
    harness.unmount();
  });

  it("isolates cached routes and filters per root", async () => {
    const list = vi.fn(async (root: string) => ok(root));
    const harness = renderHook({ list });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => harness.hook().setQuery("one"));
    await act(async () => {
      harness.set({ rootPath: "/two" });
      await Promise.resolve();
      await Promise.resolve();
    });
    harness.set({ rootPath: "/one" });

    expect(list).toHaveBeenCalledTimes(2);
    expect(harness.hook().routes[0].uri).toBe("/one");
    expect(harness.hook().query).toBe("one");
    expect(harness.hook().filteredRoutes).toHaveLength(1);
    harness.unmount();
  });

  it("clears only the active root on panel close", async () => {
    const list = vi.fn(async (root: string) => ok(root));
    const harness = renderHook({ list });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => harness.hook().clear());
    harness.set({ isOpen: false });
    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
    harness.unmount();
  });
});
