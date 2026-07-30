// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  useWorkbenchWorkspaceSymbols,
  type WorkbenchWorkspaceSymbols,
  type WorkbenchWorkspaceSymbolsDependencies,
} from "./useWorkbenchWorkspaceSymbols";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkbenchWorkspaceSymbols", () => {
  it("clears stale rows immediately and publishes only the latest query", async () => {
    vi.useFakeTimers();
    const first = deferred<ProjectSymbolSearchResult[]>();
    const second = deferred<ProjectSymbolSearchResult[]>();
    const signals: AbortSignal[] = [];
    const searchClassOpenSymbols = vi.fn((_query: string, _limit: number, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const harness = renderWorkspaceSymbols(dependencies({ searchClassOpenSymbols }));

    act(() => {
      harness.value().setWorkspaceSymbolsOpen(true);
      harness.value().setWorkspaceSymbolsQuery("Us");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => first.resolve([result("Us")]));
    expect(harness.value().workspaceSymbolsResults.map(({ name }) => name)).toEqual(["Us"]);

    act(() => harness.value().setWorkspaceSymbolsQuery("User"));
    expect(harness.value().workspaceSymbolsResults).toEqual([]);
    expect(signals[0].aborted).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => second.resolve([result("User")]));
    expect(harness.value().workspaceSymbolsResults.map(({ name }) => name)).toEqual(["User"]);
    harness.unmount();
  });

  it("aborts the active query when the surface closes", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const searchClassOpenSymbols = vi.fn(
      (_query: string, _limit: number, nextSignal?: AbortSignal) => {
        signal = nextSignal;
        return new Promise<ProjectSymbolSearchResult[]>(() => undefined);
      },
    );
    const harness = renderWorkspaceSymbols(dependencies({ searchClassOpenSymbols }));
    act(() => {
      harness.value().setWorkspaceSymbolsOpen(true);
      harness.value().setWorkspaceSymbolsQuery("User");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));

    act(() => harness.value().setWorkspaceSymbolsOpen(false));

    expect(signal?.aborted).toBe(true);
    expect(harness.value().workspaceSymbolsResults).toEqual([]);
    expect(harness.value().workspaceSymbolsLoading).toBe(false);
    harness.unmount();
  });

  it("coalesces a 1,000-query typing storm into one indexed request", async () => {
    vi.useFakeTimers();
    const searchClassOpenSymbols = vi.fn(async () => [result("User")]);
    const harness = renderWorkspaceSymbols(dependencies({ searchClassOpenSymbols }));

    act(() => {
      harness.value().setWorkspaceSymbolsOpen(true);
      for (let index = 0; index < 1_000; index += 1) {
        harness.value().setWorkspaceSymbolsQuery(`User${index}`);
      }
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));

    expect(searchClassOpenSymbols).toHaveBeenCalledExactlyOnceWith(
      "User999",
      120,
      expect.any(AbortSignal),
    );
    expect(harness.value().workspaceSymbolsResults.map(({ name }) => name)).toEqual(["User"]);
    harness.unmount();
  });
});

function dependencies(
  overrides: Partial<WorkbenchWorkspaceSymbolsDependencies> = {},
): WorkbenchWorkspaceSymbolsDependencies {
  return {
    canSearchClassOpenSymbols: true,
    reportError: vi.fn(),
    searchClassOpenSymbols: vi.fn(async () => []),
    setMessage: vi.fn(),
    workspaceOwner: { executionRoot: "/project", ownerKey: "owner" as never },
    workspaceRoot: "/project",
    ...overrides,
  };
}

function renderWorkspaceSymbols(deps: WorkbenchWorkspaceSymbolsDependencies) {
  const root = createRoot(document.createElement("div"));
  let current: WorkbenchWorkspaceSymbols | null = null;
  function Harness() {
    current = useWorkbenchWorkspaceSymbols(deps);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    value: () => {
      if (!current) throw new Error("hook is not mounted");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function result(name: string): ProjectSymbolSearchResult {
  return {
    column: 1,
    containerName: "App",
    fullyQualifiedName: `App.${name}`,
    kind: "class",
    lineNumber: 1,
    name,
    path: `/project/${name}.ts`,
    relativePath: `${name}.ts`,
  };
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolveValue?.(value);
      return promise;
    },
  };
}
