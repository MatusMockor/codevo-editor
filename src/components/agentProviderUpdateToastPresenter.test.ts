import { describe, expect, it } from "vitest";
import type {
  AgentProviderManagementToast,
  AgentProviderManagementView,
} from "../application/useAgentProviderManagement";
import type {
  AgentProviderHealthState,
  AgentProviderUpdateState,
} from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentSettings";
import {
  agentProviderUpdateFailureSentence,
  agentProviderUpdateInstallerLabel,
  agentProviderUpdateNoticeGroupKey,
  agentProviderUpdateRefusalSentence,
  agentProviderUpdateToastGroupKey,
  agentProviderUpdateToastTitle,
  createAgentProviderUpdateToastView,
  presentAgentProviderUpdateToast,
  type AgentProviderUpdateToastSource,
} from "./agentProviderUpdateToastPresenter";

const CLAUDE_UPDATE: AgentProviderHealthState = {
  kind: "ready",
  installedVersion: "2.0.0",
  auth: { kind: "unknown" },
  update: {
    kind: "available",
    installedVersion: "2.0.0",
    availableVersion: "2.1.0",
    installer: { kind: "homebrew", cask: "claude-code" },
  },
  checkedAtEpochMs: 1,
};

const CODEX_UPDATE: AgentProviderHealthState = {
  kind: "ready",
  installedVersion: "0.152.0",
  auth: { kind: "unknown" },
  update: {
    kind: "available",
    installedVersion: "0.152.0",
    availableVersion: "0.153.4",
    installer: { kind: "npm", packageName: "@openai/codex" },
  },
  checkedAtEpochMs: 1,
};

describe("agent provider update toast presenter", () => {
  it("presents a single one-click update with installed version and installer details", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
        codex: { health: CODEX_UPDATE },
      }),
    );

    expect(presentation).toEqual({
      kind: "available",
      view: {
        provider: "codex",
        availableVersion: "0.153.4",
        details: { installedVersion: "0.152.0", installer: "npm" },
      },
    });
  });

  it("merges a second pending one-click update into one toast", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
        claudeCode: { health: CLAUDE_UPDATE },
        codex: { health: CODEX_UPDATE },
      }),
    );

    expect(presentation?.kind).toBe("availableMany");
    if (presentation?.kind !== "availableMany") return;
    expect(presentation.views.map((view) => `${view.provider}@${view.availableVersion}`)).toEqual([
      "codex@0.153.4",
      "claudeCode@2.1.0",
    ]);
    expect(presentation.views[1].details).toEqual({
      installedVersion: "2.0.0",
      installer: "homebrew",
    });
  });

  it("does not merge dismissed, manual, busy, or unregistered updates", () => {
    const codexToast: AgentProviderManagementToast = {
      kind: "updateAvailable",
      provider: "codex",
      version: "0.153.4",
    };

    const dismissed = presentAgentProviderUpdateToast(
      source({
        toast: codexToast,
        claudeCode: { health: CLAUDE_UPDATE, dismissedUpdateVersion: "2.1.0" },
        codex: { health: CODEX_UPDATE },
      }),
    );
    expect(dismissed?.kind).toBe("available");

    const manualOther = presentAgentProviderUpdateToast(
      source({
        toast: codexToast,
        claudeCode: {
          health: {
            ...CLAUDE_UPDATE,
            update: {
              kind: "manualUpdateAvailable",
              installedVersion: "2.0.0",
              availableVersion: "2.1.0",
            },
          },
        },
        codex: { health: CODEX_UPDATE },
      }),
    );
    expect(manualOther?.kind).toBe("available");

    const manualSelf = presentAgentProviderUpdateToast(
      source({
        toast: { ...codexToast, manual: true },
        claudeCode: { health: CLAUDE_UPDATE },
        codex: { health: CODEX_UPDATE },
      }),
    );
    expect(manualSelf).toEqual({
      kind: "available",
      view: {
        provider: "codex",
        availableVersion: "0.153.4",
        manual: true,
        details: { installedVersion: "0.152.0", installer: "npm" },
      },
    });

    const failedOther = presentAgentProviderUpdateToast(
      source({
        toast: codexToast,
        claudeCode: {
          health: CLAUDE_UPDATE,
          updateState: {
            kind: "failed",
            reason: "exited",
            outputTail: "",
            outputTruncated: false,
          },
        },
        codex: { health: CODEX_UPDATE },
      }),
    );
    expect(failedOther?.kind).toBe("available");

    const unregistered = presentAgentProviderUpdateToast(
      source({
        toast: codexToast,
        claudeCode: { health: CLAUDE_UPDATE, authority: null },
        codex: { health: CODEX_UPDATE },
      }),
    );
    expect(unregistered?.kind).toBe("available");
  });

  it("prefers a running update over any pending toast", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "claudeCode", version: "2.1.0" },
        codex: {
          health: CODEX_UPDATE,
          updateState: {
            kind: "running",
            operationId: "op-7",
            outputTail: "",
            outputTruncated: false,
          },
        },
      }),
    );

    expect(presentation).toEqual({ kind: "updating", provider: "codex", operationId: "op-7" });
  });

  it("presents success and failure outcomes with bounded retry authority", () => {
    expect(
      presentAgentProviderUpdateToast(
        source({ toast: { kind: "updateSucceeded", provider: "codex", version: "0.153.4" } }),
      ),
    ).toEqual({ kind: "updated", provider: "codex", version: "0.153.4" });
    expect(
      presentAgentProviderUpdateToast(
        source({ toast: { kind: "updateSucceeded", provider: "codex", version: "not a version" } }),
      ),
    ).toBeNull();

    const failed = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateFailed", provider: "codex" },
        codex: {
          health: CODEX_UPDATE,
          updateState: {
            kind: "failed",
            reason: "timedOut",
            outputTail: "npm ERR! network",
            outputTruncated: false,
          },
        },
      }),
    );
    expect(failed).toEqual({
      kind: "failed",
      provider: "codex",
      reason: "timedOut",
      outputTail: "npm ERR! network",
      installedVersion: "0.152.0",
      retryVersion: "0.153.4",
    });

    const failedWithoutRetry = presentAgentProviderUpdateToast(
      source({ toast: { kind: "updateFailed", provider: "claudeCode" } }),
    );
    expect(failedWithoutRetry).toEqual({
      kind: "failed",
      provider: "claudeCode",
      reason: null,
      outputTail: "",
      installedVersion: null,
      retryVersion: null,
    });
  });

  it("returns nothing without a toast and fails closed on malformed versions", () => {
    expect(presentAgentProviderUpdateToast(source({ toast: null }))).toBeNull();
    expect(
      presentAgentProviderUpdateToast(
        source({ toast: { kind: "updateAvailable", provider: "codex", version: " 1.0.0 " } }),
      ),
    ).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", "not-a-version")).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", `1.${"0".repeat(300)}`)).toBeNull();
  });

  it("keeps toast group keys distinct per state so dismissals never leak across states", () => {
    const view = createAgentProviderUpdateToastView("codex", "0.153.4")!;
    const keys = [
      agentProviderUpdateToastGroupKey({ kind: "available", view }),
      agentProviderUpdateToastGroupKey({ kind: "availableMany", views: [view, view] }),
      agentProviderUpdateToastGroupKey({ kind: "updating", provider: "codex", operationId: "1" }),
      agentProviderUpdateToastGroupKey({
        kind: "updated",
        provider: "codex",
        version: view.availableVersion,
      }),
      agentProviderUpdateToastGroupKey({
        kind: "failed",
        provider: "codex",
        reason: null,
        outputTail: "",
        installedVersion: null,
        retryVersion: null,
      }),
      agentProviderUpdateToastGroupKey({
        kind: "refused",
        provider: "codex",
        version: view.availableVersion,
        refusal: "turnActive",
      }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(agentProviderUpdateNoticeGroupKey("codex", "0.153.4"));
  });

  it("shows a refusal until a running update or a fresh toast replaces it", () => {
    const refusal = {
      provider: "codex",
      version: createAgentProviderUpdateToastView("codex", "0.153.4")!.availableVersion,
      refusal: "turnActive",
    } as const;

    expect(
      presentAgentProviderUpdateToast(
        source({ toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" } }),
        refusal,
      ),
    ).toEqual({ kind: "refused", ...refusal });
    expect(
      presentAgentProviderUpdateToast(
        source({
          toast: null,
          codex: {
            updateState: { kind: "starting", operationId: "op-1" },
          },
        }),
        refusal,
      ),
    ).toEqual({ kind: "updating", provider: "codex", operationId: "op-1" });
    expect(agentProviderUpdateRefusalSentence("alreadyUpdating")).toBe(
      "A provider update is already running.",
    );
  });

  it("derives D-cased titles for every presentation", () => {
    const view = createAgentProviderUpdateToastView("codex", "0.153.4")!;
    expect(agentProviderUpdateToastTitle({ kind: "available", view })).toBe(
      "Update Available: Codex v0.153.4",
    );
    expect(agentProviderUpdateToastTitle({ kind: "availableMany", views: [view, view] })).toBe(
      "Updates Available: 2 providers",
    );
    expect(
      agentProviderUpdateToastTitle({
        kind: "updated",
        provider: "codex",
        version: view.availableVersion,
      }),
    ).toBe("Codex updated: v0.153.4");
    expect(
      agentProviderUpdateToastTitle({
        kind: "refused",
        provider: "codex",
        version: view.availableVersion,
        refusal: "disabled",
      }),
    ).toBe("Provider update not started");
  });

  it("translates failure reasons and installers into bounded copy", () => {
    expect(agentProviderUpdateFailureSentence(null)).toBe("Check provider settings for details.");
    expect(agentProviderUpdateFailureSentence("exited")).toBe(
      "The installer exited with an error.",
    );
    expect(agentProviderUpdateFailureSentence("versionMismatch")).toContain("does not match");
    expect(agentProviderUpdateInstallerLabel("npm")).toBe("npm");
    expect(agentProviderUpdateInstallerLabel("homebrew")).toBe("Homebrew");
    expect(agentProviderUpdateInstallerLabel("selfUpdate")).toBe("built-in updater");
    expect(agentProviderUpdateInstallerLabel("unknown")).toBe("unknown");
  });
});

interface ProviderOverrides {
  readonly authority?: null;
  readonly dismissedUpdateVersion?: string | null;
  readonly health?: AgentProviderHealthState;
  readonly updateState?: AgentProviderUpdateState;
}

function source(input: {
  readonly toast: AgentProviderManagementToast | null;
  readonly claudeCode?: ProviderOverrides;
  readonly codex?: ProviderOverrides;
}): AgentProviderUpdateToastSource {
  const overrides: Record<AgentCliKind, ProviderOverrides> = {
    claudeCode: input.claudeCode ?? {},
    codex: input.codex ?? {},
  };
  return {
    toast: input.toast,
    providers: {
      claudeCode: providerView(overrides.claudeCode),
      codex: providerView(overrides.codex),
    },
    authority: (provider) => {
      const override = overrides[provider];
      if (override.authority === null) return null;
      return {
        settingsRevision: 1,
        provider,
        preference: {
          enabled: true,
          healthCheckIntervalSeconds: 300,
          checkForUpdates: true,
          dismissedUpdateVersion: override.dismissedUpdateVersion ?? null,
        },
        cliPath: null,
      };
    },
  };
}

function providerView(overrides: ProviderOverrides): AgentProviderManagementView {
  return {
    executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
    health: overrides.health ?? { kind: "notConfigured" },
    policy: { kind: "unregistered" },
    updateState: overrides.updateState ?? { kind: "idle" },
    liveTurnCount: 0,
  };
}
