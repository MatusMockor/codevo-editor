// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccountUsageSnapshot } from "../domain/agentAccountUsage";
import { createAgentAccountUsageSources } from "./agentAccountUsageSources";
import { useAgentAccountUsage } from "./useAgentAccountUsage";
import { useAgentAccountUsageSourceProjection } from "./useAgentAccountUsageSourceProjection";
import { useAgentAccountUsageSharedObservations } from "./useAgentAccountUsageSharedObservations";

const identity = `account:v1:sha256:${"a".repeat(64)}`;
function snapshot(
  primary: number,
  weekly: number,
  accountIdentity = identity,
): AgentAccountUsageSnapshot {
  return {
    provider: "codex",
    accountIdentity,
    fetchedAtEpochMs: Date.now(),
    windows: [
      ["primary", primary],
      ["weekly", weekly],
    ].map(([id, percent]) => ({
      id: String(id),
      label: String(id),
      usedPercent: Number(percent),
      windowDurationMinutes: null,
      resetsAtEpochMs: null,
      resetsLabel: null,
    })),
  };
}
describe("shared account usage projection", () => {
  const releases: (() => void)[] = [];
  beforeEach(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
  afterEach(() => act(() => releases.splice(0).forEach((release) => release())));
  function mount() {
    const sources = createAgentAccountUsageSources();
    const gateway = {
      loadAgentAccountUsage: () => [snapshot(20, 30)],
      saveAgentAccountUsage: vi.fn(),
    };
    const root = createRoot(document.createElement("div"));
    releases.push(() => root.unmount());
    let state!: ReturnType<typeof useAgentAccountUsageSourceProjection>;
    let record!: ReturnType<typeof useAgentAccountUsageSharedObservations>;
    let invalidate!: ReturnType<typeof useAgentAccountUsage>["invalidateAccountUsage"];
    function Harness() {
      const local = useAgentAccountUsage(gateway);
      state = useAgentAccountUsageSourceProjection(local.accountUsage, sources);
      record = useAgentAccountUsageSharedObservations(
        local.recordAccountUsage,
        local.captureUsage,
        sources,
      );
      invalidate = local.invalidateAccountUsage;
      return null;
    }
    act(() => root.render(<Harness />));
    return {
      sources,
      gateway,
      state: () => state,
      record: (...args: Parameters<typeof record>) => record(...args),
      invalidate: (...args: Parameters<typeof invalidate>) => invalidate(...args),
    };
  }
  it("retains a peer's newer weekly window when the next local turn reports only its primary window", () => {
    const h = mount();
    act(() => h.sources.observe("server", snapshot(25, 40)));
    expect(h.state().codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 25 }, { usedPercent: 40 }] },
    });
    expect(h.gateway.saveAgentAccountUsage).not.toHaveBeenCalled();
    act(() => h.record({ provider: "codex", windows: snapshot(30, 0).windows.slice(0, 1) }));
    expect(h.state().codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 30 }, { usedPercent: 40 }] },
    });
    expect(h.gateway.saveAgentAccountUsage).toHaveBeenCalledTimes(1);
  });
  it("isolates a peer with another identity and removes the local binding after sign-out", () => {
    const h = mount();
    act(() => h.sources.observe("server", snapshot(90, 99, `account:v1:sha256:${"b".repeat(64)}`)));
    act(() => h.record({ provider: "codex", windows: snapshot(30, 0).windows.slice(0, 1) }));
    expect(h.state().codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 30 }, { usedPercent: 30 }] },
    });
    act(() => h.invalidate("codex"));
    expect(h.state().codex).toEqual({ kind: "idle" });
    expect(h.sources.read("local", "codex")).toBeNull();
  });
});
