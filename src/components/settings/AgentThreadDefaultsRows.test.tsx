// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentSettings";
import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
} from "../../domain/settings";
import { ClaudeModelCatalogContext } from "../agentMode/useAgentClaudeModelCatalog";
import { CodexModelCatalogContext } from "../agentMode/useAgentCodexModelCatalog";
import {
  NEW_THREAD_CLAUDE_CATALOG,
  NEW_THREAD_CODEX_CATALOG,
  NEW_THREAD_GATED_CLAUDE_CATALOG,
  newThreadManagementFixture,
  newThreadProviderViewFixture,
} from "./agentNewThreadDefaultsTestSupport";
import { AgentThreadDefaultsRows } from "./AgentThreadDefaultsRows";
import { SettingsTargetContext } from "./settingsTargetContext";
import type { SettingsRowId } from "./settingsRegistry";

interface HarnessOptions {
  readonly appSettings?: AppSettings;
  readonly claudeCatalog?: ClaudeModelManifest;
  readonly management?: AgentProviderManagementSurface;
  readonly targetRowId?: SettingsRowId;
}

const START_ROW = '[data-settings-row="agents.defaultProvider"]';
const SOURCE_ROW = '[data-settings-row="agents.newThreadLaunchSource"]';

describe("AgentThreadDefaultsRows", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onChangeDefaultProvider: Mock<(provider: AgentCliKind) => void>;
  let onChangeNewThreadDefaults: Mock<(defaults: AgentNewThreadDefaults) => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onChangeDefaultProvider = vi.fn<(provider: AgentCliKind) => void>();
    onChangeNewThreadDefaults = vi.fn<(defaults: AgentNewThreadDefaults) => void>();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("offers the providers as a labelled radio group with the stored provider checked", () => {
    render();

    const group = host.querySelector('[role="radiogroup"]');

    expect(textOf(group?.getAttribute("aria-labelledby"))).toBe("Start new threads with");
    expect(textOf(group?.getAttribute("aria-describedby"))).toBe(
      "Choose the provider for new threads, and the model and effort each provider starts with.",
    );
    expect(radios().map((radio) => accessibleName(radio))).toEqual(["Claude Code", "Codex"]);
    expect(radio("Claude Code").getAttribute("aria-checked")).toBe("true");
    expect(radio("Codex").getAttribute("aria-checked")).toBe("false");
    expect(radio("Claude Code").tabIndex).toBe(0);
    expect(radio("Codex").tabIndex).toBe(-1);
    expect(description(radio("Claude Code"))).toBe("Authenticated. New threads start here");
    expect(description(radio("Codex"))).toBe("Authenticated. Used when you switch to Codex");
  });

  it("keeps the model and effort selects outside the radio control", () => {
    render();

    expect(host.querySelectorAll('[role="radio"] select')).toHaveLength(0);
    expect(host.querySelectorAll("label select")).toHaveLength(0);
    expect(select("Claude Code model").closest('[role="radiogroup"]')).not.toBeNull();
    expect(select("Claude Code effort").disabled).toBe(false);
    expect(select("Codex model").value).toBe("default");
    expect(select("Codex effort").value).toBe("default");
  });

  it("selects a provider when its tile header is clicked", () => {
    render();

    act(() => radio("Codex").click());

    expect(onChangeDefaultProvider.mock.calls).toEqual([["codex"]]);
    expect(radio("Codex").getAttribute("aria-checked")).toBe("true");
    expect(radio("Claude Code").getAttribute("aria-checked")).toBe("false");
    expect(tile("Codex").textContent).toContain("New threads start here");
    expect(tile("Claude Code").textContent).toContain("Used when you switch to Claude Code");
  });

  it("does not write again when the checked tile is clicked", () => {
    render();

    act(() => radio("Claude Code").click());

    expect(onChangeDefaultProvider).not.toHaveBeenCalled();
  });

  it("selects a provider from the tile surface but not from its selects", () => {
    render();

    click(select("Codex model"));

    expect(onChangeDefaultProvider).not.toHaveBeenCalled();

    click(tile("Codex").querySelector(".settings-thread-tile__label"));

    expect(onChangeDefaultProvider.mock.calls).toEqual([["codex"]]);
  });

  it("moves the selection and the focus with the arrow keys", () => {
    render();
    act(() => radio("Claude Code").focus());

    const moved = press(radio("Claude Code"), "ArrowRight");

    expect(moved.defaultPrevented).toBe(true);
    expect(onChangeDefaultProvider.mock.calls).toEqual([["codex"]]);
    expect(document.activeElement).toBe(radio("Codex"));
    expect(radio("Codex").tabIndex).toBe(0);
    expect(radio("Claude Code").tabIndex).toBe(-1);

    press(radio("Codex"), "ArrowUp");

    expect(onChangeDefaultProvider.mock.calls).toEqual([["codex"], ["claudeCode"]]);
    expect(document.activeElement).toBe(radio("Claude Code"));
  });

  it("leaves other keys on the radio alone", () => {
    render();

    const typed = press(radio("Claude Code"), "a");

    expect(typed.defaultPrevented).toBe(false);
    expect(onChangeDefaultProvider).not.toHaveBeenCalled();
  });

  it("refuses to select a disabled provider by mouse or keyboard", () => {
    render({ appSettings: settingsWith({ disabled: ["codex"] }) });

    expect(radio("Codex").getAttribute("aria-disabled")).toBe("true");
    expect(radio("Codex").tabIndex).toBe(-1);
    expect(radio("Claude Code").hasAttribute("aria-disabled")).toBe(false);
    expect(description(radio("Codex"))).toBe(
      "Provider disabled. Enable Codex under Providers to use it",
    );
    expect(select("Codex model").disabled).toBe(true);
    expect(select("Codex effort").disabled).toBe(true);
    expect(tile("Codex").getAttribute("data-state")).toBe("disabled");

    act(() => radio("Codex").click());
    click(tile("Codex").querySelector(".settings-thread-tile__label"));
    press(radio("Claude Code"), "ArrowRight");

    expect(onChangeDefaultProvider).not.toHaveBeenCalled();
    expect(radio("Claude Code").getAttribute("aria-checked")).toBe("true");
  });

  it("checks no tile and says so while the stored provider is disabled", () => {
    render({ appSettings: settingsWith({ agentCliKind: "codex", disabled: ["codex"] }) });

    expect(radios().map((candidate) => candidate.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
    ]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Codex is the default provider but it is disabled. Choose another provider or enable Codex under Providers.",
    );
    expect(radio("Claude Code").tabIndex).toBe(0);
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).not.toContain("New threads start here");

    act(() => radio("Claude Code").click());

    expect(onChangeDefaultProvider.mock.calls).toEqual([["claudeCode"]]);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector('[role="img"]')).not.toBeNull();
  });

  it("says that no provider is enabled and hides the preview", () => {
    render({ appSettings: settingsWith({ disabled: ["claudeCode", "codex"] }) });

    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "No provider is enabled. Enable one under Providers to start new threads.",
    );
    expect(radios().map((candidate) => candidate.getAttribute("aria-disabled"))).toEqual([
      "true",
      "true",
    ]);
    expect(radios().map((candidate) => candidate.tabIndex)).toEqual([-1, -1]);
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).not.toContain("A new thread opens like this");
  });

  it("reuses the provider card status for each tile", () => {
    render({
      management: newThreadManagementFixture({
        codex: newThreadProviderViewFixture({
          health: {
            kind: "ready",
            installedVersion: "1.0.0",
            auth: { kind: "signedOut" },
            update: { kind: "current", installedVersion: "1.0.0" },
            checkedAtEpochMs: 1,
          },
        }),
      }),
    });

    expect(tile("Codex").textContent).toContain(
      "Not authenticated - Sign in via the CLI to authenticate again.",
    );
    expect(tile("Codex").querySelector(".settings-provider__dot")?.getAttribute("data-tone")).toBe(
      "warning",
    );
    expect(tile("Claude Code").textContent).toContain("Authenticated.");
  });

  it("lists the provider default first and writes the chosen model", () => {
    render();

    expect(optionLabels(select("Claude Code model"))).toEqual([
      "CLI default (Claude Sonnet 5)",
      "Claude Opus 5.5",
      "Claude Sonnet 5",
    ]);

    setSelect(select("Claude Code model"), "claude-opus-5-5");

    expect(onChangeNewThreadDefaults.mock.calls).toEqual([
      [
        {
          source: "defaults",
          claudeCode: { model: "claude-opus-5-5", effort: "high" },
          codex: { model: "default", effort: "default" },
        },
      ],
    ]);
    expect(select("Claude Code model").value).toBe("claude-opus-5-5");
    expect(optionValues(select("Claude Code effort"))).toContain("ultracode");
  });

  it("resets an effort the newly chosen model does not support in the same write", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          source: "lastUsed",
          claudeCode: { model: "claude-opus-5-5", effort: "ultracode" },
          codex: { model: "gpt-6.1-sol", effort: "ultra" },
        },
      }),
    });

    setSelect(select("Claude Code model"), "claude-sonnet-5");
    setSelect(select("Codex model"), "gpt-6-luna");

    expect(onChangeNewThreadDefaults.mock.calls).toEqual([
      [
        {
          source: "lastUsed",
          claudeCode: { model: "claude-sonnet-5", effort: "default" },
          codex: { model: "gpt-6.1-sol", effort: "ultra" },
        },
      ],
      [
        {
          source: "lastUsed",
          claudeCode: { model: "claude-sonnet-5", effort: "default" },
          codex: { model: "gpt-6-luna", effort: "default" },
        },
      ],
    ]);
    expect(select("Claude Code effort").value).toBe("high");
    expect(optionValues(select("Claude Code effort"))).not.toContain("default");
    expect(select("Codex effort").value).toBe("default");
    expect(optionValues(select("Codex effort"))).toEqual(["default", "low", "medium", "high"]);
    expect(previewChips()).toEqual(["Claude Code", "Claude Sonnet 5", "High", "1M context"]);
  });

  it("offers Claude only real efforts and shows a stored default as the resolved effort", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          claudeCode: { model: "claude-opus-5-5", effort: "default" },
        },
      }),
    });

    expect(optionLabels(select("Claude Code effort"))).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
      "Ultracode",
      "Ultrathink",
    ]);
    expect(select("Claude Code effort").value).toBe("high");
    expect(previewChips()).toEqual(["Claude Code", "Claude Opus 5.5", "High", "1M context"]);
    expect(optionLabels(select("Codex effort"))[0]).toBe("Model default");
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("shows the model default effort for an unsupported stored Claude effort without a write", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          claudeCode: { model: "claude-opus-4-5", effort: "xhigh" },
        },
      }),
    });

    expect(select("Claude Code effort").value).toBe("medium");
    expect(optionValues(select("Claude Code effort"))).toEqual(["low", "medium", "high", "max"]);
    expect(previewChips()).toEqual(["Claude Code", "Claude Opus 4.5", "Medium"]);
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("disables the Claude effort select on the model default when the model has no efforts", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          claudeCode: { model: "claude-haiku-4-5", effort: "default" },
        },
      }),
    });

    expect(select("Claude Code effort").disabled).toBe(true);
    expect(optionLabels(select("Claude Code effort"))).toEqual(["Model default"]);
    expect(select("Claude Code effort").value).toBe("default");
    expect(previewChips()).toEqual(["Claude Code", "Claude Haiku 4.5"]);
  });

  it("previews the composer fallback while the stored Claude model is unavailable", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          claudeCode: { model: "claude-retired-1", effort: "max" },
        },
      }),
    });

    const model = select("Claude Code model");
    const stored = [...model.options].find((option) => option.value === "claude-retired-1");

    expect(model.value).toBe("claude-retired-1");
    expect(stored?.textContent).toBe("claude-retired-1 (unavailable)");
    expect(stored?.disabled).toBe(true);
    expect(previewChips()).toEqual(["Claude Code", "Claude Sonnet 5", "Max", "1M context"]);
    expect(select("Claude Code effort").value).toBe("max");
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("writes the chosen effort for one provider only", () => {
    render();

    expect(optionLabels(select("Codex effort"))).toEqual([
      "Model default",
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
      "Ultra",
    ]);

    setSelect(select("Codex effort"), "xhigh");

    expect(onChangeNewThreadDefaults.mock.calls).toEqual([
      [
        {
          source: "defaults",
          claudeCode: { model: "default", effort: "high" },
          codex: { model: "default", effort: "xhigh" },
        },
      ],
    ]);
    expect(select("Codex effort").value).toBe("xhigh");
    expect(select("Claude Code effort").value).toBe("high");
  });

  it("keeps an unavailable stored model selected instead of switching it", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          codex: { model: "gpt-retired", effort: "default" },
        },
      }),
    });

    const model = select("Codex model");
    const stored = [...model.options].find((option) => option.value === "gpt-retired");

    expect(model.value).toBe("gpt-retired");
    expect(stored?.textContent).toBe("gpt-retired (unavailable)");
    expect(stored?.disabled).toBe(true);
    expect(select("Codex effort").disabled).toBe(true);
    expect(optionLabels(select("Codex effort"))).toEqual(["Model default"]);
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();

    act(() => radio("Codex").click());

    expect(previewChips()).toEqual(["Codex", "GPT-6.1-Sol"]);
    expect(previewSummary()).toBe("New thread preview: Codex, GPT-6.1-Sol");
    expect(select("Codex model").value).toBe("gpt-retired");
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("marks a model the installed Claude CLI is too old for and previews the fallback", () => {
    render({
      appSettings: settingsWith({ defaults: gatedOpusDefaults() }),
      claudeCatalog: NEW_THREAD_GATED_CLAUDE_CATALOG,
      management: managementWithClaudeVersion("1.9.0"),
    });

    const model = select("Claude Code model");
    const stored = [...model.options].find((option) => option.value === "claude-opus-5-5");

    expect(model.value).toBe("claude-opus-5-5");
    expect(stored?.textContent).toBe("Claude Opus 5.5 (unavailable)");
    expect(stored?.disabled).toBe(true);
    expect(previewChips()).toEqual(["Claude Code", "Claude Sonnet 5", "Max", "1M context"]);
    expect(select("Claude Code effort").value).toBe("max");
    expect(optionValues(select("Claude Code effort"))).not.toContain("ultracode");
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("keeps a version gated model when the installed Claude CLI is new enough", () => {
    render({
      appSettings: settingsWith({ defaults: gatedOpusDefaults() }),
      claudeCatalog: NEW_THREAD_GATED_CLAUDE_CATALOG,
      management: managementWithClaudeVersion("2.4.1"),
    });

    expect(select("Claude Code model").value).toBe("claude-opus-5-5");
    expect(optionLabels(select("Claude Code model"))).toEqual([
      "CLI default (Claude Sonnet 5)",
      "Claude Opus 5.5",
      "Claude Sonnet 5",
    ]);
    expect(previewChips()).toEqual(["Claude Code", "Claude Opus 5.5", "Max", "1M context"]);
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("keeps a version gated model while the Claude CLI is not detected", () => {
    render({
      appSettings: settingsWith({ defaults: gatedOpusDefaults() }),
      claudeCatalog: NEW_THREAD_GATED_CLAUDE_CATALOG,
    });

    expect(select("Claude Code model").value).toBe("claude-opus-5-5");
    expect(optionLabels(select("Claude Code model"))).not.toContain(
      "Claude Opus 5.5 (unavailable)",
    );
    expect(previewChips()).toEqual(["Claude Code", "Claude Opus 5.5", "Max", "1M context"]);
  });

  it("shows a stored Claude alias as the same model in the select and the preview", () => {
    render({
      appSettings: settingsWith({
        defaults: {
          ...defaultAgentNewThreadDefaults(),
          claudeCode: { model: "sonnet", effort: "high" },
        },
      }),
    });

    const model = select("Claude Code model");

    expect(model.value).toBe("claude-sonnet-5");
    expect(model.selectedOptions[0]?.textContent).toBe("Claude Sonnet 5");
    expect(optionLabels(model)).toEqual([
      "CLI default (Claude Sonnet 5)",
      "Claude Opus 5.5",
      "Claude Sonnet 5",
    ]);
    expect(previewChips()).toEqual(["Claude Code", "Claude Sonnet 5", "High", "1M context"]);
    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("ignores a model value that is not one of the offered options", () => {
    render();

    const model = select("Codex model");

    act(() => model.append(new Option("Injected", "gpt-injected")));
    setSelect(model, "gpt-injected");

    expect(onChangeNewThreadDefaults).not.toHaveBeenCalled();
  });

  it("switches the launch source and lets the description follow", () => {
    render();

    const row = host.querySelector(SOURCE_ROW);

    expect(row?.querySelector("h3")?.textContent).toBe("In projects you have used before");
    expect(segment("Use these defaults").getAttribute("aria-checked")).toBe("true");
    expect(row?.textContent).toContain("Every new thread starts from the defaults above.");

    act(() => segment("Continue with last used").click());

    expect(onChangeNewThreadDefaults.mock.calls).toEqual([
      [{ ...defaultAgentNewThreadDefaults(), source: "lastUsed" }],
    ]);
    expect(segment("Continue with last used").getAttribute("aria-checked")).toBe("true");
    expect(row?.textContent).toContain(
      "A new thread reuses the model and effort of the last thread in that project.",
    );
    expect(row?.textContent).not.toContain("Every new thread starts from the defaults above.");
  });

  it("previews the launch of the selected provider and follows every change", () => {
    render();

    expect(host.textContent).toContain("A new thread opens like this");
    expect(previewSummary()).toBe(
      "New thread preview: Claude Code, Claude Sonnet 5, High effort, 1M context",
    );
    expect(previewChips()).toEqual(["Claude Code", "Claude Sonnet 5", "High", "1M context"]);

    setSelect(select("Claude Code model"), "claude-opus-5-5");
    setSelect(select("Claude Code effort"), "max");

    expect(previewChips()).toEqual(["Claude Code", "Claude Opus 5.5", "Max", "1M context"]);

    act(() => radio("Codex").click());

    expect(previewSummary()).toBe("New thread preview: Codex, GPT-6.1-Sol");

    setSelect(select("Codex model"), "gpt-6-luna");
    setSelect(select("Codex effort"), "medium");

    expect(previewChips()).toEqual(["Codex", "GPT-6-Luna", "Medium"]);
    expect(previewSummary()).toBe("New thread preview: Codex, GPT-6-Luna, Medium effort");
  });

  it("wraps every preview chip label in a truncating span with the full text as its title", () => {
    render();

    const chips = [...host.querySelectorAll("[data-chip]")];

    expect(chips.map((chip) => chip.getAttribute("title"))).toEqual([
      "Claude Code",
      "Claude Sonnet 5",
      "High",
      "1M context",
    ]);
    expect(
      chips.map((chip) => chip.querySelector(".settings-thread-preview__chip-label")?.textContent),
    ).toEqual(["Claude Code", "Claude Sonnet 5", "High", "1M context"]);
  });

  it("keeps the preview out of the tab order and hides its parts from assistive tech", () => {
    render();

    const preview = host.querySelector('[role="img"]');

    expect(preview?.hasAttribute("tabindex")).toBe(false);
    expect(preview?.querySelectorAll("button, select, input, a, [tabindex]")).toHaveLength(0);
    expect(
      [...(preview?.children ?? [])].map((child) => child.getAttribute("aria-hidden")),
    ).toEqual(["true", "true"]);
  });

  it("renders the thread rows in registry order below the start block", () => {
    render();

    expect(
      [...host.querySelectorAll("[data-settings-row]")].map((element) =>
        element.getAttribute("data-settings-row"),
      ),
    ).toEqual([
      "agents.defaultProvider",
      "agents.newThreadLaunchSource",
      "agents.followUpBehavior",
      "agents.favoriteModels",
      "agents.maxConcurrentTasks",
      "agents.isolationPolicy",
    ]);
  });

  it("reveals and focuses the start block when settings search targets it", () => {
    const scrollIntoView = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
      writable: true,
    });

    render({ targetRowId: "agents.defaultProvider" });

    const block = host.querySelector(START_ROW);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(block);
    expect(block?.getAttribute("data-target")).toBe("true");
  });

  function render(options: HarnessOptions = {}): void {
    const management = options.management ?? newThreadManagementFixture();
    const claudeCatalog = options.claudeCatalog ?? NEW_THREAD_CLAUDE_CATALOG;
    const target = { targetRowId: options.targetRowId ?? null, onTargetHandled: () => undefined };

    function Harness() {
      const [appSettings, setAppSettings] = useState(
        () => options.appSettings ?? defaultAppSettings(),
      );

      return (
        <SettingsTargetContext.Provider value={target}>
          <ClaudeModelCatalogContext.Provider value={claudeCatalog}>
            <CodexModelCatalogContext.Provider value={NEW_THREAD_CODEX_CATALOG}>
              <AgentThreadDefaultsRows
                appSettings={appSettings}
                hasWorkspace
                management={management}
                onChangeDefaultProvider={(agentCliKind) => {
                  onChangeDefaultProvider(agentCliKind);
                  setAppSettings((current) => ({ ...current, agentCliKind }));
                }}
                onChangeFollowUpBehavior={() => undefined}
                onChangeIsolationPolicy={() => undefined}
                onChangeNewThreadDefaults={(agentNewThreadDefaults) => {
                  onChangeNewThreadDefaults(agentNewThreadDefaults);
                  setAppSettings((current) => ({ ...current, agentNewThreadDefaults }));
                }}
                onClearFavorites={() => undefined}
                workspaceSettings={defaultWorkspaceSettings()}
              />
            </CodexModelCatalogContext.Provider>
          </ClaudeModelCatalogContext.Provider>
        </SettingsTargetContext.Provider>
      );
    }

    act(() => root.render(<Harness />));
  }

  function radios(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>('[role="radio"][data-provider]')];
  }

  function radio(name: string): HTMLButtonElement {
    const element = radios().find((candidate) => accessibleName(candidate) === name);

    expect(element).toBeDefined();

    return element ?? document.createElement("button");
  }

  function tile(name: string): HTMLElement {
    const element = radio(name).closest<HTMLElement>(".settings-thread-tile");

    expect(element).not.toBeNull();

    return element ?? document.createElement("div");
  }

  function select(label: string): HTMLSelectElement {
    const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

    expect(element).not.toBeNull();

    return element ?? document.createElement("select");
  }

  function segment(label: string): HTMLButtonElement {
    const element = [
      ...host.querySelectorAll<HTMLButtonElement>(`${SOURCE_ROW} [role="radio"]`),
    ].find((candidate) => candidate.textContent === label);

    expect(element).toBeDefined();

    return element ?? document.createElement("button");
  }

  function previewSummary(): string | null {
    return host.querySelector('[role="img"]')?.getAttribute("aria-label") ?? null;
  }

  function previewChips(): ReadonlyArray<string | null> {
    return [...host.querySelectorAll("[data-chip]")].map((chip) => chip.textContent);
  }

  function accessibleName(element: Element): string {
    return textOf(element.getAttribute("aria-labelledby"));
  }

  function description(element: Element): string {
    return textOf(element.getAttribute("aria-describedby"));
  }

  function textOf(ids: string | null | undefined): string {
    return (ids ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
  }

  function click(element: Element | null): void {
    expect(element).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  function press(element: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });

    act(() => {
      element.dispatchEvent(event);
    });

    return event;
  }

  function setSelect(element: HTMLSelectElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
});

function optionLabels(element: HTMLSelectElement): ReadonlyArray<string | null> {
  return [...element.options].map((option) => option.textContent);
}

function optionValues(element: HTMLSelectElement): ReadonlyArray<string> {
  return [...element.options].map((option) => option.value);
}

function gatedOpusDefaults(): AgentNewThreadDefaults {
  return {
    ...defaultAgentNewThreadDefaults(),
    claudeCode: { model: "claude-opus-5-5", effort: "max" },
  };
}

function managementWithClaudeVersion(version: string): AgentProviderManagementSurface {
  return newThreadManagementFixture(
    {},
    {
      claudeCode: { kind: "detected", path: "/bin/claude", version },
      codex: { kind: "notFound" },
    },
  );
}

function settingsWith(options: {
  readonly agentCliKind?: AgentCliKind;
  readonly defaults?: AgentNewThreadDefaults;
  readonly disabled?: ReadonlyArray<AgentCliKind>;
}): AppSettings {
  const base = defaultAppSettings();
  const preferences = defaultAgentProviderPreferences();
  const disabled = options.disabled ?? [];

  return {
    ...base,
    agentCliKind: options.agentCliKind ?? base.agentCliKind,
    agentNewThreadDefaults: options.defaults ?? defaultAgentNewThreadDefaults(),
    agentProviderPreferences: {
      claudeCode: { ...preferences.claudeCode, enabled: !disabled.includes("claudeCode") },
      codex: { ...preferences.codex, enabled: !disabled.includes("codex") },
    },
  };
}
