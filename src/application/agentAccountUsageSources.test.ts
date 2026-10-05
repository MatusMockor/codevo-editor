import { describe, expect, it, vi } from "vitest";
import type { AgentAccountUsageSnapshot } from "../domain/agentAccountUsage";
import { createAgentAccountUsageSources } from "./agentAccountUsageSources";

const identity = `account:v1:sha256:${"a".repeat(64)}`;
const other = `account:v1:sha256:${"b".repeat(64)}`;
function usage(
  percent: number,
  accountIdentity: string | null = identity,
  time = percent,
): AgentAccountUsageSnapshot {
  return {
    provider: "codex",
    accountIdentity,
    fetchedAtEpochMs: time,
    windows: [
      {
        id: "weekly",
        label: "Weekly limit",
        usedPercent: percent,
        windowDurationMinutes: null,
        resetsAtEpochMs: null,
        resetsLabel: null,
      },
    ],
  };
}
describe("account usage environment sources", () => {
  it("projects the newest accepted shared account receipt despite independently skewed host clocks", () => {
    const sources = createAgentAccountUsageSources();
    sources.observe("local", usage(20, identity, 999999));
    sources.observe("server/runner", usage(30, identity, 1));
    expect(sources.read("local", "codex")?.windows[0].usedPercent).toBe(30);
    sources.observe("local", usage(40, identity, 999998));
    expect(sources.read("server/runner", "codex")?.windows[0].usedPercent).toBe(40);
  });
  it("isolates distinct, missing and unknown account identities", () => {
    const sources = createAgentAccountUsageSources();
    sources.observe("local", usage(20));
    sources.observe("other", usage(80, other));
    sources.observe("unknown", usage(90, null));
    sources.observe("missing", { ...usage(99), accountIdentity: undefined });
    expect(sources.read("local", "codex")?.windows[0].usedPercent).toBe(20);
    expect(sources.read("unknown", "codex")?.windows[0].usedPercent).toBe(90);
  });
  it("rejects an overtaken same-account query while establishing a first remote source binding", () => {
    const sources = createAgentAccountUsageSources();
    const query = sources.revision();
    sources.observe("local", usage(40));
    expect(sources.observe("server", usage(20), query)).toBe(false);
    expect(sources.read("server", "codex")?.windows[0].usedPercent).toBe(40);
    expect(sources.read("local", "codex")?.windows[0].usedPercent).toBe(40);
  });
  it("rejects own-source late queries and invalidation revival, while allowing unrelated account/provider observations", () => {
    const sources = createAgentAccountUsageSources();
    sources.observe("local", usage(10));
    const query = sources.revision();
    sources.observe("foreign", usage(99, other));
    sources.observe("foreign", { ...usage(99), provider: "claudeCode" });
    expect(sources.observe("local", usage(20), query)).toBe(true);
    expect(sources.observe("local", usage(15), query)).toBe(false);
    const pending = sources.revision();
    sources.invalidate("local", "codex");
    expect(sources.observe("local", usage(30), pending)).toBe(false);
    expect(sources.read("local", "codex")).toBeNull();
    expect(sources.observe("local", usage(40), sources.revision())).toBe(true);
  });
  it("keeps retained source state bounded and releases subscriptions", () => {
    const sources = createAgentAccountUsageSources();
    const listener = vi.fn();
    const release = sources.subscribe(listener);
    sources.observe("local", usage(1, null));
    for (let index = 0; index < 130; index++) sources.observe(`server${index}`, usage(2, null));
    expect(sources.read("local", "codex")).not.toBeNull();
    expect(sources.read("server0", "codex")).toBeNull();
    const calls = listener.mock.calls.length;
    release();
    sources.invalidate("local", "codex");
    expect(listener).toHaveBeenCalledTimes(calls);
  });
  it("keeps the newest verified account observation when its source signs out or changes account", () => {
    const sources = createAgentAccountUsageSources();
    sources.observe("server", usage(20));
    sources.observe("local", usage(40));
    sources.invalidate("local", "codex");
    expect(sources.read("local", "codex")).toBeNull();
    expect(sources.read("server", "codex")?.windows[0].usedPercent).toBe(40);
    const pending = sources.revision();
    sources.observe("local", usage(50));
    sources.invalidate("local", "codex");
    expect(sources.observe("server", usage(30), pending)).toBe(false);
    expect(sources.read("server", "codex")?.windows[0].usedPercent).toBe(50);
    sources.observe("local", usage(90, other));
    expect(sources.read("server", "codex")?.windows[0].usedPercent).toBe(50);
  });
});
