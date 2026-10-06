// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentNewThreadDefaults } from "../../domain/agentNewThreadDefaults";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  codexCatalogDefault,
  type CodexModelCatalog,
} from "../../domain/codexModelCatalog";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
import { AgentComposer, type AgentComposerSubmission } from "./AgentComposer";
import { agentProjectGroups } from "./agentModePresentation";
import { AgentNewThreadDefaultsProvider } from "./AgentNewThreadDefaultsProvider";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { ClaudeModelCatalogContext } from "./useAgentClaudeModelCatalog";
import { useAgentComposerState } from "./useAgentComposerState";
import { CodexModelCatalogContext } from "./useAgentCodexModelCatalog";

const ENABLED: Readonly<Record<AgentCliKind, boolean>> = { claudeCode: true, codex: true };
const PROJECTS = [projectFixture()];
const CODEX_UNAVAILABLE_NOTE = "is no longer available in Codex";

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

const LIVE_CODEX: CodexModelCatalog = {
  ...BUNDLED_CODEX_MODEL_CATALOG,
  source: "live",
  revision: 1,
  models: BUNDLED_CODEX_MODEL_CATALOG.models.map((model) => ({
    ...model,
    isDefault: model.id === "gpt-6-luna",
  })),
};

interface RenderOptions {
  readonly settings: AgentNewThreadDefaults;
  readonly provider?: AgentCliKind;
  readonly claudeCatalog?: ClaudeModelManifest;
  readonly codexCatalog?: CodexModelCatalog;
  readonly mismatchedLaunch?: AgentLaunchOptions;
  readonly localClaudeCliVersion?: string | null;
  readonly executionServerId?: string | null;
}

describe("composer launch controls with configured new-thread defaults", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useAgentComposerState> | null;
  let onSubmit: ReturnType<typeof vi.fn<(submission: AgentComposerSubmission) => void>>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    state = null;
    onSubmit = vi.fn<(submission: AgentComposerSubmission) => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    provider,
    mismatchedLaunch,
    executionServerId,
  }: {
    readonly provider: AgentCliKind;
    readonly mismatchedLaunch: AgentLaunchOptions | null;
    readonly executionServerId: string | null;
  }) {
    const agents = useMemo(() => threadsSurfaceFixture({ agentCliKind: provider }), [provider]);
    const groups = useMemo(() => agentProjectGroups(PROJECTS, [], []), []);
    const composer = useAgentComposerState({
      agents,
      projects: PROJECTS,
      groups,
      selectedThread: null,
      railScope: null,
      providerEnabled: ENABLED,
      onClearSelectedThread: ignore,
      onThreadStarted: ignore,
    });
    state = composer;
    return (
      <AgentComposer
        {...composer.composerProps}
        executionServerId={executionServerId}
        launch={mismatchedLaunch ?? composer.composerProps.launch}
        prompt="Fix it"
        submitBlocked={false}
        providerEnabled={ENABLED}
        onOpenProviderSettings={ignore}
        onSubmit={onSubmit}
      />
    );
  }

  function render({
    settings,
    provider = "claudeCode",
    claudeCatalog = BUNDLED_CLAUDE_MODEL_MANIFEST,
    codexCatalog = BUNDLED_CODEX_MODEL_CATALOG,
    mismatchedLaunch,
    localClaudeCliVersion = null,
    executionServerId = null,
  }: RenderOptions): void {
    act(() =>
      root.render(
        <ClaudeModelCatalogContext.Provider value={claudeCatalog}>
          <CodexModelCatalogContext.Provider value={codexCatalog}>
            <AgentNewThreadDefaultsProvider
              settings={settings}
              localClaudeCliVersion={localClaudeCliVersion}
            >
              <Harness
                provider={provider}
                mismatchedLaunch={mismatchedLaunch ?? null}
                executionServerId={executionServerId}
              />
            </AgentNewThreadDefaultsProvider>
          </CodexModelCatalogContext.Provider>
        </ClaudeModelCatalogContext.Provider>,
      ),
    );
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function pickModel(provider: AgentCliKind, model: string): void {
    click('[aria-label="Agent model"]');
    click(`[data-provider="${provider}"]`);
    click(`[role="option"][data-value="${model}"]`);
  }

  function composerLaunch(): AgentLaunchOptions | undefined {
    expect(state).not.toBeNull();
    return state?.composerProps.launch;
  }

  function displayedModel(): string | undefined {
    return host.querySelector<HTMLElement>("button#agent-launch-model")?.dataset.value;
  }

  function submittedLaunch(): AgentLaunchOptions | undefined {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    return onSubmit.mock.lastCall?.[0].launch;
  }

  it("picks the other provider's configured default when its configured model is selected", () => {
    render({ settings: CONFIGURED });

    expect(composerLaunch()).toEqual(CONFIGURED_CLAUDE);

    pickModel("codex", "gpt-6-astra");

    expect(composerLaunch()).toEqual(CONFIGURED_CODEX);
    expect(submittedLaunch()).toEqual(CONFIGURED_CODEX);

    pickModel("claudeCode", "claude-opus-5");

    expect(composerLaunch()).toEqual(CONFIGURED_CLAUDE);
  });

  it.each([BUNDLED_CODEX_MODEL_CATALOG, LIVE_CODEX])(
    "keeps High when switching to the concrete Codex default from the $source catalog",
    (codexCatalog) => {
      render({
        settings: { ...CONFIGURED, codex: { model: "default", effort: "high" } },
        codexCatalog,
      });

      const model = codexCatalogDefault(codexCatalog).id;
      pickModel("codex", model);

      expect(composerLaunch()).toEqual({
        provider: "codex",
        model: "default",
        mode: "dangerFullAccess",
        effort: "high",
      });
      expect(host.querySelector('[aria-label="Reasoning effort"]')?.textContent).toBe("High");
      expect(submittedLaunch()).toEqual({
        provider: "codex",
        model,
        mode: "dangerFullAccess",
        effort: "high",
      });
    },
  );

  it("lets an explicitly picked model of the other provider win over its configured default", () => {
    render({ settings: CONFIGURED });

    pickModel("codex", "gpt-6-luna");

    expect(composerLaunch()).toEqual({
      provider: "codex",
      model: "gpt-6-luna",
      mode: "dangerFullAccess",
    });

    pickModel("claudeCode", "claude-sonnet-5");

    expect(composerLaunch()).toEqual({
      ...CONFIGURED_CLAUDE,
      model: "claude-sonnet-5",
      effort: "high",
      context: "200k",
    });
  });

  it("uses the configured default of the composer provider for a launch of another provider", () => {
    render({ settings: CONFIGURED, mismatchedLaunch: CONFIGURED_CODEX });

    expect(displayedModel()).toBe("claude-opus-5");
    expect(submittedLaunch()).toEqual(CONFIGURED_CLAUDE);
  });

  it.each(["opus", "claude-opus-5-0"] as const)(
    "highlights the catalog row and keeps the configured effort for the configured Claude %s",
    (model) => {
      render({
        provider: "codex",
        settings: { ...CONFIGURED, claudeCode: { model, effort: "max" } },
      });

      pickModel("claudeCode", "claude-opus-5");

      expect(composerLaunch()).toEqual(CONFIGURED_CLAUDE);
      expect(displayedModel()).toBe("claude-opus-5");

      click('[aria-label="Agent model"]');

      expect(
        host.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.dataset.value,
      ).toBe("claude-opus-5");
    },
  );

  it("dispatches the automatic Claude model when the local Claude CLI is too old for the configured one", () => {
    const settings: AgentNewThreadDefaults = {
      ...CONFIGURED,
      claudeCode: { model: "claude-sonnet-5-5", effort: "max" },
    };
    render({ settings, localClaudeCliVersion: "2.1.283" });

    expect(displayedModel()).toBe("claude-sonnet-5");
    expect(submittedLaunch()).toMatchObject({ model: "claude-sonnet-5", effort: "max" });

    render({ settings, localClaudeCliVersion: "2.1.284" });

    expect(displayedModel()).toBe("claude-sonnet-5-5");
    expect(submittedLaunch()).toMatchObject({ model: "claude-sonnet-5-5", effort: "max" });

    render({ settings });

    expect(displayedModel()).toBe("claude-sonnet-5-5");
  });

  it("does not gate a server composer on the local Claude CLI version", () => {
    render({
      settings: { ...CONFIGURED, claudeCode: { model: "claude-sonnet-5-5", effort: "max" } },
      localClaudeCliVersion: "2.1.283",
      executionServerId: "server",
      mismatchedLaunch: CONFIGURED_CODEX,
    });

    expect(displayedModel()).toBe("claude-sonnet-5-5");
    expect(submittedLaunch()).toMatchObject({ model: "claude-sonnet-5-5", effort: "max" });
  });

  it("dispatches the Codex default and says so when the configured Codex model disappeared", () => {
    render({
      provider: "codex",
      settings: { ...CONFIGURED, codex: { model: "gpt-5.4", effort: "high" } },
    });

    expect(host.textContent).toContain(
      "gpt-5.4 is no longer available in Codex. This turn uses your Codex default model instead.",
    );
    expect(displayedModel()).toBe("gpt-6.1-sol");
    expect(submittedLaunch()).toEqual({
      provider: "codex",
      model: "gpt-6.1-sol",
      mode: "dangerFullAccess",
    });
  });

  it("drops a configured Codex effort the configured model does not support", () => {
    render({
      provider: "codex",
      settings: { ...CONFIGURED, codex: { model: "gpt-6-luna", effort: "ultra" } },
    });

    expect(host.textContent).not.toContain(CODEX_UNAVAILABLE_NOTE);
    expect(displayedModel()).toBe("gpt-6-luna");
    expect(submittedLaunch()).toEqual({
      provider: "codex",
      model: "gpt-6-luna",
      mode: "dangerFullAccess",
    });
  });

  it("dispatches an offered Claude model when the configured Claude model disappeared", () => {
    render({
      settings: { ...CONFIGURED, claudeCode: { model: "claude-retired-9", effort: "max" } },
    });

    expect(displayedModel()).toBe("claude-sonnet-5");
    expect(submittedLaunch()).toEqual({
      ...CONFIGURED_CLAUDE,
      model: "claude-sonnet-5",
      effort: "max",
    });
  });

  it("follows the live Claude catalog when it stops offering the configured Claude model", () => {
    const withoutOpus: ClaudeModelManifest = {
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      claudeCode: BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.filter(
        (entry) => entry.choice !== "claude-opus-5",
      ),
    };
    render({ settings: CONFIGURED });

    expect(displayedModel()).toBe("claude-opus-5");

    render({ settings: CONFIGURED, claudeCatalog: withoutOpus });

    expect(displayedModel()).toBe("claude-sonnet-5");
    expect(submittedLaunch()).toMatchObject({ provider: "claudeCode", model: "claude-sonnet-5" });
  });

  it("replaces a configured Claude effort the configured model does not support", () => {
    render({
      settings: { ...CONFIGURED, claudeCode: { model: "claude-opus-4-5", effort: "ultracode" } },
    });

    expect(displayedModel()).toBe("claude-opus-4-5");
    expect(submittedLaunch()).toEqual({
      ...CONFIGURED_CLAUDE,
      model: "claude-opus-4-5",
      effort: "high",
      context: undefined,
    });
  });
});

function ignore(): void {
  return undefined;
}
