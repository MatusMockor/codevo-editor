// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentCliVersionGateway,
  AgentCliVersionProbeRequest,
  AgentCliVersionProbeResult,
} from "../domain/agentCliVersion";
import type { AgentCliPaths } from "../domain/agentSettings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentSettingsCliVersions,
  type AgentSettingsCliVersions,
} from "./useAgentSettingsCliVersions";

interface PendingProbe {
  readonly request: AgentCliVersionProbeRequest;
  resolve(result: AgentCliVersionProbeResult): void;
  reject(error: unknown): void;
}

describe("useAgentSettingsCliVersions", () => {
  it("probes both configured providers and reports their independent results", async () => {
    const harness = renderVersions({
      claudeCode: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
    });
    await waitForReact(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls.map((call) => call.request)).toEqual([
      { agentCliPath: "/usr/local/bin/claude", agentCliKind: "claudeCode" },
      { agentCliPath: "/usr/local/bin/codex", agentCliKind: "codex" },
    ]);

    harness.resolve(0, "2.1.245");
    harness.resolve(1, null);
    await waitForReact(() =>
      expect(harness.current()).toEqual({
        claudeCode: { kind: "ready", version: "2.1.245" },
        codex: { kind: "unknownVersion" },
      }),
    );
    harness.unmount();
  });

  it("does not probe a relative path and discards A results across A to B to A", async () => {
    const harness = renderVersions({ claudeCode: "bin/claude", codex: null });
    expect(harness.current().claudeCode).toEqual({ kind: "invalidPath" });
    expect(harness.calls).toHaveLength(0);

    harness.set({ claudeCode: "/a/claude", codex: null });
    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    harness.set({ claudeCode: "/b/claude", codex: null });
    await waitForReact(() => expect(harness.calls).toHaveLength(2));
    harness.set({ claudeCode: "/a/claude", codex: null });
    await waitForReact(() => expect(harness.calls).toHaveLength(3));

    harness.resolve(0, "1.0.0");
    harness.resolve(1, "2.0.0");
    await waitForReact(() => expect(harness.current().claudeCode).toEqual({ kind: "probing" }));
    harness.resolve(2, "3.0.0");
    await waitForReact(() =>
      expect(harness.current().claudeCode).toEqual({ kind: "ready", version: "3.0.0" }),
    );
    harness.unmount();
  });

  it("drops a rejection after unmount", async () => {
    const harness = renderVersions({ claudeCode: "/a/claude", codex: null });
    await waitForReact(() => expect(harness.calls).toHaveLength(1));
    harness.unmount();
    harness.reject(0, new Error("late"));
    await Promise.resolve();
  });
});

function renderVersions(initialPaths: AgentCliPaths) {
  let paths = initialPaths;
  let current: AgentSettingsCliVersions | null = null;
  const calls: PendingProbe[] = [];
  const gateway: AgentCliVersionGateway = {
    probeAgentCliVersion: vi.fn((request) => {
      let resolve!: (result: AgentCliVersionProbeResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<AgentCliVersionProbeResult>((settle, fail) => {
        resolve = settle;
        reject = fail;
      });
      calls.push({ request, resolve, reject });
      return promise;
    }),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    current = useAgentSettingsCliVersions(gateway, paths);
    return null;
  }
  const render = (): void => act(() => root.render(createElement(Probe)));
  render();
  return {
    calls,
    current(): AgentSettingsCliVersions {
      expect(current).not.toBeNull();
      return current as AgentSettingsCliVersions;
    },
    set(next: AgentCliPaths): void {
      paths = next;
      render();
    },
    resolve(index: number, version: string | null): void {
      calls[index]?.resolve({
        version,
        probedAtEpochMs: 1,
        binaryFingerprint: { sizeBytes: 1, modifiedEpochMs: 1 },
      });
    },
    reject(index: number, error: unknown): void {
      calls[index]?.reject(error);
    },
    unmount(): void {
      act(() => root.unmount());
      host.remove();
    },
  };
}
