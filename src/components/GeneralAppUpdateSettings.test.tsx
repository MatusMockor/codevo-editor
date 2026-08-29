// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import { GeneralAppUpdateSettings } from "./GeneralAppUpdateSettings";

describe("GeneralAppUpdateSettings", () => {
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

  it("checks without downloading and requires separate download and install clicks", () => {
    const available = {
      kind: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notes: "Beta update",
    } as const;
    const updater = updaterSurface(available);
    render(updater);

    expect(host.textContent).toContain("Current version0.1.0");
    expect(host.textContent).toContain("Available version0.2.0");
    act(() => button("Download update").click());
    expect(updater.download).toHaveBeenCalledOnce();
    expect(updater.installAndRestart).not.toHaveBeenCalled();

    render({ ...updater, state: { ...available, kind: "readyToInstall" } });
    act(() => button("Install and restart").click());
    expect(updater.installAndRestart).toHaveBeenCalledOnce();
  });

  it("shows truthful no-update and failure states", () => {
    const updater = updaterSurface({ kind: "upToDate", currentVersion: "0.1.0" });
    render(updater);
    expect(host.textContent).toContain("Codevo is up to date.");
    expect(button("Check for updates").disabled).toBe(false);

    render({
      ...updater,
      state: {
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Unable to check for application updates.",
      },
    });
    expect(host.textContent).toContain("Unable to check for application updates.");
  });

  it("disables the action while an operation is pending", () => {
    render(updaterSurface({ kind: "checking", currentVersion: "0.1.0", generation: 2 }));
    expect(button("Checking…").disabled).toBe(true);
    expect(button("Checking…").getAttribute("aria-busy")).toBe("true");
  });

  function render(updater: AppUpdaterSurface): void {
    act(() => root.render(<GeneralAppUpdateSettings updater={updater} />));
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!match) throw new Error(`Missing ${label} button.`);
    return match;
  }
});

function updaterSurface(state: AppUpdaterSurface["state"]): AppUpdaterSurface {
  return {
    state,
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    installAndRestart: vi.fn(async () => undefined),
  };
}
