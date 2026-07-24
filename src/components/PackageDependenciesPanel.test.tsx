// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPackageDependencyTree } from "../domain/packageDependencyTree";
import { PackageDependenciesPanel } from "./PackageDependenciesPanel";
import type { PendingPackageOperation } from "../application/packageDependenciesPanelModel";

describe("PackageDependenciesPanel", () => {
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

  it("renders manager, production/dev groups, ranges, versions, and missing state", async () => {
    await render();
    expect(host.textContent).toContain("pnpm");
    expect(host.textContent).toContain("Production dependencies (1)");
    expect(host.textContent).toContain("Development dependencies (1)");
    expect(host.textContent).toContain("^5");
    expect(host.textContent).toContain("5.1.0");
    expect(host.textContent).toContain("missing");
  });

  it("supports controlled filtering and keyboard navigation/opening", async () => {
    const onOpenDependency = vi.fn();
    const onQueryChange = vi.fn();
    await render({ onOpenDependency, onQueryChange });
    const input = queryInput();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onOpenDependency).toHaveBeenCalledWith(expect.objectContaining({ name: "vitest" }));

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "missing",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onQueryChange).toHaveBeenCalledWith("missing");
  });

  it("renders filter-empty and navigation-error states", async () => {
    await render({ query: "nothing", tree: [] });
    expect(host.textContent).toContain("No dependencies match the current filter.");
    expect(queryInput().hasAttribute("aria-activedescendant")).toBe(false);

    await render({ error: "package.json changed", tree: [] });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("package.json changed");
  });

  it("previews and confirms package operations explicitly", async () => {
    const onConfirmOperation = vi.fn();
    const onInstallPackage = vi.fn();
    const onUpdateDependency = vi.fn();
    await render({ onConfirmOperation, onInstallPackage, onUpdateDependency });

    const name = host.querySelector<HTMLInputElement>('[aria-label="Package name to install"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "zod");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    clickButton("Install");
    expect(onInstallPackage).toHaveBeenCalledWith("zod", false);

    clickButton("Update express");
    expect(onUpdateDependency).toHaveBeenCalledWith(expect.objectContaining({ name: "express" }));

    await render({ onConfirmOperation, pendingOperation: pending });
    expect(host.querySelector('[aria-label="Package operation preview"]')?.textContent).toContain(
      "pnpm update express",
    );
    clickButton("Confirm");
    expect(onConfirmOperation).toHaveBeenCalledOnce();
  });

  it("disables mutation controls when untrusted or busy and announces results", async () => {
    await render({ error: "Operation failed", status: "Packages refreshed", trusted: false });
    expect(button("Install").disabled).toBe(true);
    expect(button("Update express").disabled).toBe(true);
    expect(host.textContent).toContain("Trust the workspace");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Operation failed");
    expect(host.querySelectorAll('[role="status"]')[1]?.textContent).toBe("Packages refreshed");

    await render({ busy: true, pendingOperation: pending });
    expect(button("Confirm").disabled).toBe(true);
    expect(queryInput().disabled).toBe(true);
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
  });

  async function render(
    overrides: Partial<Parameters<typeof PackageDependenciesPanel>[0]> = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <PackageDependenciesPanel
          busy={overrides.busy ?? false}
          error={overrides.error ?? null}
          manager={overrides.manager ?? "pnpm"}
          onCancelOperation={overrides.onCancelOperation ?? vi.fn()}
          onCheckOutdated={overrides.onCheckOutdated ?? vi.fn()}
          onConfirmOperation={overrides.onConfirmOperation ?? vi.fn()}
          onInstallPackage={overrides.onInstallPackage ?? vi.fn()}
          onOpenDependency={overrides.onOpenDependency ?? vi.fn()}
          onQueryChange={overrides.onQueryChange ?? vi.fn()}
          onRemoveDependency={overrides.onRemoveDependency ?? vi.fn()}
          onUpdateDependency={overrides.onUpdateDependency ?? vi.fn()}
          pendingOperation={overrides.pendingOperation ?? null}
          query={overrides.query ?? ""}
          status={overrides.status ?? null}
          tree={overrides.tree ?? tree}
          trusted={overrides.trusted ?? true}
        />,
      );
    });
  }

  function queryInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Filter workspace dependencies"]',
    );
    if (!input) throw new Error("Dependency filter missing");
    return input;
  }

  function button(label: string): HTMLButtonElement {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label || candidate.textContent === label,
    );
    if (!match) throw new Error(`${label} button missing`);
    return match;
  }

  function clickButton(label: string): void {
    act(() => button(label).click());
  }
});

const pending: PendingPackageOperation = {
  preview: {
    arguments: ["update", "express"],
    description: "Update express",
    manager: "pnpm",
    mutatesManifest: true,
  },
  request: { operation: "update", packageName: "express", workspaceId: "one" },
};

const tree = buildPackageDependencyTree([
  {
    declaredRange: "^5",
    dev: false,
    installedVersion: "5.1.0",
    installPath: "/workspace/node_modules/express",
    name: "express",
  },
  {
    declaredRange: "^3",
    dev: true,
    installedVersion: null,
    installPath: null,
    name: "vitest",
  },
]);
