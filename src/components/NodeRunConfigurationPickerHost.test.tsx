// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NodeRunConfigurationPickerHost,
  type NodeRunConfigurationPickerLauncherProjection,
} from "./NodeRunConfigurationPickerHost";

describe("NodeRunConfigurationPickerHost", () => {
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

  it("renders Run copy and forwards only the exact selected name", () => {
    const launcher = projection();
    act(() => root.render(<NodeRunConfigurationPickerHost launcher={launcher} />));

    expect(host.querySelector('[role="dialog"] strong')?.textContent).toBe(
      "Select configuration to run without debugging",
    );
    const worker = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Worker"),
    )!;
    act(() => worker.click());
    expect(launcher.startNamed).toHaveBeenCalledOnce();
    expect(launcher.startNamed).toHaveBeenCalledWith("Worker");
  });

  it("does not render private payload fields carried by an untrusted structural caller", () => {
    const unsafeChoice = {
      args: ["--private-argument"],
      default: true,
      env: { TOKEN: "private-environment" },
      name: "API",
      targetKind: "script" as const,
    };
    const launcher = projection({
      choices: [unsafeChoice],
    });
    act(() => root.render(<NodeRunConfigurationPickerHost launcher={launcher} />));

    expect(host.textContent).toContain("API");
    expect(host.innerHTML).not.toContain("private-argument");
    expect(host.innerHTML).not.toContain("private-environment");
  });

  it("forwards close and retry while preserving busy/error accessibility", () => {
    const launcher = projection({
      busy: false,
      choices: [],
      error: "Configuration file is invalid",
      state: "error",
    });
    act(() => root.render(<NodeRunConfigurationPickerHost launcher={launcher} />));

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Configuration file is invalid");
    act(() => host.querySelector<HTMLButtonElement>("button:not([aria-label])")?.click());
    expect(launcher.refresh).toHaveBeenCalledOnce();
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close Run Without Debugging configuration picker"]',
        )
        ?.click(),
    );
    expect(launcher.closePicker).toHaveBeenCalledOnce();
  });

  it("stays unmounted without a launcher or while its picker is closed", () => {
    act(() => root.render(<NodeRunConfigurationPickerHost launcher={null} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() =>
      root.render(<NodeRunConfigurationPickerHost launcher={projection({ pickerOpen: false })} />),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

function projection(
  overrides: Partial<NodeRunConfigurationPickerLauncherProjection> = {},
): NodeRunConfigurationPickerLauncherProjection {
  return {
    busy: false,
    choices: [
      { default: true, name: "API", targetKind: "script" },
      { default: false, name: "Worker", targetKind: "npm" },
    ],
    closePicker: vi.fn(() => undefined),
    error: null,
    pickerOpen: true,
    refresh: vi.fn(() => undefined),
    selectedName: "API",
    startNamed: vi.fn((_name: string) => undefined),
    state: "ready",
    ...overrides,
  };
}
