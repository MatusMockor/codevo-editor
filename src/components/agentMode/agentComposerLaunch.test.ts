import { describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../../domain/claudeModelCatalog";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  codexCatalogDefault,
  parseCodexModelCatalog,
} from "../../domain/codexModelCatalog";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  availableNewThreadDefaults,
  defaultAgentComposerLaunch,
  launchScopeExecutionTarget,
  newThreadComposerLaunch,
  providerSwitchComposerLaunch,
  resolveComposerLaunch,
  type LaunchScope,
} from "./agentComposerLaunch";
import { agentLaunchForDispatch, agentModelRows } from "./agentLaunchPresentation";
import { codexUnavailableModelNotice } from "./codexLaunchPresentation";

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];
const ROOT = "/workspace/app";
const DRAFT: LaunchScope = { key: `root:${ROOT}`, rootKey: ROOT, seed: null };

const CONFIGURED: AgentNewThreadDefaults = {
  source: "defaults",
  claudeCode: { model: "claude-opus-5", effort: "max" },
  codex: { model: "gpt-6-astra", effort: "xhigh" },
};
const CONFIGURED_CLAUDE: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "claude-opus-5",
  mode: "bypassPermissions",
  effort: "max",
  context: "1m",
  fastMode: false,
  thinkingMode: false,
};
const CONFIGURED_CODEX: AgentLaunchOptions = {
  provider: "codex",
  model: "gpt-6-astra",
  mode: "dangerFullAccess",
  effort: "xhigh",
};
const CONFIGURED_LAUNCH: Readonly<Record<AgentCliKind, AgentLaunchOptions>> = {
  claudeCode: CONFIGURED_CLAUDE,
  codex: CONFIGURED_CODEX,
};
const REMEMBERED: Readonly<Record<AgentCliKind, AgentLaunchOptions>> = {
  claudeCode: {
    provider: "claudeCode",
    model: "claude-sonnet-5",
    mode: "plan",
    effort: "low",
    context: "200k",
  },
  codex: { provider: "codex", model: "gpt-6-luna", mode: "workspaceWrite", effort: "low" },
};
const SEEDED: Readonly<Record<AgentCliKind, AgentLaunchOptions>> = {
  claudeCode: {
    provider: "claudeCode",
    model: "claude-fable-5-1",
    mode: "acceptEdits",
    effort: "xhigh",
    context: "1m",
  },
  codex: { provider: "codex", model: "gpt-6-sol", mode: "readOnly", effort: "medium" },
};
const CHOSEN: Readonly<Record<AgentCliKind, AgentLaunchOptions>> = {
  claudeCode: {
    provider: "claudeCode",
    model: "claude-opus-5-5",
    mode: "auto",
    effort: "medium",
    context: "1m",
  },
  codex: { provider: "codex", model: "gpt-5.6-sol", mode: "auto", effort: "high" },
};

function withSource(source: AgentNewThreadDefaults["source"]): AgentNewThreadDefaults {
  return { ...CONFIGURED, source };
}

function otherProvider(provider: AgentCliKind): AgentCliKind {
  return provider === "claudeCode" ? "codex" : "claudeCode";
}

function threadScope(seed: AgentLaunchOptions | null): LaunchScope {
  return { key: "thread:agt-1", rootKey: ROOT, seed };
}

const liveCodexModel = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  label: id.toUpperCase(),
  description: `${id} description.`,
  status: "current",
  isDefault: false,
  efforts: ["low", "medium", "high"],
  defaultEffort: "medium",
  upgradeTo: null,
  ...patch,
});

const LIVE_CODEX = parseCodexModelCatalog({
  version: 1,
  source: "live",
  revision: 4,
  models: [
    liveCodexModel("gpt-7-nova", {
      isDefault: true,
      efforts: ["low", "ultra"],
      defaultEffort: "low",
    }),
    liveCodexModel("gpt-6-astra"),
  ],
});

describe("newThreadComposerLaunch", () => {
  it.each(PROVIDERS)("keeps the built-in %s launch for unconfigured defaults", (provider) => {
    expect(newThreadComposerLaunch(provider, defaultAgentNewThreadDefaults())).toEqual(
      defaultAgentComposerLaunch(provider),
    );
  });

  it.each(PROVIDERS)("takes only the model and effort of %s from the settings", (provider) => {
    expect(newThreadComposerLaunch(provider, CONFIGURED)).toEqual(CONFIGURED_LAUNCH[provider]);
  });

  it("omits the Codex effort when the configured effort is the Codex default", () => {
    const launch = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "gpt-6-astra", effort: "default" },
    });

    expect(launch).toEqual({ provider: "codex", model: "gpt-6-astra", mode: "dangerFullAccess" });
    expect("effort" in launch).toBe(false);
  });

  it("carries an explicit Codex effort for the automatic Codex model", () => {
    expect(
      newThreadComposerLaunch("codex", {
        ...CONFIGURED,
        codex: { model: "default", effort: "high" },
      }),
    ).toEqual({ provider: "codex", model: "default", mode: "dangerFullAccess", effort: "high" });
  });

  it("normalizes a Claude effort like any stored launch", () => {
    expect(
      newThreadComposerLaunch("claudeCode", {
        ...CONFIGURED,
        claudeCode: { model: "claude-opus-5", effort: "default" },
      }),
    ).toEqual({ ...CONFIGURED_CLAUDE, effort: "high" });
    expect(
      newThreadComposerLaunch("claudeCode", {
        ...CONFIGURED,
        claudeCode: { model: "claude-haiku-4-5", effort: "max" },
      }),
    ).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-haiku-4-5", effort: "default" });
  });
});

describe("resolveComposerLaunch", () => {
  describe.each(PROVIDERS)("for %s", (provider) => {
    const configured = CONFIGURED_LAUNCH[provider];
    const remembered = REMEMBERED[provider];
    const seeded = SEEDED[provider];
    const chosen = CHOSEN[provider];
    const other = otherProvider(provider);

    it.each(["defaults", "lastUsed"] as const)(
      "uses the configured default without a launch scope when the source is %s",
      (source) => {
        const lastUsedLaunch = vi.fn(() => remembered);

        expect(
          resolveComposerLaunch(
            { key: DRAFT.key, launch: chosen },
            null,
            provider,
            lastUsedLaunch,
            withSource(source),
          ),
        ).toEqual(configured);
        expect(lastUsedLaunch).not.toHaveBeenCalled();
      },
    );

    it.each(["defaults", "lastUsed"] as const)(
      "prefers the explicit choice of the scope when the source is %s",
      (source) => {
        expect(
          resolveComposerLaunch(
            { key: "thread:agt-1", launch: chosen },
            threadScope(seeded),
            provider,
            () => remembered,
            withSource(source),
          ),
        ).toEqual(chosen);
      },
    );

    it("ignores a choice made in another scope", () => {
      expect(
        resolveComposerLaunch(
          { key: "root:/workspace/other", launch: chosen },
          DRAFT,
          provider,
          () => null,
          withSource("defaults"),
        ),
      ).toEqual(configured);
    });

    it("ignores a choice made for the other provider", () => {
      expect(
        resolveComposerLaunch(
          { key: DRAFT.key, launch: CHOSEN[other] },
          DRAFT,
          provider,
          () => null,
          withSource("defaults"),
        ),
      ).toEqual(configured);
    });

    it.each(["defaults", "lastUsed"] as const)(
      "keeps the latest prompted launch of a thread when the source is %s",
      (source) => {
        expect(
          resolveComposerLaunch(
            null,
            threadScope(seeded),
            provider,
            () => remembered,
            withSource(source),
          ),
        ).toEqual(seeded);
      },
    );

    it("skips a thread seed that belongs to the other provider", () => {
      const scope = threadScope(SEEDED[other]);

      expect(
        resolveComposerLaunch(null, scope, provider, () => remembered, withSource("defaults")),
      ).toEqual(configured);
      expect(
        resolveComposerLaunch(null, scope, provider, () => remembered, withSource("lastUsed")),
      ).toEqual(remembered);
    });

    it("starts from the last used launch of the project only when the source is lastUsed", () => {
      const lastUsedLaunch = vi.fn((projectRootKey: string) =>
        projectRootKey === ROOT ? remembered : null,
      );

      expect(
        resolveComposerLaunch(null, DRAFT, provider, lastUsedLaunch, withSource("lastUsed")),
      ).toEqual(remembered);
      expect(lastUsedLaunch).toHaveBeenCalledWith(ROOT);
    });

    it("never reads the last used launch when the source is defaults", () => {
      const lastUsedLaunch = vi.fn(() => remembered);

      expect(
        resolveComposerLaunch(null, DRAFT, provider, lastUsedLaunch, withSource("defaults")),
      ).toEqual(configured);
      expect(lastUsedLaunch).not.toHaveBeenCalled();
    });

    it("falls back to the configured default when the last used launch is another provider's", () => {
      expect(
        resolveComposerLaunch(null, DRAFT, provider, () => REMEMBERED[other], {
          ...CONFIGURED,
          source: "lastUsed",
        }),
      ).toEqual(configured);
    });

    it("falls back to the configured default when the project has no last used launch", () => {
      expect(
        resolveComposerLaunch(null, DRAFT, provider, () => null, withSource("lastUsed")),
      ).toEqual(configured);
    });

    it("does not look up a last used launch for a draft without a project", () => {
      const lastUsedLaunch = vi.fn(() => remembered);

      expect(
        resolveComposerLaunch(
          null,
          { key: "draft", rootKey: null, seed: null },
          provider,
          lastUsedLaunch,
          withSource("lastUsed"),
        ),
      ).toEqual(configured);
      expect(lastUsedLaunch).not.toHaveBeenCalled();
    });

    it("matches the previous behavior for unconfigured defaults that follow the last used launch", () => {
      const unconfigured: AgentNewThreadDefaults = {
        ...defaultAgentNewThreadDefaults(),
        source: "lastUsed",
      };

      expect(resolveComposerLaunch(null, DRAFT, provider, () => remembered, unconfigured)).toEqual(
        remembered,
      );
      expect(resolveComposerLaunch(null, DRAFT, provider, () => null, unconfigured)).toEqual(
        defaultAgentComposerLaunch(provider),
      );
      expect(resolveComposerLaunch(null, null, provider, () => remembered, unconfigured)).toEqual(
        defaultAgentComposerLaunch(provider),
      );
    });
  });

  it("migrates a legacy last used launch before it reaches the composer", () => {
    expect(
      resolveComposerLaunch(
        null,
        DRAFT,
        "claudeCode",
        () => ({ provider: "claudeCode", model: "default", mode: "default", effort: "default" }),
        withSource("lastUsed"),
      ),
    ).toEqual({
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    });
  });
});

describe("availableNewThreadDefaults", () => {
  function claudeDefaults(model: AgentNewThreadDefaults["claudeCode"]["model"]) {
    return { ...CONFIGURED, claudeCode: { model, effort: "max" } } as const;
  }

  it("keeps the same value while the Claude catalog offers the configured choice", () => {
    const automatic = defaultAgentNewThreadDefaults();

    expect(availableNewThreadDefaults(CONFIGURED, BUNDLED_CLAUDE_MODEL_MANIFEST)).toBe(CONFIGURED);
    expect(availableNewThreadDefaults(automatic, BUNDLED_CLAUDE_MODEL_MANIFEST)).toBe(automatic);
    expect(availableNewThreadDefaults(automatic, BUNDLED_CLAUDE_MODEL_MANIFEST, "1.0.0")).toBe(
      automatic,
    );
  });

  it.each([
    ["opus", "claude-opus-5"],
    ["sonnet", "claude-sonnet-5"],
    ["claude-opus-4-6-20251117", "claude-opus-4-6"],
  ] as const)("canonicalizes the configured %s to the catalog choice %s", (stored, choice) => {
    expect(
      availableNewThreadDefaults(claudeDefaults(stored), BUNDLED_CLAUDE_MODEL_MANIFEST),
    ).toEqual(claudeDefaults(choice));
  });

  it("replaces a Claude model the catalog no longer offers with the automatic model", () => {
    const stale: AgentNewThreadDefaults = {
      source: "lastUsed",
      claudeCode: { model: "claude-retired-9", effort: "max" },
      codex: { model: "gpt-retired-9", effort: "ultra" },
    };

    expect(availableNewThreadDefaults(stale, BUNDLED_CLAUDE_MODEL_MANIFEST)).toEqual({
      source: "lastUsed",
      claudeCode: { model: "default", effort: "max" },
      codex: { model: "gpt-retired-9", effort: "ultra" },
    });
  });

  it("replaces a Claude model the installed Claude CLI is too old for", () => {
    const configured = claudeDefaults("claude-sonnet-5-5");

    expect(
      availableNewThreadDefaults(configured, BUNDLED_CLAUDE_MODEL_MANIFEST, "2.1.283"),
    ).toEqual(claudeDefaults("default"));
    expect(
      availableNewThreadDefaults(claudeDefaults("opus"), BUNDLED_CLAUDE_MODEL_MANIFEST, "2.1.200"),
    ).toEqual(claudeDefaults("default"));
  });

  it("keeps a Claude model the installed Claude CLI supports", () => {
    const configured = claudeDefaults("claude-sonnet-5-5");

    expect(availableNewThreadDefaults(configured, BUNDLED_CLAUDE_MODEL_MANIFEST, "2.1.284")).toBe(
      configured,
    );
    expect(
      availableNewThreadDefaults(claudeDefaults("opus"), BUNDLED_CLAUDE_MODEL_MANIFEST, "2.1.219"),
    ).toEqual(claudeDefaults("claude-opus-5"));
  });

  it("keeps a Claude model while the installed Claude CLI version is unknown", () => {
    const configured = claudeDefaults("claude-sonnet-5-5");

    expect(availableNewThreadDefaults(configured, BUNDLED_CLAUDE_MODEL_MANIFEST, null)).toBe(
      configured,
    );
    expect(availableNewThreadDefaults(configured, BUNDLED_CLAUDE_MODEL_MANIFEST)).toBe(configured);
  });

  it.each([null, "2.1.100", "2.1.219", "2.1.283", "2.1.284", "9.0.0", "not-a-version"])(
    "offers exactly the models the picker lists for Claude CLI %s",
    (version) => {
      const listed = agentModelRows("claudeCode", null, version, BUNDLED_CLAUDE_MODEL_MANIFEST).map(
        (row) => row.value,
      );
      const kept = BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode
        .map((entry) => entry.choice)
        .filter(
          (choice) =>
            availableNewThreadDefaults(
              claudeDefaults(choice),
              BUNDLED_CLAUDE_MODEL_MANIFEST,
              version,
            ).claudeCode.model === choice,
        );

      expect(kept).toEqual(listed);
    },
  );
});

describe("launchScopeExecutionTarget", () => {
  it("treats only a remote project scope as a server draft", () => {
    expect(launchScopeExecutionTarget(DRAFT)).toBe("local");
    expect(launchScopeExecutionTarget({ key: "draft", rootKey: null, seed: null })).toBe("local");
    expect(
      launchScopeExecutionTarget({
        key: "root:remote:server:runner:project",
        rootKey: "remote:server:runner:project",
        seed: null,
      }),
    ).toBe("server");
  });
});

describe("providerSwitchComposerLaunch", () => {
  it("keeps the configured effort when the automatic Codex model is picked", () => {
    const configured = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "default", effort: "high" },
    });
    const picked: AgentLaunchOptions = {
      provider: "codex",
      model: codexCatalogDefault(BUNDLED_CODEX_MODEL_CATALOG).id,
      mode: "dangerFullAccess",
    };

    expect(providerSwitchComposerLaunch(configured, picked)).toBe(configured);
  });

  it.each([
    { configuredModel: null, pickedModel: "gpt-7-nova", effort: "ultra" },
    { configuredModel: "gpt-6-astra", pickedModel: "gpt-6-astra", effort: "high" },
  ] as const)(
    "resolves the automatic Codex model against the live catalog and config $configuredModel",
    ({ configuredModel, pickedModel, effort }) => {
      const configured = newThreadComposerLaunch("codex", {
        ...CONFIGURED,
        codex: { model: "default", effort },
      });
      const picked: AgentLaunchOptions = {
        provider: "codex",
        model: pickedModel,
        mode: "dangerFullAccess",
      };

      expect(providerSwitchComposerLaunch(configured, picked, configuredModel, LIVE_CODEX)).toBe(
        configured,
      );
      expect(agentLaunchForDispatch(configured, configuredModel, undefined, LIVE_CODEX)).toEqual({
        ...picked,
        effort,
      });
    },
  );

  it("keeps the reset effort when another model is picked instead of the configured Codex default", () => {
    const configured = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "default", effort: "high" },
    });
    const picked: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-7-nova",
      mode: "dangerFullAccess",
    };

    expect(providerSwitchComposerLaunch(configured, picked, "gpt-6-astra", LIVE_CODEX)).toBe(
      picked,
    );
  });

  it("does not guess the automatic Codex model when the configured runtime model is unknown", () => {
    const configured = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "default", effort: "high" },
    });
    const picked: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-7-nova",
      mode: "dangerFullAccess",
    };

    expect(providerSwitchComposerLaunch(configured, picked, "gpt-unavailable", LIVE_CODEX)).toBe(
      picked,
    );
  });

  it("keeps the configured effort when the picked model is the configured model", () => {
    const picked: AgentLaunchOptions = { ...CONFIGURED_CLAUDE, effort: "high" };

    expect(providerSwitchComposerLaunch(CONFIGURED_CLAUDE, picked)).toBe(CONFIGURED_CLAUDE);
  });

  it.each(["opus", "claude-opus-5-0"] as const)(
    "keeps the configured effort when the configured %s names the picked model",
    (stored) => {
      const configured = newThreadComposerLaunch(
        "claudeCode",
        availableNewThreadDefaults(
          { ...CONFIGURED, claudeCode: { model: stored, effort: "max" } },
          BUNDLED_CLAUDE_MODEL_MANIFEST,
        ),
      );
      const picked: AgentLaunchOptions = { ...CONFIGURED_CLAUDE, effort: "high" };

      expect(providerSwitchComposerLaunch(configured, picked)).toEqual(CONFIGURED_CLAUDE);
    },
  );

  it("lets any other picked model win over the configured default", () => {
    const picked: AgentLaunchOptions = { provider: "codex", model: "gpt-6-luna", mode: "auto" };

    expect(providerSwitchComposerLaunch(CONFIGURED_CODEX, picked)).toBe(picked);
  });
});

describe("stale new-thread defaults", () => {
  it("dispatches the Codex default with a visible note when the configured model disappeared", () => {
    const launch = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "gpt-5.4", effort: "high" },
    });

    expect(launch).toMatchObject({ provider: "codex", model: "gpt-5.4", effort: "high" });
    expect(agentLaunchForDispatch(launch, null, undefined, LIVE_CODEX)).toEqual({
      provider: "codex",
      model: "gpt-7-nova",
      mode: "dangerFullAccess",
    });
    expect(
      launch.provider === "codex" ? codexUnavailableModelNotice(launch, LIVE_CODEX) : null,
    ).toBe(
      "gpt-5.4 is no longer available in Codex. This turn uses your Codex default model instead.",
    );
  });

  it("drops a Codex effort the configured model does not support before dispatch", () => {
    const launch = newThreadComposerLaunch("codex", {
      ...CONFIGURED,
      codex: { model: "gpt-6-astra", effort: "ultra" },
    });

    expect(agentLaunchForDispatch(launch, null, undefined, LIVE_CODEX)).toEqual({
      provider: "codex",
      model: "gpt-6-astra",
      mode: "dangerFullAccess",
    });
  });

  it("dispatches an offered Claude model after a configured Claude model disappeared", () => {
    const stale: AgentNewThreadDefaults = {
      ...CONFIGURED,
      claudeCode: { model: "claude-retired-9", effort: "max" },
    };
    const available = availableNewThreadDefaults(stale, BUNDLED_CLAUDE_MODEL_MANIFEST);
    const dispatched = agentLaunchForDispatch(
      newThreadComposerLaunch("claudeCode", available),
      null,
      BUNDLED_CLAUDE_MODEL_MANIFEST,
    );
    const offered = BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.find(
      (entry) => entry.choice === dispatched.model,
    );

    expect(offered?.isDefault).toBe(true);
    expect(dispatched).toMatchObject({ provider: "claudeCode", effort: "max" });
    expect(
      agentLaunchForDispatch(
        newThreadComposerLaunch("claudeCode", stale),
        null,
        BUNDLED_CLAUDE_MODEL_MANIFEST,
      ).model,
    ).toBe("claude-retired-9");
  });

  it("replaces a Claude effort the configured model does not support before dispatch", () => {
    const launch = newThreadComposerLaunch("claudeCode", {
      ...CONFIGURED,
      claudeCode: { model: "claude-opus-4-5", effort: "ultracode" },
    });

    expect(launch).toMatchObject({ model: "claude-opus-4-5", effort: "ultracode" });
    expect(agentLaunchForDispatch(launch, null, BUNDLED_CLAUDE_MODEL_MANIFEST)).toMatchObject({
      model: "claude-opus-4-5",
      effort: "high",
    });
  });
});
