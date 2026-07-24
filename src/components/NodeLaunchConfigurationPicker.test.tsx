// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS,
  NodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPickerProps,
} from "./NodeLaunchConfigurationPicker";

function props(
  overrides: Partial<NodeLaunchConfigurationPickerProps> = {},
): NodeLaunchConfigurationPickerProps {
  return {
    busy: false,
    choices: [
      { default: true, name: "API", targetKind: "script" },
      { default: false, name: "Worker", targetKind: "npm" },
      { default: false, name: "Attach", targetKind: "attach" },
    ],
    error: null,
    intent: "debug",
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onStartNamed: vi.fn(),
    open: true,
    selectedName: "Worker",
    state: "ready",
    ...overrides,
  };
}

describe("NodeLaunchConfigurationPicker", () => {
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

  function render(overrides: Partial<NodeLaunchConfigurationPickerProps> = {}) {
    const value = props(overrides);
    act(() => root.render(<NodeLaunchConfigurationPicker {...value} />));
    return value;
  }

  function key(value: string) {
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value })));
  }

  function inputValue(input: HTMLInputElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("autofocuses search and starts the exact keyboard-selected configuration", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search Node debug configurations"]',
    )!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "Worker",
    );

    key("ArrowDown");
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "Attach",
    );
    key("ArrowDown");
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "API",
    );
    key("ArrowUp");
    key("Enter");

    expect(value.onStartNamed).toHaveBeenCalledOnce();
    expect(value.onStartNamed).toHaveBeenCalledWith("Attach");
    expect(value.onClose).not.toHaveBeenCalled();
  });

  it("searches by safe presentation fields and resets keyboard selection", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>("input")!;
    inputValue(input, "npm");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.querySelector('[role="option"]')?.textContent).toContain("Worker");
    key("Enter");
    expect(value.onStartNamed).toHaveBeenCalledWith("Worker");
  });

  it("distinguishes imported VS Code choices and announces only generic skipped diagnostics", () => {
    const importedChoice = {
      default: false,
      name: "Imported API",
      preLaunchTask: "build",
      source: "vscode" as const,
      targetKind: "npm" as const,
      script: "private:dev",
      cwd: "private-package",
      env: { PRIVATE_TOKEN: "hidden-value" },
      justMyCode: "nodeInternals",
    };
    render({
      choices: [importedChoice],
      diagnosticNotice: {
        count: 2,
        message:
          "2 VS Code launch configurations were skipped because they are unsupported or invalid.",
      },
      selectedName: "Imported API",
    });

    const option = host.querySelector('[role="option"]');
    expect(option?.textContent).toContain("npm · VS Code");
    expect(option?.textContent).toContain("preLaunchTask: build");
    const notice = host.querySelector(
      '[role="status"][aria-label="2 skipped VS Code launch configurations"]',
    );
    expect(notice?.textContent).toBe(
      "2 VS Code launch configurations were skipped because they are unsupported or invalid.",
    );
    expect(host.textContent).not.toContain(".vscode/launch.json");
    expect(host.textContent).not.toContain("private:dev");
    expect(host.textContent).not.toContain("private-package");
    expect(host.textContent).not.toContain("PRIVATE_TOKEN");
    expect(host.textContent).not.toContain("hidden-value");
    expect(host.textContent).not.toContain("nodeInternals");
  });

  it("renders a compound using only safe aggregate metadata and keeps it disabled", () => {
    const onStartNamed = vi.fn();
    const compoundChoice = {
      compoundMemberCount: 2,
      default: false,
      hasPreLaunchTask: true,
      memberNames: ["private-api", "private-worker"],
      name: "Services",
      preLaunchTaskLabel: "private-build-task",
      runnable: false,
      source: "vscode" as const,
      targetKind: "compound" as const,
    };
    render({
      choices: [compoundChoice],
      onStartNamed,
      selectedName: null,
    });

    const option = host.querySelector<HTMLButtonElement>('[role="option"]');
    expect(option?.disabled).toBe(true);
    expect(option?.textContent).toContain("compound · 2 configurations · VS Code");
    expect(option?.textContent).toContain("preLaunchTask configured");
    expect(host.textContent).not.toContain("private-api");
    expect(host.textContent).not.toContain("private-worker");
    expect(host.textContent).not.toContain("private-build-task");
    act(() => option?.click());
    expect(onStartNamed).not.toHaveBeenCalled();
  });

  it("keeps the query and keyboard selection when an equivalent safe choice projection rerenders", () => {
    const value = render();
    const input = host.querySelector<HTMLInputElement>("input")!;
    inputValue(input, "p");
    key("ArrowDown");
    const selected = host.querySelector('[role="option"][aria-selected="true"]')?.textContent;

    act(() =>
      root.render(
        <NodeLaunchConfigurationPicker
          {...value}
          choices={value.choices.map((choice) => ({ ...choice }))}
        />,
      ),
    );

    expect(input.value).toBe("p");
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(selected);
  });

  it("uses complete Run Without Debugging copy without changing modal behavior", () => {
    render({ intent: "run" });

    expect(host.querySelector('[role="dialog"] strong')?.textContent).toBe(
      "Select configuration to run without debugging",
    );
    expect(host.querySelector<HTMLInputElement>("input")?.getAttribute("aria-label")).toBe(
      "Search Run Without Debugging configurations",
    );
    expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(
      "Run Without Debugging configurations",
    );
    expect(
      host.querySelector('button[aria-label="Close Run Without Debugging configuration picker"]'),
    ).not.toBeNull();
  });

  it("caps rows and never renders private launch payload fields", () => {
    const choices = Array.from(
      { length: MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS + 4 },
      (_, index) => ({
        args: ["--private-argument"],
        default: index === 0,
        env: { SECRET: "private-environment-value" },
        name: `Configuration ${index}`,
        targetKind: "script" as const,
      }),
    );
    render({ choices, selectedName: choices[0]!.name });

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(
      MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS,
    );
    expect(host.innerHTML).not.toContain("--private-argument");
    expect(host.innerHTML).not.toContain("private-environment-value");
    expect([...host.querySelectorAll("[title]")]).toHaveLength(0);
  });

  it("closes from Escape and the backdrop but not from the dialog body", () => {
    const value = render();
    key("Escape");
    expect(value.onClose).toHaveBeenCalledOnce();

    const backdrop = host.querySelector<HTMLElement>('[role="dialog"]')!.parentElement!;
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(value.onClose).toHaveBeenCalledTimes(2);
    act(() =>
      host
        .querySelector<HTMLElement>('[role="dialog"]')!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(value.onClose).toHaveBeenCalledTimes(2);
  });

  it("traps focus in the modal and restores the prior focus when it closes", () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    const value = props();
    act(() => root.render(<NodeLaunchConfigurationPicker {...value} />));

    const close = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Node debug configuration picker"]',
    )!;
    const options = host.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const last = options[options.length - 1]!;

    last.focus();
    act(() => last.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })));
    expect(document.activeElement).toBe(close);

    act(() =>
      close.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
      ),
    );
    expect(document.activeElement).toBe(last);

    act(() => root.render(<NodeLaunchConfigurationPicker {...value} open={false} />));
    expect(document.activeElement).toBe(prior);
    prior.remove();
  });

  it("falls back to the dialog and safely traps both Tab directions when all controls disable", () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    const value = props();
    act(() => root.render(<NodeLaunchConfigurationPicker {...value} />));

    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    act(() => root.render(<NodeLaunchConfigurationPicker {...value} busy />));

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(dialog);

    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })));
    expect(document.activeElement).toBe(dialog);
    act(() =>
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
      ),
    );
    expect(document.activeElement).toBe(dialog);

    act(() => root.render(<NodeLaunchConfigurationPicker {...value} busy open={false} />));
    expect(document.activeElement).toBe(prior);
    prior.remove();
  });

  it("returns programmatic focus escapes to the open modal", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    render({ busy: true });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;

    outside.focus();

    expect(document.activeElement).toBe(dialog);
    outside.remove();
  });

  it("locks interactions while launching and exposes busy state", () => {
    const value = render({ busy: true });
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="Close Node debug configuration picker"]',
      )?.disabled,
    ).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].every((row) => row.disabled),
    ).toBe(true);
    key("Enter");
    key("Escape");
    expect(value.onStartNamed).not.toHaveBeenCalled();
    expect(value.onClose).not.toHaveBeenCalled();
  });

  it("renders loading, empty, no-match, and retryable error states accessibly", () => {
    render({ choices: [], selectedName: null, state: "loading" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading");
    render({ choices: [], selectedName: null, state: "empty" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No Node");
    render({ error: "Configuration file is invalid", state: "error" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Configuration file is invalid");
    const retry = host.querySelector<HTMLButtonElement>("button:not([aria-label])")!;
    act(() => retry.click());

    const ready = props({ selectedName: null });
    act(() => root.render(<NodeLaunchConfigurationPicker {...ready} />));
    const input = host.querySelector<HTMLInputElement>("input")!;
    inputValue(input, "missing");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No matching");
  });

  it("does not mount a dialog while closed", () => {
    render({ open: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
