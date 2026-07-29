import { describe, expect, it, vi } from "vitest";
import type {
  IdentifiedLanguageServerRequest,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import { MAX_WORKSPACE_SYMBOL_RESULTS } from "../domain/workspaceSymbolProjection";
import {
  requestJavaScriptTypeScriptWorkspaceSymbols,
  WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS,
} from "./javaScriptTypeScriptWorkspaceSymbolRequest";

describe("requestJavaScriptTypeScriptWorkspaceSymbols", () => {
  it("cancels an aborted exact request once and never publishes its late result", async () => {
    const pending = deferred<LanguageServerWorkspaceSymbol[]>(41);
    const gateway = gatewayWith(pending.promise);
    const cancelRequest = vi.fn(async () => undefined);
    const controller = new AbortController();
    const result = requestJavaScriptTypeScriptWorkspaceSymbols({
      cancelRequest,
      gateway,
      isAuthorityCurrent: () => true,
      query: "User",
      rootPath: "/project",
      sessionId: 7,
      signal: controller.signal,
    });

    controller.abort();
    controller.abort();
    await expect(result).resolves.toEqual([]);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 7, 41);
    pending.resolve([symbol(1)]);
    await Promise.resolve();
    expect(cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("observes aborts fired synchronously while the gateway creates the request", async () => {
    const controller = new AbortController();
    const pending = deferred<LanguageServerWorkspaceSymbol[]>(45);
    const cancelRequest = vi.fn(async () => undefined);
    const gateway = {
      workspaceSymbols: vi.fn(() => {
        controller.abort();
        return pending.promise;
      }),
    };

    await expect(
      requestJavaScriptTypeScriptWorkspaceSymbols({
        cancelRequest,
        gateway,
        isAuthorityCurrent: () => true,
        query: "User",
        rootPath: "/project",
        sessionId: 7,
        signal: controller.signal,
      }),
    ).resolves.toEqual([]);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 7, 45);
  });

  it("times out at 1200ms and cancels the exact request", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<LanguageServerWorkspaceSymbol[]>(42, 8);
      const cancelRequest = vi.fn(async () => undefined);
      const result = requestJavaScriptTypeScriptWorkspaceSymbols({
        cancelRequest,
        gateway: gatewayWith(pending.promise),
        isAuthorityCurrent: () => true,
        query: "User",
        rootPath: "/project",
        sessionId: 8,
      });

      await vi.advanceTimersByTimeAsync(WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS);

      await expect(result).resolves.toEqual([]);
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 8, 42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed after an owner A-B-A replacement and at N+1 results", async () => {
    const requestedOwner = {};
    let currentOwner: object = requestedOwner;
    const late = deferred<LanguageServerWorkspaceSymbol[]>(43, 9);
    const lateResult = requestJavaScriptTypeScriptWorkspaceSymbols({
      cancelRequest: vi.fn(async () => undefined),
      gateway: gatewayWith(late.promise),
      isAuthorityCurrent: () => currentOwner === requestedOwner,
      query: "User",
      rootPath: "/project",
      sessionId: 9,
    });
    currentOwner = {};
    currentOwner = {};
    late.resolve([symbol(1)]);
    await expect(lateResult).resolves.toEqual([]);

    const overflow = identified(
      Array.from({ length: MAX_WORKSPACE_SYMBOL_RESULTS + 1 }, (_, index) => symbol(index)),
      44,
    );
    await expect(
      requestJavaScriptTypeScriptWorkspaceSymbols({
        cancelRequest: vi.fn(async () => undefined),
        gateway: gatewayWith(overflow),
        isAuthorityCurrent: () => true,
        query: "User",
        rootPath: "/project",
        sessionId: 9,
      }),
    ).resolves.toEqual([]);
  });

  it("rejects an oversized UTF-8 query before invoking IPC", async () => {
    const workspaceSymbols = vi.fn();
    await expect(
      requestJavaScriptTypeScriptWorkspaceSymbols({
        cancelRequest: vi.fn(async () => undefined),
        gateway: { workspaceSymbols } as never,
        isAuthorityCurrent: () => true,
        query: "😀".repeat(1_025),
        rootPath: "/project",
        sessionId: 1,
      }),
    ).resolves.toEqual([]);
    expect(workspaceSymbols).not.toHaveBeenCalled();
  });

  it("does not invoke IPC without exact owner authority", async () => {
    const workspaceSymbols = vi.fn();
    await expect(
      requestJavaScriptTypeScriptWorkspaceSymbols({
        cancelRequest: vi.fn(async () => undefined),
        gateway: { workspaceSymbols } as never,
        isAuthorityCurrent: () => false,
        query: "User",
        rootPath: "/project",
        sessionId: 1,
      }),
    ).resolves.toEqual([]);
    expect(workspaceSymbols).not.toHaveBeenCalled();
  });
});

function symbol(index: number): LanguageServerWorkspaceSymbol {
  return {
    containerName: "App",
    kind: 5,
    location: {
      range: {
        end: { character: 1, line: index },
        start: { character: 0, line: index },
      },
      uri: `file:///project/symbol-${index}.ts`,
    },
    name: `Symbol${index}`,
  };
}

function gatewayWith(
  response: IdentifiedLanguageServerRequest<LanguageServerWorkspaceSymbol[]>,
): Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "workspaceSymbols"> {
  return { workspaceSymbols: vi.fn(() => response) };
}

function identified<T>(value: T, requestId: number, sessionId = 9) {
  return Object.assign(Promise.resolve(value), { requestId, sessionId });
}

function deferred<T>(requestId: number, sessionId = 7) {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = Object.assign(
    new Promise<T>((resolve) => {
      resolveValue = resolve;
    }),
    { requestId, sessionId },
  );
  return {
    promise,
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}
