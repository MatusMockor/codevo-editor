import { describe, expect, it } from "vitest";
import type { AgentProviderPreference } from "../domain/agentProviderSettings";
import {
  agentProviderHealthBeforeRegistration,
  agentProviderHealthForAutomaticDiscovery,
  agentProviderHealthWithPersistedUpdateAuthority,
  effectiveAgentProviderCliPath,
} from "./agentProviderDiscoveryAdmission";

const ENABLED: AgentProviderPreference = {
  enabled: true,
  healthCheckIntervalSeconds: 300,
  checkForUpdates: false,
  dismissedUpdateVersion: null,
};

describe("agent provider discovery admission", () => {
  it("prefers a persisted manual override and otherwise requires exact detection", () => {
    const discovery = {
      generation: 4,
      result: {
        claudeCode: { kind: "detected", path: "/detected/claude", version: "1.2.3" },
        codex: { kind: "notFound" },
      },
    } as const;

    expect(effectiveAgentProviderCliPath("claudeCode", "/manual/claude", discovery)).toBe(
      "/manual/claude",
    );
    expect(effectiveAgentProviderCliPath("claudeCode", null, discovery)).toBe("/detected/claude");
    expect(effectiveAgentProviderCliPath("codex", null, discovery)).toBeNull();
    expect(effectiveAgentProviderCliPath("claudeCode", null, null)).toBeNull();
  });

  it("projects disabled, pending, detected, missing, and failed discovery truthfully", () => {
    expect(
      agentProviderHealthBeforeRegistration({ ...ENABLED, enabled: false }, null, undefined),
    ).toEqual({ kind: "disabled" });
    expect(agentProviderHealthBeforeRegistration(ENABLED, null, { kind: "notFound" })).toEqual({
      kind: "notConfigured",
    });
    expect(
      agentProviderHealthBeforeRegistration(ENABLED, null, {
        kind: "detected",
        path: "/detected/claude",
        version: null,
      }),
    ).toEqual({ kind: "checking", generation: 0 });
    expect(agentProviderHealthForAutomaticDiscovery(ENABLED, "discovering", 7, undefined)).toEqual({
      kind: "checking",
      generation: 7,
    });
    expect(agentProviderHealthForAutomaticDiscovery(ENABLED, "failed", 7, undefined)).toEqual({
      kind: "notConfigured",
    });
    expect(
      agentProviderHealthForAutomaticDiscovery(ENABLED, "ready", 7, {
        kind: "detected",
        path: "/detected/claude",
        version: "1.2.3",
      }),
    ).toEqual({ kind: "checking", generation: 7 });
    expect(
      agentProviderHealthForAutomaticDiscovery(ENABLED, "ready", 7, { kind: "notFound" }),
    ).toEqual({ kind: "notConfigured" });
    expect(
      agentProviderHealthForAutomaticDiscovery({ ...ENABLED, enabled: false }, "ready", 7, {
        kind: "detected",
        path: "/detected/claude",
        version: null,
      }),
    ).toEqual({ kind: "disabled" });
  });

  it("forces checks-disabled from persisted update authority", () => {
    const result = {
      installedVersion: "1.2.3",
      auth: { kind: "unknown" as const },
      update: { kind: "current" as const, installedVersion: "1.2.3" },
      checkedAtEpochMs: 1,
    };

    expect(agentProviderHealthWithPersistedUpdateAuthority(result, ENABLED).update).toEqual({
      kind: "checksDisabled",
    });
    expect(agentProviderHealthWithPersistedUpdateAuthority(result, undefined).update).toEqual({
      kind: "checksDisabled",
    });
    expect(
      agentProviderHealthWithPersistedUpdateAuthority(result, {
        ...ENABLED,
        checkForUpdates: true,
      }),
    ).toBe(result);
  });
});
