// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentCliDiscoveryGateway, AgentCliDiscoveryResult } from "../domain/agentSettings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentCliDiscovery,
  type AgentCliDiscoveryDependencies,
  type AgentCliDiscoverySurface,
} from "./useAgentCliDiscovery";

const FIRST: AgentCliDiscoveryResult = {
  claudeCode: { kind: "detected", path: "/one/claude", version: "1.2.3" },
  codex: { kind: "notFound" },
};

const SECOND: AgentCliDiscoveryResult = {
  claudeCode: { kind: "detected", path: "/two/claude", version: "2.0.0" },
  codex: { kind: "detected", path: "/two/codex", version: null },
};

describe("useAgentCliDiscovery", () => {
  it("discovers automatically and preserves manual presentation precedence", async () => {
    const gateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi.fn(async () => FIRST),
    };
    const harness = renderDiscovery(gateway);

    await waitForReact(() =>
      expect(harness.hook().status).toEqual({ kind: "ready", generation: 1 }),
    );
    expect(gateway.discoverAgentClis).toHaveBeenCalledWith({ refresh: true });
    expect(harness.hook().presentation("claudeCode", null)).toEqual({
      kind: "detected",
      path: "/one/claude",
      version: "1.2.3",
    });
    expect(harness.hook().presentation("claudeCode", "/manual/claude")).toEqual({
      kind: "manual",
      path: "/manual/claude",
    });
    expect(harness.hook().presentation("codex", null)).toEqual({
      kind: "notFound",
      installCommand: "npm i -g @openai/codex",
    });
    harness.unmount();
  });

  it("publishes only the newest exact request across refresh reordering", async () => {
    const initial = deferred<AgentCliDiscoveryResult>();
    const refresh = deferred<AgentCliDiscoveryResult>();
    const gateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi
        .fn<AgentCliDiscoveryGateway["discoverAgentClis"]>()
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(refresh.promise),
    };
    const harness = renderDiscovery(gateway);
    let refreshed!: Promise<unknown>;
    act(() => {
      refreshed = harness.hook().refresh();
    });
    await act(async () => refresh.resolve(SECOND));
    await expect(refreshed).resolves.toEqual({ generation: 2, result: SECOND });
    await act(async () => initial.resolve(FIRST));

    expect(harness.hook().result).toEqual(SECOND);
    expect(harness.hook().read()).toEqual({ generation: 2, result: SECOND });
    harness.unmount();
  });

  it("rejects A to B to A gateway replacement after an await", async () => {
    const stale = deferred<AgentCliDiscoveryResult>();
    const latest = deferred<AgentCliDiscoveryResult>();
    const first: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi
        .fn<AgentCliDiscoveryGateway["discoverAgentClis"]>()
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(latest.promise),
    };
    const middle: AgentCliDiscoveryGateway = { discoverAgentClis: vi.fn(async () => SECOND) };
    const harness = renderDiscovery(first);

    harness.replace({ gateway: middle });
    await waitForReact(() => expect(harness.hook().result).toEqual(SECOND));
    harness.replace({ gateway: first });
    await act(async () => stale.resolve(FIRST));

    expect(harness.hook().result).not.toEqual(FIRST);
    expect(harness.hook().read()).toBeNull();
    await act(async () => latest.resolve(SECOND));
    expect(harness.hook().result).toEqual(SECOND);
    harness.unmount();
  });

  it("fails closed and reports only a current discovery failure", async () => {
    const error = new Error("discovery failed");
    const reportError = vi.fn();
    const gateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi.fn(async () => Promise.reject(error)),
    };
    const harness = renderDiscovery(gateway, reportError);

    await waitForReact(() => expect(harness.hook().status.kind).toBe("failed"));
    expect(harness.hook().result).toEqual({
      claudeCode: { kind: "notFound" },
      codex: { kind: "notFound" },
    });
    expect(harness.hook().read()).toBeNull();
    expect(reportError).toHaveBeenCalledWith("Agent CLI discovery", error);
    harness.unmount();
  });
});

function renderDiscovery(gateway: AgentCliDiscoveryGateway, reportError = vi.fn()) {
  let hook: AgentCliDiscoverySurface | null = null;
  let dependencies: AgentCliDiscoveryDependencies = { active: true, gateway, reportError };
  const host = document.createElement("div");
  const root = createRoot(host);

  function Hook() {
    hook = useAgentCliDiscovery(dependencies);
    return null;
  }

  act(() => root.render(createElement(Hook)));
  return {
    hook: () => {
      if (hook === null) throw new Error("Discovery hook did not render.");
      return hook;
    },
    replace(replacement: Partial<AgentCliDiscoveryDependencies>) {
      dependencies = { ...dependencies, ...replacement };
      act(() => root.render(createElement(Hook)));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
