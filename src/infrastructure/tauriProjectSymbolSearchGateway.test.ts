import { describe, expect, it, vi } from "vitest";
import {
  createMonotonicProjectSymbolSearchRequestIdAllocator,
  TauriProjectSymbolSearchGateway,
} from "./tauriProjectSymbolSearchGateway";

describe("TauriProjectSymbolSearchGateway", () => {
  it("cancels the exact backend request and rejects promptly", async () => {
    const registration = deferred<string>();
    const invoke = vi.fn((command: string) =>
      command === "begin_project_symbol_search" ? registration.promise : Promise.resolve(true),
    );
    const gateway = new TauriProjectSymbolSearchGateway(invoke as never, () => 17, "owner-a");
    const abort = new AbortController();

    const request = gateway.searchProjectSymbols("/project", "User", 120, abort.signal);
    abort.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("begin_project_symbol_search", {
      ownerId: "owner-a",
      requestId: 17,
      root: "/project",
    });
    registration.resolve("/project");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_project_symbol_search", {
      ownerId: "owner-a",
      requestId: 17,
      root: "/project",
    });
    expect(invoke).not.toHaveBeenCalledWith("search_project_symbols", expect.anything());
  });

  it("does not start backend work for an already cancelled request", async () => {
    const invoke = vi.fn();
    const gateway = new TauriProjectSymbolSearchGateway(invoke as never, undefined, "owner-a");
    const abort = new AbortController();
    abort.abort();

    await expect(
      gateway.searchProjectSymbols("/project", "User", 120, abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the backend-canonical root for the claimed worker request", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "begin_project_symbol_search" ? "/canonical/project" : [],
    );
    const gateway = new TauriProjectSymbolSearchGateway(invoke as never, () => 9, "owner-a");

    await gateway.searchProjectSymbols("/alias/project", "User", 20);

    expect(invoke).toHaveBeenNthCalledWith(2, "search_project_symbols", {
      limit: 20,
      ownerId: "owner-a",
      query: "User",
      requestId: 9,
      root: "/canonical/project",
    });
  });

  it("uses distinct monotonic identifiers during a cancellation storm", async () => {
    const invoke = vi.fn((command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(command === "begin_project_symbol_search" ? "/project" : true),
    );
    const gateway = new TauriProjectSymbolSearchGateway(invoke as never, undefined, "owner-a");

    await Promise.all(
      Array.from({ length: 1_000 }, async () => {
        const abort = new AbortController();
        const request = gateway.searchProjectSymbols("/project", "U", 20, abort.signal);
        abort.abort();
        await expect(request).rejects.toMatchObject({ name: "AbortError" });
      }),
    );
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([command]) => command === "cancel_project_symbol_search"),
      ).toHaveLength(1_000),
    );

    const requestIds = invoke.mock.calls
      .filter(([command]) => command === "begin_project_symbol_search")
      .map(([, args]) => (args as { requestId: number }).requestId);
    expect(requestIds).toHaveLength(1_000);
    expect(new Set(requestIds).size).toBe(1_000);
    expect(
      invoke.mock.calls.filter(([command]) => command === "search_project_symbols"),
    ).toHaveLength(0);
  });

  it("isolates the same request identifier across gateway owner generations", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "begin_project_symbol_search" ? "/project" : [],
    );
    const first = new TauriProjectSymbolSearchGateway(invoke as never, () => 1, "owner-a");
    const second = new TauriProjectSymbolSearchGateway(invoke as never, () => 1, "owner-b");

    await Promise.all([
      first.searchProjectSymbols("/project", "User", 20),
      second.searchProjectSymbols("/project", "User", 20),
    ]);

    expect(invoke).toHaveBeenCalledWith("begin_project_symbol_search", {
      ownerId: "owner-a",
      requestId: 1,
      root: "/project",
    });
    expect(invoke).toHaveBeenCalledWith("begin_project_symbol_search", {
      ownerId: "owner-b",
      requestId: 1,
      root: "/project",
    });
  });

  it("fails closed when the request identifier space is exhausted", () => {
    const allocate = createMonotonicProjectSymbolSearchRequestIdAllocator(
      Number.MAX_SAFE_INTEGER - 1,
    );

    expect(allocate()).toBe(Number.MAX_SAFE_INTEGER);
    expect(allocate).toThrow("Project-symbol search request identifier space is exhausted.");
  });
});

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}
