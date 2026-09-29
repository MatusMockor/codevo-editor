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
  agentProviderUpdateNoticeGroupKey,
  agentProviderUpdateNoticeMessage,
  agentProviderUpdateVersionTransition,
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
  it("presents a single one-click update with the installed and offered versions", () => {
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
        installedVersion: "0.152.0",
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
    expect(presentation.views[1].installedVersion).toBe("2.0.0");
  });

  it("never offers an update to a version that is already installed or older", () => {
    const codexToast: AgentProviderManagementToast = {
      kind: "updateAvailable",
      provider: "codex",
      version: "0.159.0",
    };
    const offering = (installedVersion: string): AgentProviderHealthState => ({
      ...CODEX_UPDATE,
      installedVersion,
      update: {
        kind: "available",
        installedVersion,
        availableVersion: "0.159.0",
        installer: { kind: "selfUpdate", command: "codexUpdate" },
      },
    });

    for (const installed of ["0.159.0", "0.160.0", "0.159.0.1"]) {
      expect(
        presentAgentProviderUpdateToast(
          source({ toast: codexToast, codex: { health: offering(installed) } }),
        ),
      ).toBeNull();
    }
    expect(
      presentAgentProviderUpdateToast(
        source({ toast: codexToast, codex: { health: offering("0.159.0-alpha.1") } }),
      )?.kind,
    ).toBe("available");
  });

  it("drops a merged provider whose offered version is already installed", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
        claudeCode: {
          health: {
            ...CLAUDE_UPDATE,
            installedVersion: "2.1.284",
            update: {
              kind: "available",
              installedVersion: "2.1.284",
              availableVersion: "2.1.284",
              installer: { kind: "selfUpdate", command: "claudeUpdate" },
            },
          },
        },
        codex: { health: CODEX_UPDATE },
      }),
    );

    expect(presentation).toEqual({
      kind: "available",
      view: { provider: "codex", availableVersion: "0.153.4", installedVersion: "0.152.0" },
    });
  });

  it("withdraws a pending offer once the provider health no longer confirms it", () => {
    const codexToast: AgentProviderManagementToast = {
      kind: "updateAvailable",
      provider: "codex",
      version: "0.153.4",
    };
    const current: AgentProviderHealthState = {
      ...CODEX_UPDATE,
      installedVersion: "0.153.4",
      update: { kind: "current", installedVersion: "0.153.4" },
    };
    const newerOffer: AgentProviderHealthState = {
      ...CODEX_UPDATE,
      update: {
        kind: "available",
        installedVersion: "0.152.0",
        availableVersion: "0.154.0",
        installer: { kind: "npm", packageName: "@openai/codex" },
      },
    };

    expect(
      presentAgentProviderUpdateToast(source({ toast: codexToast, codex: { health: current } })),
    ).toBeNull();
    expect(
      presentAgentProviderUpdateToast(source({ toast: codexToast, codex: { health: newerOffer } })),
    ).toBeNull();
    expect(presentAgentProviderUpdateToast(source({ toast: codexToast }))).toBeNull();
  });

  it("keeps another provider's pending update when the toast's own offer is satisfied", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
        claudeCode: { health: CLAUDE_UPDATE },
        codex: {
          health: {
            ...CODEX_UPDATE,
            installedVersion: "0.153.4",
            update: { kind: "current", installedVersion: "0.153.4" },
          },
        },
      }),
    );

    expect(presentation).toEqual({
      kind: "available",
      view: { provider: "claudeCode", availableVersion: "2.1.0", installedVersion: "2.0.0" },
    });
  });

  it("names every offered provider and version in the notice message", () => {
    const codex = createAgentProviderUpdateToastView("codex", "0.159.0")!;
    const claude = createAgentProviderUpdateToastView("claudeCode", "2.1.284")!;
    expect(agentProviderUpdateNoticeMessage({ kind: "available", view: codex })).toBe(
      "Update available: Codex v0.159.0",
    );
    expect(
      agentProviderUpdateNoticeMessage({ kind: "availableMany", views: [codex, claude] }),
    ).toBe("2 provider updates: Codex v0.159.0, Claude Code v2.1.284");
    expect(
      agentProviderUpdateNoticeMessage({ kind: "updating", provider: "codex", operationId: "1" }),
    ).toBe("Updating provider");
  });

  it("formats the version transition with one consistent v prefix", () => {
    expect(
      agentProviderUpdateVersionTransition(
        createAgentProviderUpdateToastView("codex", "0.159.0", undefined, "0.157.1")!,
      ),
    ).toEqual({ from: "v0.157.1", to: "v0.159.0" });
    expect(
      agentProviderUpdateVersionTransition(createAgentProviderUpdateToastView("codex", "0.159.0")!),
    ).toEqual({ from: null, to: "v0.159.0" });
  });

  it("presents an unknown installed version without inventing one", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
        codex: { health: { ...CODEX_UPDATE, installedVersion: null } },
      }),
    );

    expect(presentation).toEqual({
      kind: "available",
      view: { provider: "codex", availableVersion: "0.153.4" },
    });
  });

  it("merges a manual update as a marked row next to a one-click update", () => {
    const presentation = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateAvailable", provider: "codex", version: "0.153.4" },
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

    expect(presentation).toEqual({
      kind: "availableMany",
      views: [
        { provider: "codex", availableVersion: "0.153.4", installedVersion: "0.152.0" },
        {
          provider: "claudeCode",
          availableVersion: "2.1.0",
          installedVersion: "2.0.0",
          manual: true,
        },
      ],
    });
  });

  it("does not merge dismissed, busy, or unregistered updates", () => {
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

    const manualSelf = presentAgentProviderUpdateToast(
      source({
        toast: { ...codexToast, manual: true },
        codex: {
          health: {
            ...CODEX_UPDATE,
            update: {
              kind: "manualUpdateAvailable",
              installedVersion: "0.152.0",
              availableVersion: "0.153.4",
            },
          },
        },
      }),
    );
    expect(manualSelf).toEqual({
      kind: "available",
      view: {
        provider: "codex",
        availableVersion: "0.153.4",
        installedVersion: "0.152.0",
        manual: true,
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
      offeredVersion: "0.153.4",
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
      offeredVersion: null,
      retryVersion: null,
    });
  });

  it("reports the version the failed attempt used while retry follows the newer offer", () => {
    const failed = presentAgentProviderUpdateToast(
      source({
        toast: { kind: "updateFailed", provider: "codex" },
        codex: {
          health: {
            ...CODEX_UPDATE,
            update: {
              kind: "available",
              installedVersion: "0.152.0",
              availableVersion: "0.154.0",
              installer: { kind: "npm", packageName: "@openai/codex" },
            },
          },
          updateState: {
            kind: "failed",
            reason: "timedOut",
            attemptedVersion: "0.153.4",
            outputTail: "",
            outputTruncated: false,
          },
        },
      }),
    );

    expect(failed).toEqual({
      kind: "failed",
      provider: "codex",
      reason: "timedOut",
      outputTail: "",
      installedVersion: "0.152.0",
      offeredVersion: "0.153.4",
      retryVersion: "0.154.0",
    });
  });

  it("presents an already-current outcome with the offered version it did not apply", () => {
    expect(
      presentAgentProviderUpdateToast(
        source({
          toast: { kind: "updateAlreadyCurrent", provider: "claudeCode", version: "2.1.261" },
          claudeCode: {
            updateState: {
              kind: "alreadyCurrent",
              installedVersion: "2.1.261",
              offeredVersion: "2.1.263",
              outputTail: "",
              outputTruncated: false,
            },
          },
        }),
      ),
    ).toEqual({
      kind: "alreadyCurrent",
      provider: "claudeCode",
      installedVersion: "2.1.261",
      offeredVersion: "2.1.263",
    });
    expect(
      presentAgentProviderUpdateToast(
        source({
          toast: { kind: "updateAlreadyCurrent", provider: "claudeCode", version: "2.1.261" },
        }),
      ),
    ).toEqual({
      kind: "alreadyCurrent",
      provider: "claudeCode",
      installedVersion: "2.1.261",
      offeredVersion: null,
    });
    expect(
      presentAgentProviderUpdateToast(
        source({
          toast: { kind: "updateAlreadyCurrent", provider: "claudeCode", version: "not a version" },
        }),
      ),
    ).toBeNull();
    expect(
      agentProviderUpdateToastTitle({
        kind: "alreadyCurrent",
        provider: "claudeCode",
        installedVersion: createAgentProviderUpdateToastView("claudeCode", "2.1.261")!
          .availableVersion,
        offeredVersion: createAgentProviderUpdateToastView("claudeCode", "2.1.263")!
          .availableVersion,
      }),
    ).toBe("Claude Code did not change version");
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

  it("builds a view only when the installed version is known to be older or unknown", () => {
    expect(createAgentProviderUpdateToastView("codex", "0.153.4", undefined, "0.152.0")).toEqual({
      provider: "codex",
      availableVersion: "0.153.4",
      installedVersion: "0.152.0",
    });
    expect(createAgentProviderUpdateToastView("codex", "0.153.4", undefined, null)).toEqual({
      provider: "codex",
      availableVersion: "0.153.4",
    });
    expect(createAgentProviderUpdateToastView("codex", "0.153.4", undefined, "0.153.4")).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", "0.153.4", undefined, "0.154.0")).toBeNull();
    expect(
      createAgentProviderUpdateToastView("codex", "0.153.4", undefined, " 0.152.0 "),
    ).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", "0.153.4", undefined, "latest")).toBeNull();
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
        offeredVersion: null,
        retryVersion: null,
      }),
      agentProviderUpdateToastGroupKey({
        kind: "alreadyCurrent",
        provider: "codex",
        installedVersion: view.availableVersion,
        offeredVersion: null,
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

  it("derives sentence-cased titles for every presentation", () => {
    const view = createAgentProviderUpdateToastView("codex", "0.153.4")!;
    expect(agentProviderUpdateToastTitle({ kind: "available", view })).toBe("Update available");
    expect(agentProviderUpdateToastTitle({ kind: "availableMany", views: [view, view] })).toBe(
      "2 provider updates",
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

  it("translates failure reasons into bounded copy", () => {
    expect(agentProviderUpdateFailureSentence(null)).toBe("Check provider settings for details.");
    expect(agentProviderUpdateFailureSentence("exited")).toBe(
      "The installer exited with an error.",
    );
    expect(agentProviderUpdateFailureSentence("versionMismatch")).toContain("does not match");
    expect(agentProviderUpdateFailureSentence("operationSuperseded")).toBe(
      "Another provider update replaced this one.",
    );
    expect(agentProviderUpdateFailureSentence("authorityChanged")).toBe(
      "Provider settings changed while the update was starting.",
    );
    expect(agentProviderUpdateFailureSentence("executableChanged")).toBe(
      "The provider executable changed while the update was starting.",
    );
    expect(agentProviderUpdateFailureSentence("installerUnsupported")).toBe(
      "The detected installer cannot run this update.",
    );
    for (const reason of [
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
      null,
    ] as const) {
      expect(agentProviderUpdateFailureSentence(reason)).not.toContain("provider policy");
    }
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
