// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  agentCliVersionChangeMessage,
  type AgentCliVersionGateway,
  type AgentCliVersionProbeRequest,
  type AgentCliVersionProbeResult,
} from "../domain/agentCliVersion";
import type { AgentCliKind } from "../domain/agentTask";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentTasksNotice } from "./agentThreadPorts";
import {
  AGENT_CLI_VERSION_PROBE_WAIT_MS,
  AGENT_CLI_VERSION_SOURCE,
  useAgentCliVersion,
  type AgentCliVersionSurface,
} from "./useAgentCliVersion";

const PATH_A = "/usr/local/bin/claude";
const PATH_B = "/opt/homebrew/bin/claude";

interface Environment {
  agentCliPath: string | null;
  agentCliKind: AgentCliKind;
  enabled: boolean;
  withGateway: boolean;
}

interface PendingProbe {
  readonly request: AgentCliVersionProbeRequest;
  readonly promise: Promise<AgentCliVersionProbeResult>;
  readonly resolve: (result: AgentCliVersionProbeResult) => void;
  readonly reject: (error: unknown) => void;
}

function probeResult(version: string | null): AgentCliVersionProbeResult {
  return {
    version,
    probedAtEpochMs: 1_700_000_000_000,
    binaryFingerprint: { sizeBytes: 1_024, modifiedEpochMs: 1_699_000_000_000 },
  };
}

describe("useAgentCliVersion", () => {
  it("probes on mount and exposes the reported version", async () => {
    const harness = renderCliVersion();

    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    expect(harness.gateway.probeAgentCliVersion).toHaveBeenCalledWith({
      agentCliPath: PATH_A,
      agentCliKind: "claudeCode",
    });

    harness.resolveCall(0, "1.2.3");
    await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));

    expect(harness.hook().previous).toBeNull();
    expect(harness.hook().changed).toBe(false);
    expect(harness.notices).toHaveLength(0);
    harness.unmount();
  });

  it("does not probe while agent mode is inactive or the path is unset", async () => {
    const harness = renderCliVersion({ enabled: false });
    await waitForReact(() => expect(harness.calls).toHaveLength(0));

    harness.set({ agentCliPath: null, enabled: true });
    await waitForReact(() => expect(harness.calls).toHaveLength(0));

    await expect(harness.hook().probe()).resolves.toBeNull();
    expect(harness.calls).toHaveLength(0);
    harness.unmount();
  });

  it("fails closed when a probe is requested for a binary other than the configured one", async () => {
    const harness = renderCliVersion({});
    await waitForReact(() => expect(harness.calls).toHaveLength(1));

    await expect(harness.hook().probe("/other/claude", "claudeCode")).resolves.toBeNull();
    await expect(harness.hook().probe(undefined, "codex")).resolves.toBeNull();
    expect(harness.calls).toHaveLength(1);
    harness.unmount();
  });

  it("re-probes on a path change and resets the previous version", async () => {
    const harness = renderCliVersion();
    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    harness.resolveCall(0, "1.2.3");
    await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));

    harness.set({ agentCliPath: PATH_B });
    expect(harness.hook().current).toBeNull();
    expect(harness.hook().previous).toBeNull();
    expect(harness.hook().changed).toBe(false);

    await waitForReact(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]?.request.agentCliPath).toBe(PATH_B);
    harness.resolveCall(1, "9.9.9");
    await waitForReact(() => expect(harness.hook().current).toBe("9.9.9"));

    expect(harness.hook().previous).toBeNull();
    expect(harness.hook().changed).toBe(false);
    expect(harness.notices).toHaveLength(0);
    harness.unmount();
  });

  it("announces a changed version once and keeps exposing previous and current", async () => {
    const harness = renderCliVersion();
    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    harness.resolveCall(0, "1.2.3");
    await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));

    const updated = await harness.probeWith(1, "1.3.0");
    expect(updated).toBe("1.3.0");
    expect(harness.hook().current).toBe("1.3.0");
    expect(harness.hook().previous).toBe("1.2.3");
    expect(harness.hook().changed).toBe(true);
    expect(harness.notices).toEqual([
      {
        kind: "info",
        message: agentCliVersionChangeMessage("claudeCode", "1.2.3", "1.3.0"),
        action: null,
      },
    ]);

    const repeated = await harness.probeWith(2, "1.3.0");
    expect(repeated).toBe("1.3.0");
    expect(harness.notices).toHaveLength(1);
    expect(harness.hook().previous).toBe("1.2.3");
    harness.unmount();
  });

  it("discards a probe that settles after the path changed", async () => {
    const harness = renderCliVersion();
    await waitForReact(() => expect(harness.calls).toHaveLength(1));

    harness.set({ agentCliPath: PATH_B });
    await waitForReact(() => expect(harness.calls).toHaveLength(2));

    harness.resolveCall(0, "5.0.0");
    await waitForReact(() => expect(harness.hook().current).toBeNull());

    harness.resolveCall(1, "2.0.0");
    await waitForReact(() => expect(harness.hook().current).toBe("2.0.0"));
    expect(harness.hook().changed).toBe(false);
    expect(harness.notices).toHaveLength(0);
    harness.unmount();
  });

  it("keeps the known version and reports a failing probe once per path", async () => {
    const harness = renderCliVersion();
    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    harness.resolveCall(0, "1.2.3");
    await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));

    const failed = await harness.probeFailingWith(1, new Error("probe failed"));
    expect(failed).toBeNull();
    expect(harness.hook().current).toBe("1.2.3");
    expect(harness.reportError).toHaveBeenCalledTimes(1);
    expect(harness.reportError).toHaveBeenCalledWith(AGENT_CLI_VERSION_SOURCE, expect.any(Error));

    const failedAgain = await harness.probeFailingWith(2, new Error("probe failed again"));
    expect(failedAgain).toBeNull();
    expect(harness.hook().current).toBe("1.2.3");
    expect(harness.reportError).toHaveBeenCalledTimes(1);
    expect(harness.notices).toHaveLength(0);
    harness.unmount();
  });

  it("releases a stuck probe after the wait timeout so later callers probe again", async () => {
    vi.useFakeTimers();
    try {
      const harness = renderCliVersion();
      await waitForReact(() => expect(harness.calls).toHaveLength(1));

      let stuck!: Promise<string | null>;
      act(() => {
        stuck = harness.hook().probe();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_CLI_VERSION_PROBE_WAIT_MS);
      });
      await expect(stuck).resolves.toBeNull();

      let retried!: Promise<string | null>;
      act(() => {
        retried = harness.hook().probe();
      });
      expect(harness.calls).toHaveLength(2);

      harness.resolveCall(1, "1.2.3");
      await expect(retried).resolves.toBe("1.2.3");
      await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));

      harness.resolveCall(0, "1.2.3");
      await waitForReact(() => expect(harness.hook().current).toBe("1.2.3"));
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent probes and discards the result after unmount", async () => {
    const harness = renderCliVersion();
    await waitForReact(() => expect(harness.calls).toHaveLength(1));

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = harness.hook().probe();
      second = harness.hook().probe();
    });
    expect(harness.calls).toHaveLength(1);

    harness.unmount();
    harness.resolveCall(0, "1.2.3");

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(harness.notices).toHaveLength(0);
    expect(harness.reportError).not.toHaveBeenCalled();
  });
});

function renderCliVersion(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    agentCliPath: PATH_A,
    agentCliKind: "claudeCode",
    enabled: true,
    withGateway: true,
    ...overrides,
  };
  const calls: PendingProbe[] = [];
  const notices: Array<AgentTasksNotice | null> = [];
  const reportError = vi.fn();

  const gateway = {
    probeAgentCliVersion: vi.fn((request: AgentCliVersionProbeRequest) => {
      let resolve!: (result: AgentCliVersionProbeResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<AgentCliVersionProbeResult>((settle, fail) => {
        resolve = settle;
        reject = fail;
      });
      calls.push({ request, promise, resolve, reject });
      return promise;
    }),
  };

  let current: AgentCliVersionSurface | null = null;

  function Harness() {
    current = useAgentCliVersion({
      gateway: environment.withGateway ? (gateway as AgentCliVersionGateway) : null,
      agentCliPath: environment.agentCliPath,
      agentCliKind: environment.agentCliKind,
      enabled: environment.enabled,
      setNotice: (notice) => notices.push(notice),
      reportError,
      now: () => 1_700_000_000_000,
    });
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (): void => act(() => root.render(createElement(Harness)));
  render();

  const harness = {
    gateway,
    calls,
    notices,
    reportError,
    environment,
    hook(): AgentCliVersionSurface {
      expect(current).not.toBeNull();
      return current as AgentCliVersionSurface;
    },
    set(next: Partial<Environment>): void {
      Object.assign(environment, next);
      render();
    },
    resolveCall(index: number, version: string | null): void {
      const call = calls[index];
      expect(call).toBeDefined();
      call?.resolve(probeResult(version));
    },
    rejectCall(index: number, error: unknown): void {
      const call = calls[index];
      expect(call).toBeDefined();
      call?.promise.catch(() => undefined);
      call?.reject(error);
    },
    async probeWith(index: number, version: string | null): Promise<string | null> {
      const probed: Array<string | null> = [];
      await act(async () => {
        const pending = harness.hook().probe();
        harness.resolveCall(index, version);
        probed.push(await pending);
      });
      return probed[0] ?? null;
    },
    async probeFailingWith(index: number, error: unknown): Promise<string | null> {
      const probed: Array<string | null> = [];
      await act(async () => {
        const pending = harness.hook().probe();
        harness.rejectCall(index, error);
        probed.push(await pending);
      });
      return probed[0] ?? null;
    },
    unmount(): void {
      act(() => root.unmount());
      host.remove();
    },
  };

  return harness;
}
