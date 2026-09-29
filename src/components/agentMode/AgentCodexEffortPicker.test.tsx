// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions, CodexLaunchOptions } from "../../domain/agentLaunch";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  parseCodexModelCatalog,
} from "../../domain/codexModelCatalog";
import { AgentCodexEffortPicker } from "./AgentCodexEffortPicker";
import { CodexModelCatalogContext } from "./useAgentCodexModelCatalog";

const live = parseCodexModelCatalog({
  version: 1,
  source: "live",
  revision: 3,
  models: [
    {
      id: "gpt-7-nova",
      label: "GPT-7-Nova",
      description: "Live default.",
      status: "current",
      isDefault: true,
      efforts: ["low", "ultra"],
      defaultEffort: "low",
      upgradeTo: null,
    },
    {
      id: "gpt-6-luna",
      label: "GPT-6-Luna",
      description: "No effort control.",
      status: "current",
      isDefault: false,
      efforts: [],
      defaultEffort: null,
      upgradeTo: null,
    },
  ],
});

const codex = (patch: Partial<CodexLaunchOptions> = {}): CodexLaunchOptions => ({
  provider: "codex",
  model: "default",
  mode: "workspaceWrite",
  ...patch,
});

describe("AgentCodexEffortPicker", () => {
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

  function render(launch: CodexLaunchOptions, catalog = live) {
    const onChange = vi.fn<(next: AgentLaunchOptions) => void>();
    act(() =>
      root.render(
        <CodexModelCatalogContext.Provider value={catalog}>
          <AgentCodexEffortPicker
            configuredModel={null}
            disabled={false}
            launch={launch}
            onChange={onChange}
          />
        </CodexModelCatalogContext.Provider>,
      ),
    );
    return onChange;
  }

  function trigger(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('[aria-label="Reasoning effort"]');
  }

  function radios(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map(
      (node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent ?? "",
    );
  }

  it("lists only the efforts of the effective live model and selects one", () => {
    const onChange = render(codex());
    act(() => trigger()?.click());
    expect(radios()).toEqual(["Default", "Low", "Ultra"]);
    const ultra = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')][2];
    act(() => ultra.click());
    expect(onChange).toHaveBeenCalledWith(codex({ model: "gpt-7-nova", effort: "ultra" }));
  });

  it("shows Default until an override is chosen and can clear the override", () => {
    render(codex({ model: "gpt-7-nova" }));
    expect(trigger()?.textContent).toBe("Default");
    act(() => trigger()?.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    act(() => trigger()?.click());

    const onChange = render(codex({ model: "gpt-7-nova", effort: "ultra" }));
    expect(trigger()?.textContent).toBe("Ultra");
    act(() => trigger()?.click());
    act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')][0].click());
    expect(onChange).toHaveBeenCalledWith(codex({ model: "gpt-7-nova" }));
  });

  it("follows the bundled model efforts when the live list is unavailable", () => {
    render(codex({ model: "gpt-5.5" }), BUNDLED_CODEX_MODEL_CATALOG);
    act(() => trigger()?.click());
    expect(radios()).toEqual(["Default", "Low", "Medium", "High", "Extra high"]);
  });

  it("hides the control for a model without effort choices", () => {
    render(codex({ model: "gpt-6-luna" }));
    expect(trigger()).toBeNull();
  });
});
