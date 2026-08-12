// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { AgentsSettingsSection, type AgentsSettingsSectionProps } from "./AgentsSettingsSection";

describe("AgentsSettingsSection agent CLI path input", () => {
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

  it("keeps interior and trailing spaces while typing and trims only on blur", () => {
    let storedPath: string | null = null;
    const onChangeAgentCliPath = vi.fn((value: string | null) => {
      storedPath = value;
      render({ onChangeAgentCliPath }, storedPath);
    });
    render({ onChangeAgentCliPath }, storedPath);

    setValue(cliPathInput(), "/Applications/My ");

    expect(onChangeAgentCliPath).toHaveBeenLastCalledWith("/Applications/My ");

    setValue(cliPathInput(), "/Applications/My Tools/claude ");
    act(() => {
      cliPathInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onChangeAgentCliPath).toHaveBeenLastCalledWith("/Applications/My Tools/claude");
  });

  it("clears the setting when the input is emptied", () => {
    const onChangeAgentCliPath = vi.fn();
    render({ onChangeAgentCliPath }, "/usr/local/bin/claude");

    setValue(cliPathInput(), "");

    expect(onChangeAgentCliPath).toHaveBeenLastCalledWith(null);
  });

  function render(
    overrides: Partial<AgentsSettingsSectionProps>,
    agentCliPath: string | null = null,
  ): void {
    const props: AgentsSettingsSectionProps = {
      appSettings: { ...defaultAppSettings(), agentCliPath },
      hasWorkspace: true,
      workspaceSettings: defaultWorkspaceSettings(),
      onChangeAgentCliPath: () => undefined,
      onChangeAgentCliKind: () => undefined,
      onChangeMaxConcurrentAgentTasks: () => undefined,
      onChangeAgentIsolationPolicy: () => undefined,
      ...overrides,
    };
    act(() => root.render(createElement(AgentsSettingsSection, props)));
  }

  function cliPathInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="/usr/local/bin/claude"]',
    );
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function setValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    act(() => {
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
});
