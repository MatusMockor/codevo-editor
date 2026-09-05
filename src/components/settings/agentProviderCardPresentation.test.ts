import { describe, expect, it } from "vitest";
import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import type { AgentProviderHealthState } from "../../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import {
  providerCheckedLabel,
  providerChecksSummaryLabel,
  providerHeadline,
  providerSettingsAtDefault,
  providerStatusTone,
} from "./agentProviderCardPresentation";
import {
  availableUpdate,
  providerManualUpdateCommand,
  providerUpdateBlockedReason,
  providerUpdateResultPresentation,
} from "./agentProviderUpdatePresentation";

const NOW = Date.parse("2026-09-05T12:00:00Z");

describe("agentProviderCardPresentation", () => {
  it("reports the oldest provider check for the section heading", () => {
    expect(providerChecksSummaryLabel([ready(NOW - 60_000), ready(NOW - 20 * 60_000)], NOW)).toBe(
      "Checked 20m ago",
    );
  });

  it("refuses to claim a check when one provider has never been checked", () => {
    expect(providerChecksSummaryLabel([ready(NOW), { kind: "notConfigured" }], NOW)).toBe(
      "Not checked yet",
    );
  });

  it.each([
    [0, "Checked just now"],
    [5 * 60_000, "Checked 5m ago"],
    [3 * 60 * 60_000, "Checked 3h ago"],
    [3 * 24 * 60 * 60_000, "Checked over 24h ago"],
  ])("bounds the relative age at %i ms", (ageMs, label) => {
    expect(providerCheckedLabel(ready(NOW - ageMs), NOW)).toBe(label);
  });

  it.each([
    ["success", ready(NOW), true],
    ["warning", signedOut(), true],
    ["danger", { kind: "notConfigured" } as AgentProviderHealthState, true],
    ["danger", { kind: "failed", reason: "probeFailed", checkedAtEpochMs: NOW } as const, true],
    ["checking", { kind: "checking", generation: 1 } as const, true],
    ["dimmed", ready(NOW), false],
  ])("maps the status dot to %s", (tone, health, enabled) => {
    expect(providerStatusTone(enabled, view({ health }))).toBe(tone);
  });

  it.each([
    [ready(NOW), true, "Authenticated as Pro plan"],
    [signedOut(), true, "Not authenticated - Sign in via the CLI to authenticate again."],
    [ready(NOW), false, "Provider disabled."],
  ])("writes the headline for %o", (health, enabled, headline) => {
    expect(providerHeadline(view({ health }), enabled)).toBe(headline);
  });

  it("names a missing CLI without inventing a health result", () => {
    expect(
      providerHeadline(
        view({
          executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
          health: { kind: "notConfigured" },
        }),
        true,
      ),
    ).toBe("Not found - CLI not detected on PATH.");
  });

  it.each([
    [{ kind: "npm", packageName: "@openai/codex" } as const, "npm install -g @openai/codex@latest"],
    [{ kind: "homebrew", cask: "codex" } as const, "brew upgrade --cask codex"],
    [{ kind: "selfUpdate", command: "claudeUpdate" } as const, "claude update"],
    [{ kind: "unknown" } as const, null],
  ])("writes the manual update command for %o", (installer, command) => {
    expect(providerManualUpdateCommand(installer)).toBe(command);
  });

  it("refuses an update while the provider is disabled, busy, or unregistered", () => {
    const available = availableUpdate(withUpdate());

    expect(available).not.toBeNull();
    expect(
      providerUpdateBlockedReason("codex", view({ health: withUpdate() }), available, false, false),
    ).toBe("Enable Codex first.");
    expect(
      providerUpdateBlockedReason(
        "codex",
        view({ health: withUpdate(), liveTurnCount: 2 }),
        available,
        true,
        false,
      ),
    ).toBe("Stop running Codex turns first.");
    expect(
      providerUpdateBlockedReason(
        "codex",
        view({ health: withUpdate(), policy: { kind: "unregistered" } }),
        available,
        true,
        false,
      ),
    ).toBe("Register the provider policy first.");
    expect(
      providerUpdateBlockedReason("codex", view({ health: withUpdate() }), null, true, false),
    ).toBe("No update is available.");
    expect(
      providerUpdateBlockedReason("codex", view({ health: withUpdate() }), available, true, false),
    ).toBeNull();
  });

  it("keeps the self-update hint only when a self-update installer offered the version", () => {
    const failed = {
      kind: "failed",
      reason: "versionNotAdvanced",
      outputTail: "",
      outputTruncated: false,
    } as const;

    expect(
      providerUpdateResultPresentation(failed, { kind: "selfUpdate", command: "codexUpdate" })
        ?.message,
    ).toContain("update manually with codex update.");
    expect(providerUpdateResultPresentation(failed, null)?.message).toContain(
      "update this CLI with its original installer.",
    );
    expect(providerUpdateResultPresentation({ kind: "idle" }, null)).toBeNull();
  });

  it("detects provider settings that still match the defaults", () => {
    const preference = defaultAgentProviderPreferences().claudeCode;

    expect(providerSettingsAtDefault(null, preference)).toBe(true);
    expect(providerSettingsAtDefault("/usr/local/bin/claude", preference)).toBe(false);
    expect(providerSettingsAtDefault(null, { ...preference, healthCheckIntervalSeconds: 60 })).toBe(
      false,
    );
    expect(
      providerSettingsAtDefault(null, { ...preference, dismissedUpdateVersion: "2.2.0" }),
    ).toBe(false);
  });
});

function ready(checkedAtEpochMs: number): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedIn", label: "Pro plan" },
    update: { kind: "current", installedVersion: "2.1.245" },
    checkedAtEpochMs,
  };
}

function signedOut(): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedOut" },
    update: { kind: "current", installedVersion: "2.1.245" },
    checkedAtEpochMs: NOW,
  };
}

function withUpdate(): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedIn", label: null },
    update: {
      kind: "available",
      installedVersion: "2.1.245",
      availableVersion: "2.2.0",
      installer: { kind: "npm", packageName: "@openai/codex" },
    },
    checkedAtEpochMs: NOW,
  };
}

function view(overrides: Partial<AgentProviderManagementView> = {}): AgentProviderManagementView {
  return {
    executable: { kind: "manual", path: "/usr/local/bin/claude" },
    health: ready(NOW),
    policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
    updateState: { kind: "idle" },
    liveTurnCount: 0,
    ...overrides,
  };
}
