import { describe, expect, it } from "vitest";
import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import type {
  AgentProviderHealthState,
  AgentProviderUpdateAvailability,
} from "../../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import {
  providerAuthLabel,
  providerCheckedLabel,
  providerChecksSummaryLabel,
  providerHeadline,
  providerHeadlineTitle,
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
    ["neutral", authUnknown(), true],
    ["neutral", authUnknown({ kind: "checksDisabled" }), true],
    [
      "warning",
      authUnknown({
        kind: "manualUpdateAvailable",
        installedVersion: "2.1.245",
        availableVersion: "2.2.0",
      }),
      true,
    ],
    ["dimmed", ready(NOW), false],
  ])("maps the status dot to %s", (tone, health, enabled) => {
    expect(providerStatusTone(enabled, view({ health }))).toBe(tone);
  });

  it("explains an unchecked sign-in only while the CLI is installed and up to date", () => {
    expect(providerHeadlineTitle(view({ health: authUnknown() }), true)).toBe(
      "Codevo could not determine whether you are signed in; the CLI is installed and up to date.",
    );
    expect(
      providerHeadlineTitle(view({ health: authUnknown({ kind: "checksDisabled" }) }), true),
    ).toBe(
      "Codevo could not determine whether you are signed in; the CLI is installed and update checks are disabled.",
    );
    expect(
      providerHeadlineTitle(
        view({
          health: authUnknown({
            kind: "manualUpdateAvailable",
            installedVersion: "2.1.245",
            availableVersion: "2.2.0",
          }),
        }),
        true,
      ),
    ).toBeNull();
    expect(providerHeadlineTitle(view({ health: ready(NOW) }), true)).toBeNull();
    expect(providerHeadlineTitle(view({ health: authUnknown() }), false)).toBeNull();
  });

  it("stops calling an unchecked sign-in an authentication problem", () => {
    expect(providerHeadline(view({ health: authUnknown() }), true)).toBe(
      "Sign-in status not checked",
    );
    expect(providerAuthLabel(authUnknown())).toBe("Sign-in status not checked");
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

  it("stops offering an update the updater already ran without changing the version", () => {
    const available = availableUpdate(withUpdate());
    const settled = {
      kind: "alreadyCurrent",
      installedVersion: "2.1.245",
      offeredVersion: "2.2.0",
      outputTail: "",
      outputTruncated: false,
    } as const;

    expect(available?.availableVersion).toBe("2.2.0");
    expect(
      providerUpdateBlockedReason(
        "codex",
        view({ health: withUpdate(), updateState: settled }),
        available,
        true,
        false,
      ),
    ).toBe("The updater already ran and left Codex on v2.1.245.");
    expect(
      providerUpdateBlockedReason(
        "codex",
        view({
          health: withUpdate(),
          updateState: { ...settled, offeredVersion: "2.1.9" },
        }),
        available,
        true,
        false,
      ),
    ).toBeNull();
  });

  it("keeps the self-update hint only when a self-update installer offered the version", () => {
    const failed = {
      kind: "failed",
      reason: "installerUnsupported",
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

  it("labels every closed update failure reason without naming the provider policy", () => {
    const messages = (
      [
        "operationSuperseded",
        "authorityChanged",
        "executableChanged",
        "installerUnsupported",
        "spawnFailed",
        "timedOut",
        "outputLimitExceeded",
        "exited",
        "uncertain",
        "versionMismatch",
      ] as const
    ).map(
      (reason) =>
        providerUpdateResultPresentation(
          { kind: "failed", reason, outputTail: "", outputTruncated: false },
          { kind: "selfUpdate", command: "claudeUpdate" },
        )?.message ?? "",
    );

    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("provider policy");
    }
    expect(messages[1]).toBe(
      "Provider settings changed while the update was starting. Try again or update manually with claude update.",
    );
    expect(messages[2]).toBe(
      "The provider executable changed while the update was starting. Try again or update manually with claude update.",
    );
  });

  it("reports an already-current outcome as observed evidence, never as up to date", () => {
    const alreadyCurrent = {
      kind: "alreadyCurrent",
      installedVersion: "2.1.261",
      offeredVersion: "2.1.263",
      outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
      outputTruncated: true,
    } as const;

    expect(
      providerUpdateResultPresentation(alreadyCurrent, {
        kind: "selfUpdate",
        command: "claudeUpdate",
      }),
    ).toEqual({
      tone: "neutral",
      role: "status",
      message:
        "The updater ran but the installed version is still v2.1.261. v2.1.263 is published for this provider and may not apply to this install. Try again or update manually with claude update.",
      outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
      outputTruncated: true,
    });
    expect(providerUpdateResultPresentation(alreadyCurrent, null)?.message).toContain(
      "update this CLI with its original installer.",
    );
    expect(providerUpdateResultPresentation(alreadyCurrent, null)?.message).not.toContain(
      "latest version",
    );
    expect(
      providerUpdateResultPresentation({ ...alreadyCurrent, offeredVersion: null }, null)?.message,
    ).toBe(
      "The updater ran but the installed version is still v2.1.261. Try again or update this CLI with its original installer.",
    );
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

function authUnknown(
  update: AgentProviderUpdateAvailability = { kind: "current", installedVersion: "2.1.245" },
): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "unknown" },
    update,
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
