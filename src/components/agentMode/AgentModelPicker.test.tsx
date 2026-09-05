// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentModelPicker } from "./AgentModelPicker";
import { agentModelRows, type AgentModelChoice } from "./agentLaunchPresentation";
import { agentPlatformModifier } from "./agentSubmitShortcut";

const CLAUDE: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
  effort: "default",
};
const CODEX: AgentLaunchOptions = { provider: "codex", model: "gpt-5.5", mode: "default" };
const ID = "model-picker";

describe("AgentModelPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens a dialog with the provider rail, an autofocused search and the closed model rows", () => {
    render(CLAUDE);

    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger().dataset.value).toBe("claude-sonnet-5");
    expect(trigger().textContent).toBe("Claude Sonnet 5");

    open();

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.id).toBe(`${ID}-dialog`);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search());
    expect(optionValues()).toEqual(["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"]);
    expect(selectedOption()?.dataset.value).toBe("claude-sonnet-5");
    expect(selectedOption()?.parentElement?.classList).toContain(
      "agent-model-picker__row--selected",
    );
    expect(search().getAttribute("aria-activedescendant")).toBe(`${ID}-list-2`);
    expect(
      [...host.querySelectorAll(".agent-model-picker__description")].map((el) => el.textContent),
    ).toEqual(
      agentModelRows("claudeCode")
        .slice(0, 3)
        .map((row) => row.hint),
    );
    expect(
      [...host.querySelectorAll(".agent-model-picker__kbd")].map((el) => el.textContent),
    ).toEqual([1, 2, 3].map((digit) => `${agentPlatformModifier().glyph}${digit}`));
    expect(legacyToggle().textContent).toContain("Legacy models");
    expect(legacyToggle().textContent).toContain("7 models");
  });

  it("marks the current provider active and disables the other one with a truthful reason", () => {
    render(CODEX);
    open();

    const claude = railItem("claudeCode");
    const codex = railItem("codex");
    expect(codex.getAttribute("aria-pressed")).toBe("true");
    expect(codex.getAttribute("aria-disabled")).toBeNull();
    expect(claude.getAttribute("aria-disabled")).toBe("true");
    expect(claude.title).toContain("Start a new thread to switch providers");

    act(() => claude.click());
    expect(optionValues()).toEqual([
      "default",
      "gpt-6-astra",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
    ]);
    expect(selectedOption()?.dataset.value).toBe("gpt-5.5");
  });

  it("filters rows as the query changes and Escape clears the query before closing", () => {
    render(CLAUDE);
    open();

    type("sON");
    expect(optionValues()).toEqual(["claude-sonnet-5", "claude-sonnet-4-6"]);
    expect(search().getAttribute("aria-activedescendant")).toBe(`${ID}-list-0`);

    type("zzz");
    expect(optionValues()).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No models match your search.");

    key("Escape");
    expect(search().value).toBe("");
    expect(optionValues()).toHaveLength(3);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    key("Escape");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("moves the active row with arrow keys and selects it with Enter", () => {
    const onSelect = vi.fn();
    render(CLAUDE, onSelect);
    open();

    key("ArrowUp");
    expect(search().getAttribute("aria-activedescendant")).toBe(`${ID}-list-1`);
    expect(
      host
        .querySelector(".agent-model-picker__row--active [role='option']")
        ?.getAttribute("data-value"),
    ).toBe("claude-opus-5");

    key("Enter");

    expect(onSelect).toHaveBeenCalledWith("claude-opus-5");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("selects the nth visible row with the platform modifier and a digit", () => {
    const onSelect = vi.fn();
    render(CLAUDE, onSelect);
    open();
    type("claude");
    expect(optionValues()).toHaveLength(10);

    key("0", { metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    key("2", { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("claude-opus-5");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stars a model and the favorites filter keeps only starred rows", () => {
    render(CLAUDE);
    open();

    const star = starFor("claude-opus-5");
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.getAttribute("aria-label")).toBe("Add Claude Opus 5 to favorites");
    act(() => star.click());
    expect(starFor("claude-opus-5").getAttribute("aria-pressed")).toBe("true");
    expect(starFor("claude-opus-5").getAttribute("aria-label")).toBe(
      "Remove Claude Opus 5 from favorites",
    );

    act(() => favoritesRail().click());
    expect(favoritesRail().getAttribute("aria-pressed")).toBe("true");
    expect(railItem("claudeCode").getAttribute("aria-pressed")).toBe("false");
    expect(optionValues()).toEqual(["claude-opus-5"]);

    act(() => starFor("claude-opus-5").click());
    expect(optionValues()).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No favorite models yet");

    act(() => railItem("claudeCode").click());
    expect(optionValues()).toHaveLength(3);
  });

  it("closes on an outside pointer press and on a click of the chosen row", () => {
    const onSelect = vi.fn();
    render(CLAUDE, onSelect);
    open();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    open();
    act(() => option("claude-sonnet-5").click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => option("claude-opus-5").click());
    expect(onSelect).toHaveBeenCalledWith("claude-opus-5");
  });

  it("does not open while disabled", () => {
    render(CLAUDE, vi.fn(), true);
    expect(trigger().disabled).toBe(true);
    open();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not open when its provider is disabled", () => {
    render(CLAUDE, vi.fn(), false, management({ claudeCode: false, codex: true }));
    expect(trigger().disabled).toBe(true);
    open();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("omits disabled providers from the model rail", () => {
    render(CLAUDE, vi.fn(), false, management({ claudeCode: true, codex: false }));
    open();
    expect(host.querySelector('[data-provider="claudeCode"]')).not.toBeNull();
    expect(host.querySelector('[data-provider="codex"]')).toBeNull();
  });

  it("switches providers from a new-thread picker and keeps providers locked in a thread", () => {
    const onSelect = vi.fn();
    render(CLAUDE, onSelect, false, null, { claudeCode: true, codex: true }, true);
    open();
    act(() => railItem("codex").click());
    expect(optionValues()).toContain("default");
    act(() => option("default").click());
    expect(onSelect).toHaveBeenCalledWith("default", "codex");
  });

  it("names the CLI-configured default model and removes its duplicate row", () => {
    const configured = management({ claudeCode: true, codex: true });
    render(CLAUDE, vi.fn(), false, {
      ...configured,
      cliDiscovery: {
        ...configured.cliDiscovery,
        claudeCode: {
          kind: "detected",
          path: "/bin/claude",
          version: "2.1.258",
          configuredModel: "claude-fable-5-1[1m]",
        },
      },
    });
    expect(trigger().textContent).toBe("Claude Fable 5.1");
    open();
    expect(optionValues()).toEqual(["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"]);
    expect(selectedOption()?.dataset.value).toBe("claude-fable-5-1");
  });

  it("reveals the seven legacy Claude models without presenting a fake default row", () => {
    render(CLAUDE);
    open();

    act(() => legacyToggle().click());

    expect(optionValues()).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(optionValues()).not.toContain("default");
  });

  it("keeps persisted enablement separate from unavailable registration authority", () => {
    const base = management({ claudeCode: true, codex: true });
    const unavailable: AgentProviderManagementSurface = {
      ...base,
      authority: () => null,
      admissionAuthority: (provider) => ({
        provider,
        revision: 2,
        disposition: { kind: "policyUnavailable", reason: "registrationFailed" },
      }),
    };
    render(CLAUDE, vi.fn(), false, unavailable, { claudeCode: true, codex: true });

    expect(trigger().disabled).toBe(true);
    expect(trigger().title).toBe("Provider policy registration failed");
  });

  function Harness({
    disabled,
    launch,
    onSelect,
    providerEnabled,
    providerManagement,
    providerSwitchable,
  }: {
    readonly launch: AgentLaunchOptions;
    readonly disabled: boolean;
    readonly providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>> | null;
    readonly providerManagement: AgentProviderManagementSurface | null;
    readonly providerSwitchable: boolean;
    onSelect(model: AgentModelChoice, provider?: "claudeCode" | "codex"): void;
  }) {
    const favorites = useAgentModelFavorites();
    const [current] = useState(launch);
    return (
      <AgentModelPicker
        describedBy={null}
        disabled={disabled}
        favorites={favorites}
        id={ID}
        label="Agent model"
        launch={current}
        onSelect={onSelect}
        providerEnabled={providerEnabled}
        providerManagement={providerManagement}
        providerSwitchable={providerSwitchable}
      />
    );
  }

  function render(
    launch: AgentLaunchOptions,
    onSelect: (model: AgentModelChoice, provider?: "claudeCode" | "codex") => void = () =>
      undefined,
    disabled = false,
    providerManagement: AgentProviderManagementSurface | null = null,
    providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>> | null = null,
    providerSwitchable = false,
  ): void {
    act(() =>
      root.render(
        <Harness
          disabled={disabled}
          launch={launch}
          onSelect={onSelect}
          providerEnabled={
            providerEnabled ??
            (providerManagement === null
              ? null
              : {
                  claudeCode:
                    providerManagement.authority("claudeCode")?.preference.enabled ?? false,
                  codex: providerManagement.authority("codex")?.preference.enabled ?? false,
                })
          }
          providerManagement={providerManagement}
          providerSwitchable={providerSwitchable}
        />,
      ),
    );
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button#${ID}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function open(): void {
    act(() => trigger().click());
  }

  function search(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`#${ID}-dialog input`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function type(value: string): void {
    const input = search();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function key(name: string, init: KeyboardEventInit = {}): void {
    act(() => {
      search().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));
    });
  }

  function optionValues(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>(`#${ID}-list [role="option"]`)].map(
      (element) => element.dataset.value ?? "",
    );
  }

  function option(value: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(
      `#${ID}-list [role="option"][data-value="${value}"]`,
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function selectedOption(): HTMLElement | null {
    return host.querySelector<HTMLElement>(`#${ID}-list [role="option"][aria-selected="true"]`);
  }

  function starFor(value: string): HTMLButtonElement {
    const element = option(value).parentElement?.querySelector<HTMLButtonElement>(
      ".agent-model-picker__star",
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function railItem(provider: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(
      `.agent-model-picker__rail-item[data-provider="${provider}"]`,
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function favoritesRail(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(
      '.agent-model-picker__rail-item[aria-label="Favorite models"]',
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function legacyToggle(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-model-picker__legacy");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }
});

function management(
  enabled: Readonly<Record<"claudeCode" | "codex", boolean>>,
): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: enabled.claudeCode ? { kind: "notConfigured" } : { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: enabled.codex ? { kind: "notConfigured" } : { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) =>
      enabled[provider]
        ? {
            provider,
            revision: 1,
            disposition: { kind: "ready" },
            cliPath: `/bin/${provider}`,
            providerGeneration: 1,
          }
        : {
            provider,
            revision: 1,
            disposition: { kind: "disabled" },
          },
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: { ...preferences[provider], enabled: enabled[provider] },
      cliPath: `/bin/${provider}`,
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}

describe("AgentModelPicker search styling contract", () => {
  const css = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");

  it("keeps the search field borderless with only a bottom hairline", () => {
    const search = cssRule(css, ".agent-model-picker__search {");
    expect(search).toContain("border-bottom: 1px solid var(--agent-hairline)");
    expect(search).not.toMatch(/box-shadow/);
    expect(cssRule(css, ".agent-model-picker__search:focus-within {")).toContain(
      "border-bottom-color",
    );
  });

  it("suppresses the global focus ring on the search input", () => {
    const input = cssRule(css, ".agent-model-picker__input {");
    expect(input).toContain("border: none");
    expect(input).toContain("outline: none");
    const focus = cssRule(css, ".agent-model-picker__input:focus-visible {");
    expect(focus).toContain("box-shadow: none");
  });

  it("uses readable typography for model names and descriptions", () => {
    expect(css).toMatch(/\n\.agent-model-picker__label \{[^}]*font-size: 14px/s);
    expect(css).toMatch(
      /\n\.agent-model-picker__description \{[^}]*font-size: var\(--agent-fs-sm\)/s,
    );
  });

  it("uses a full-row T3-style hover and a visible selected state", () => {
    expect(cssRule(css, ".agent-model-picker__row--selected {")).toContain(
      "var(--agent-text-strong) 8%",
    );
    expect(cssRule(css, ".agent-model-picker__row:hover,")).toContain(
      "background: var(--agent-fill)",
    );
  });
});

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart + 1, end);
}
