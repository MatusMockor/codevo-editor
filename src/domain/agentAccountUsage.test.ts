import { describe, expect, it } from "vitest";
import {
  mergeAgentAccountUsageObservation,
  parseAgentAccountUsageSnapshot,
  type AgentAccountUsageSnapshot,
  type AgentAccountUsageWindow,
} from "./agentAccountUsage";

const identity = `account:v1:sha256:${"a".repeat(64)}`;
const window: AgentAccountUsageWindow = {
  id: "codex-primary",
  label: "5-hour limit",
  usedPercent: 12,
  windowDurationMinutes: 300,
  resetsAtEpochMs: 1_000,
  resetsLabel: null,
};
const snapshot: AgentAccountUsageSnapshot = {
  provider: "codex",
  accountIdentity: identity,
  fetchedAtEpochMs: 500,
  windows: [window],
};

describe("account usage identity boundary", () => {
  it("accepts only a known opaque hash, missing identity, or explicit unknown", () => {
    expect(parseAgentAccountUsageSnapshot(snapshot)).toEqual(snapshot);
    const { accountIdentity: _identity, ...legacy } = snapshot;
    expect(parseAgentAccountUsageSnapshot(legacy)).toEqual(legacy);
    expect(
      parseAgentAccountUsageSnapshot({ ...snapshot, accountIdentity: null }).accountIdentity,
    ).toBeNull();
    for (const accountIdentity of [
      "",
      "user@example.com",
      identity.toUpperCase(),
      `${identity}x`,
      1,
      {},
    ]) {
      expect(() => parseAgentAccountUsageSnapshot({ ...snapshot, accountIdentity })).toThrow();
    }
    expect(() => parseAgentAccountUsageSnapshot({ ...snapshot, accountId: "private" })).toThrow();
  });

  it("preserves a verified identity only within the matching provider source", () => {
    expect(
      mergeAgentAccountUsageObservation(
        snapshot,
        { provider: "codex", windows: [{ ...window, usedPercent: 20 }] },
        600,
      ).accountIdentity,
    ).toBe(identity);
    const foreign = mergeAgentAccountUsageObservation(
      snapshot,
      { provider: "claudeCode", windows: [{ ...window, id: "five_hour" }] },
      600,
    );
    expect(foreign.accountIdentity).toBeUndefined();
    expect(foreign.windows.map((entry) => entry.id)).toEqual(["five_hour"]);
    expect(
      mergeAgentAccountUsageObservation(
        { ...snapshot, accountIdentity: null },
        { provider: "codex", windows: [window] },
        600,
      ).accountIdentity,
    ).toBeNull();
  });

  it("rejects empty, duplicate, oversized, and control-bearing windows", () => {
    for (const windows of [
      [],
      [window, window],
      Array.from({ length: 13 }, (_, id) => ({ ...window, id: String(id) })),
    ]) {
      expect(() => parseAgentAccountUsageSnapshot({ ...snapshot, windows })).toThrow();
    }
    for (const changed of [
      { id: " " },
      { label: "\nlimit" },
      { resetsLabel: "reset\0" },
      { id: "x".repeat(161) },
    ]) {
      expect(() =>
        parseAgentAccountUsageSnapshot({ ...snapshot, windows: [{ ...window, ...changed }] }),
      ).toThrow();
    }
  });
});
