// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeLaunchConfiguration } from "../domain/nodeLaunchConfiguration";
import {
  NodeLaunchConfigurationsDialog,
  type NodeLaunchConfigurationsDialogProps,
} from "./NodeLaunchConfigurationsDialog";

describe("NodeLaunchConfigurationsDialog", () => {
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

  it("creates and saves a validated npm target with args, cwd, env, and default", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await click("New");
    await input("Configuration name", "Web dev");
    await select("Target type", "npm");
    await input("npm script", "dev");
    await input("Package root", "apps/web");
    await input("Working directory", "apps/web");
    await input("Arguments", "--port\n4100");
    await input("Environment", "NODE_ENV=development\nPORT=4100");
    await check("Default configuration", true);
    await click("Save configuration");

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toEqual([
      { ...configurations[0], default: false },
      configurations[1],
      {
        args: ["--port", "4100"],
        cwd: "apps/web",
        default: true,
        env: { NODE_ENV: "development", PORT: "4100" },
        name: "Web dev",
        target: { kind: "npm", packageRoot: "apps/web", script: "dev" },
      },
    ]);
  });

  it("edits test targets and deletes the selected configuration", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await select("Target type", "test");
    await input("Test path", "src/api.test.ts");
    await select("Test runner", "jest");
    await click("Save configuration");
    expect(onSave.mock.calls[0]?.[0]?.[0]?.target).toEqual({
      kind: "test",
      path: "src/api.test.ts",
      runner: "jest",
    });

    await click("Delete");
    expect(onSave).toHaveBeenLastCalledWith([configurations[1]]);
  });

  it("keeps invalid drafts local and exposes actionable validation", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await input("Script path", "../outside.ts");
    await input("Environment", "not-an-entry");
    await click("Save configuration");

    expect(onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("KEY=value");
    expect(inputElement("Script path").value).toBe("../outside.ts");
  });

  it("shows only an inspector port for attach targets and validates it accessibly", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await select("Target type", "attach");

    expect(inputElement("Inspector port").value).toBe("9229");
    for (const label of [
      "Script path",
      "Test path",
      "Test runner",
      "npm script",
      "Package root",
      "Working directory",
      "Arguments",
      "Environment",
    ]) {
      expect(host.querySelector(`[aria-label="${label}"]`), label).toBeNull();
    }

    await input("Inspector port", "65536");
    const portInput = inputElement("Inspector port");
    expect(portInput.getAttribute("aria-invalid")).toBe("true");
    expect(portInput.getAttribute("aria-describedby")).toBe("node-attach-port-error");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "integer between 1 and 65535",
    );

    await click("Save configuration");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a valid inspector port as a normalized attach configuration", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await select("Target type", "attach");
    await input("Inspector port", "9230");
    await click("Save configuration");

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith([
      {
        args: [],
        default: true,
        env: {},
        name: "API",
        target: { kind: "attach", port: 9230 },
      },
      configurations[1],
    ]);
  });

  it("preserves an empty attach port for accessible correction", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await select("Target type", "attach");
    await input("Inspector port", "");

    expect(inputElement("Inspector port").value).toBe("");
    expect(inputElement("Inspector port").getAttribute("aria-invalid")).toBe("true");
    await click("Save configuration");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("loads an existing attach configuration without script-only fields", async () => {
    await render({
      configurations: [
        {
          args: [],
          default: true,
          env: {},
          name: "Inspector",
          target: { kind: "attach", port: 9231 },
        },
      ],
    });

    expect(inputElement("Inspector port").value).toBe("9231");
    expect(host.querySelector('[aria-label="Arguments"]')).toBeNull();
    expect(host.querySelector('[aria-label="Environment"]')).toBeNull();
  });

  it("discards hidden script fields when switching a dirty draft to attach", async () => {
    const onSave = vi.fn<NodeLaunchConfigurationsDialogProps["onSave"]>(async () => true);
    await render({ onSave });
    await input("Working directory", "apps/api");
    await input("Arguments", "--inspect\n--watch");
    await input("Environment", "not-an-entry");
    await select("Target type", "attach");
    await click("Save configuration");

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith([
      {
        args: [],
        default: true,
        env: {},
        name: "API",
        target: { kind: "attach", port: 9229 },
      },
      configurations[1],
    ]);
    expect(onSave.mock.calls[0]?.[0]?.[0]).not.toHaveProperty("cwd");
  });

  it("disables mutations when untrusted and documents plaintext secret risk", async () => {
    await render({ workspaceTrusted: false });

    expect(host.textContent).toContain("Trust this workspace");
    expect(host.textContent).toContain("Do not put secrets in launch.json");
    expect(button("Save configuration").disabled).toBe(true);
    expect(button("Delete").disabled).toBe(true);
  });

  it("is an accessible modal and closes with Escape", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    expect(host.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    await act(async () => {
      host
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus into the modal, traps Tab, and restores focus when controlled close wins", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    await render();

    const close = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Node launch configurations"]',
    );
    const save = button("Save configuration");
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);

    save.focus();
    await act(async () => {
      save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    });
    expect(document.activeElement).toBe(close);

    close?.focus();
    await act(async () => {
      close?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
      );
    });
    expect(document.activeElement).toBe(save);

    await render({ isOpen: false });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  async function render(overrides: Partial<NodeLaunchConfigurationsDialogProps> = {}) {
    await act(async () => {
      root.render(
        <NodeLaunchConfigurationsDialog
          configurations={overrides.configurations ?? configurations}
          error={overrides.error ?? null}
          isOpen={overrides.isOpen ?? true}
          loading={overrides.loading ?? false}
          onClose={overrides.onClose ?? vi.fn()}
          onSave={overrides.onSave ?? vi.fn(async () => true)}
          saving={overrides.saving ?? false}
          workspaceTrusted={overrides.workspaceTrusted ?? true}
        />,
      );
    });
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function input(label: string, value: string) {
    await act(async () => {
      const element = inputElement(label);
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function select(label: string, value: string) {
    await act(async () => {
      const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      if (!element) throw new Error(`Select is missing: ${label}`);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function check(label: string, checked: boolean) {
    await act(async () => {
      const element = host.querySelector<HTMLInputElement>(`input[type="checkbox"]`);
      if (!element || !element.parentElement?.textContent?.includes(label)) {
        throw new Error(`Checkbox is missing: ${label}`);
      }
      if (element.checked !== checked) element.click();
    });
  }

  function inputElement(label: string): HTMLInputElement | HTMLTextAreaElement {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `input[aria-label="${label}"], textarea[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`Input is missing: ${label}`);
    return element;
  }

  function button(label: string): HTMLButtonElement {
    const element = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!element) throw new Error(`Button is missing: ${label}`);
    return element;
  }
});

const configurations: readonly NodeLaunchConfiguration[] = [
  {
    args: [],
    default: true,
    env: {},
    name: "API",
    target: { kind: "script", path: "src/server.ts" },
  },
  {
    args: [],
    default: false,
    env: {},
    name: "Worker",
    target: { kind: "script", path: "src/worker.ts" },
  },
];
