import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  defaultAgentProviderPreferences,
  normalizeAgentProviderHealthCheckIntervalSeconds,
  normalizeAgentProviderPreferences,
} from "./agentProviderSettings";

const DEFAULT_PREFERENCE = {
  enabled: true,
  healthCheckIntervalSeconds: 300,
  checkForUpdates: false,
  dismissedUpdateVersion: null,
} as const;

describe("agent provider settings", () => {
  it("defaults both providers without network checks", () => {
    expect(defaultAgentProviderPreferences()).toEqual({
      claudeCode: DEFAULT_PREFERENCE,
      codex: DEFAULT_PREFERENCE,
    });
    expect(DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS).toBe(300);
    expect(MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS).toBe(86_400);
  });

  it("accepts exact preferences and bounds intervals", () => {
    expect(
      normalizeAgentProviderPreferences({
        claudeCode: {
          enabled: false,
          healthCheckIntervalSeconds: 0,
          checkForUpdates: true,
          dismissedUpdateVersion: "2.1.245",
        },
        codex: {
          enabled: true,
          healthCheckIntervalSeconds: 86_401,
          checkForUpdates: false,
          dismissedUpdateVersion: "0.150.1",
        },
      }),
    ).toEqual({
      claudeCode: {
        enabled: false,
        healthCheckIntervalSeconds: 0,
        checkForUpdates: true,
        dismissedUpdateVersion: "2.1.245",
      },
      codex: {
        enabled: true,
        healthCheckIntervalSeconds: 86_400,
        checkForUpdates: false,
        dismissedUpdateVersion: "0.150.1",
      },
    });
    expect(normalizeAgentProviderHealthCheckIntervalSeconds(-1)).toBe(0);
    expect(normalizeAgentProviderHealthCheckIntervalSeconds(300.9)).toBe(300);
    expect(normalizeAgentProviderHealthCheckIntervalSeconds(Number.NaN)).toBe(300);
  });

  it("fails unknown, partial, secret-bearing, and malformed records closed", () => {
    for (const malformed of [
      { claudeCode: DEFAULT_PREFERENCE },
      { claudeCode: DEFAULT_PREFERENCE, codex: DEFAULT_PREFERENCE, cursor: DEFAULT_PREFERENCE },
      {
        claudeCode: { ...DEFAULT_PREFERENCE, token: "secret" },
        codex: DEFAULT_PREFERENCE,
      },
      {
        claudeCode: { ...DEFAULT_PREFERENCE, enabled: "true" },
        codex: DEFAULT_PREFERENCE,
      },
      {
        claudeCode: { ...DEFAULT_PREFERENCE, healthCheckIntervalSeconds: 300.9 },
        codex: DEFAULT_PREFERENCE,
      },
      {
        claudeCode: { ...DEFAULT_PREFERENCE, dismissedUpdateVersion: " v1.2.3 " },
        codex: DEFAULT_PREFERENCE,
      },
    ]) {
      expect(normalizeAgentProviderPreferences(malformed)).toEqual({
        claudeCode: DEFAULT_PREFERENCE,
        codex: DEFAULT_PREFERENCE,
      });
    }
  });

  it("returns fresh default records", () => {
    const first = defaultAgentProviderPreferences();
    const second = defaultAgentProviderPreferences();
    expect(first).not.toBe(second);
    expect(first.claudeCode).not.toBe(second.claudeCode);
  });
});
